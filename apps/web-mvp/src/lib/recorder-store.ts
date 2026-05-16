import { create } from 'zustand';
import { appendAudioChunk, clearAudioChunks, logAudit } from './db';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecordingMode = 'ambient' | 'dictation';
/**
 * Why a recording ended. Persisted alongside RecordingMeta so we can
 * triage "it stopped by itself" reports against actual cause.
 * - `user`: physician pressed Stop.
 * - `silence_autostop`: 30-min idle + 60-s grace window expired with no
 *   voice activity above threshold.
 * - `error`: mic track ended / recorder errored mid-recording.
 */
export type StopReason = 'user' | 'silence_autostop' | 'error';

export interface Bookmark {
  ms: number;
  label?: string | null;
}

interface RecorderInternals {
  mediaRecorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  /** Per-chunk sequence counter so persisted chunks can be reassembled in order. */
  seq: number;
  startTs: number;
  accumulatedMs: number;
  tickerId: number | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  rafId: number | null;
  /** WakeLockSentinel from navigator.wakeLock.request — keeps screen on while recording. */
  wakeLock: WakeLockSentinel | null;
  /** Listener for document.visibilitychange — used to detect screen lock / app backgrounding mid-record. */
  visibilityHandler: ((this: Document, ev: Event) => void) | null;
  /** Wall-clock ms when the tab last went hidden during a recording. */
  lastHiddenAt: number | null;
  /** Total ms accumulated across all hidden periods during this recording. */
  totalHiddenMs: number;
  /** Hidden-event timestamps for post-stop reporting (start, end, ms each). */
  hiddenIntervals: { startMs: number; endMs: number }[];
  /** Wall-clock ms of the most recent moment the audio level exceeded the
   * voice-activity threshold. Used to detect "visit ended but recording is
   * still on" — the dominant cause of forgotten-phone billing waste.
   * Stored on internals (not store state) because the meter updates it
   * every animation frame; we don't want to trigger React re-renders. */
  lastVoiceActivityAt: number;
}

interface WakeLockSentinel extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

/**
 * Voice-activity threshold on the smoothed RMS level (0–1 scale). Real
 * speech peaks at ~0.3–0.7 with valleys around 0.1; ambient HVAC, fan,
 * and distant hum sit under 0.02. 0.05 is the "someone in the room is
 * making noise" line — high enough to not trip on AC, low enough to
 * register quiet conversation across the room.
 */
const VOICE_ACTIVITY_THRESHOLD = 0.05;

/**
 * After this many ms with no voice activity above threshold, surface the
 * silence banner. Real visits don't have 30 min of total silence inside
 * them; a forgotten phone in a pocket does. 30 min is also forgiving
 * enough that quiet exam moments (fontanelle palpation, sleeping baby,
 * provider charting briefly between encounters) don't false-positive.
 */
const IDLE_WARNING_AFTER_MS = 30 * 60_000;

/**
 * Once the banner is showing, give the user 60 s to react ("Keep
 * recording" if the visit's still going, "Stop now" if it's over) before
 * we auto-stop. Voice activity above threshold during this window also
 * dismisses the banner silently — someone walked back in talking.
 */
const IDLE_AUTOSTOP_GRACE_MS = 60_000;

interface RecorderStore {
  state: RecorderState;
  mode: RecordingMode;
  elapsedMs: number;
  level: number;
  error: string | null;
  bookmarks: Bookmark[];
  /**
   * The id this active recording session is using. Generated at start() so
   * persisted chunks can be tagged. Cleared on reset(). Consumers (Record.tsx)
   * use this id when saving the final RecordingMeta so chunk recovery and the
   * final recording share the same id.
   */
  activeRecordingId: string | null;
  /**
   * Whether the tab has been backgrounded (screen lock, app switch) during
   * the current recording. Components can show a warning if true. Cleared
   * on reset().
   */
  hasBeenInterrupted: boolean;
  /**
   * Total ms the tab spent hidden during this recording. Components use
   * this to surface a "lost X seconds of audio" warning post-stop.
   */
  totalInterruptedMs: number;
  /**
   * Set when the IndexedDB chunk-persistence write failed because the
   * browser's storage quota is exhausted. The recording itself is still
   * running in memory, but the safety net (chunk persistence) is gone — a
   * tab crash from here on would lose audio. Components surface a warning
   * so the user can stop now, free space, and re-record.
   */
  storageError: string | null;
  /**
   * Wall-clock ms when the silence banner first appeared. Components show
   * a "no voice detected for 30 min — auto-stopping in 60 s" banner with
   * Keep / Stop actions. Cleared on dismiss-by-voice or explicit Keep.
   * The auto-stop fires after IDLE_AUTOSTOP_GRACE_MS more silence.
   */
  silenceWarningStartedAt: number | null;
  /**
   * Set to true when the grace period elapses with no further voice
   * activity. The Record screen watches this flag and routes through its
   * own save/redirect flow — the store itself can't safely save because
   * IDB writes + view navigation live in the React tree. Reset on next
   * start().
   */
  silenceAutoStopRequested: boolean;
  /**
   * Reason the most recent recording ended. Set the moment we decide to
   * stop (user tap, silence grace, error). Read by Record.tsx when
   * persisting RecordingMeta. Reset to null on next start().
   */
  stopReason: StopReason | null;
  /**
   * When true, the silence-detection ticker short-circuits before the
   * 30-min-silence check. Set by the app shell while the idle-lock
   * overlay is up — a locked screen means PHI is hidden, not that the
   * physician walked away. Without this gate, silence accumulated
   * behind the lock screen could fire auto-stop with the "Keep
   * recording" banner unreachable.
   */
  silenceCheckPaused: boolean;
  // Internals are stored on the store object but never trigger re-renders.
  _internals: RecorderInternals;
  start: (mode?: RecordingMode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob | null>;
  reset: () => void;
  addBookmark: (label?: string) => void;
  /** Dismiss the silence banner because the user said "Keep recording" —
   * resets the voice-activity timer so the warning won't re-fire for
   * another full IDLE_WARNING_AFTER_MS of silence. */
  dismissSilenceWarning: () => void;
  /** Called by the app shell when the idle-lock overlay opens or
   * closes. While paused, the silence ticker won't fire the banner or
   * auto-stop. On resume, the voice-activity timer resets so the
   * physician gets a fresh window. */
  setSilenceCheckPaused: (paused: boolean) => void;
}

function generateRecordingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const ACTIVITY_TICK_MS = 200;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return 'audio/webm';
}

export const useRecorderStore = create<RecorderStore>((set, get) => {
  const internals: RecorderInternals = {
    mediaRecorder: null,
    stream: null,
    chunks: [],
    seq: 0,
    startTs: 0,
    accumulatedMs: 0,
    tickerId: null,
    audioCtx: null,
    analyser: null,
    rafId: null,
    wakeLock: null,
    visibilityHandler: null,
    lastHiddenAt: null,
    totalHiddenMs: 0,
    hiddenIntervals: [],
    lastVoiceActivityAt: 0,
  };

  function stopMeter() {
    const { rafId, audioCtx } = internals;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      internals.rafId = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      internals.audioCtx = null;
    }
    internals.analyser = null;
    set({ level: 0 });
  }

  function startMeter(stream: MediaStream) {
    if (typeof window === 'undefined') return;
    // iOS Safari exposes only webkitAudioContext until iOS ~14.5; keep the
    // fallback so the meter still works on older devices.
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    // iOS starts AudioContext in 'suspended' state; without resume() the
    // analyser feeds back zeros and the bars never light up.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    // iOS WebKit bug: a MediaStreamAudioSourceNode that isn't routed to
    // the destination won't actually pump samples, so the analyser
    // returns silence forever. Route through a silent gain node so the
    // graph runs without leaking mic audio to the speakers.
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    analyser.connect(silentGain);
    silentGain.connect(ctx.destination);
    internals.audioCtx = ctx;
    internals.analyser = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    const tick = () => {
      const a = internals.analyser;
      if (!a) return;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] ?? 128) - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length) / 128;
      const raw = Math.min(1, rms * 2);
      // Same smoothing constants as Roci's native iOS meter — makes the
      // bars feel less jittery and reach high thresholds more readily.
      smoothed = smoothed * 0.6 + raw * 0.4;
      set({ level: smoothed });
      // Voice-activity stamp for "visit ended but recording's still on"
      // detection. We stamp here (in the meter loop, ~60Hz) rather than
      // in the slower ticker so brief speech bursts (a single "yes")
      // count. The ticker only checks elapsed silence.
      if (smoothed > VOICE_ACTIVITY_THRESHOLD) {
        internals.lastVoiceActivityAt = Date.now();
        // If a silence warning was already showing and someone's now
        // talking again, dismiss it — they walked back in.
        if (get().silenceWarningStartedAt !== null) {
          set({ silenceWarningStartedAt: null });
        }
      }
      internals.rafId = requestAnimationFrame(tick);
    };
    internals.rafId = requestAnimationFrame(tick);
  }

  function stopTicker() {
    if (internals.tickerId !== null) {
      window.clearInterval(internals.tickerId);
      internals.tickerId = null;
    }
  }

  function startTicker() {
    internals.startTs = Date.now();
    internals.tickerId = window.setInterval(() => {
      const live = Date.now() - internals.startTs;
      set({ elapsedMs: internals.accumulatedMs + live });

      // Silence detection — runs only when actively recording (not
      // during paused state, where the user has explicitly chosen to
      // freeze). We surface the banner first; auto-stop only fires
      // after the grace window elapses with no further activity.
      if (get().state !== 'recording') return;
      // Locked overlays hide the banner. While locked we don't run the
      // silence math at all so the auto-stop can't fire silently.
      if (get().silenceCheckPaused) return;
      const now = Date.now();
      const silentFor = now - internals.lastVoiceActivityAt;
      const warningStarted = get().silenceWarningStartedAt;

      if (warningStarted === null) {
        // No banner yet — show it once we cross the 30-min idle line.
        if (silentFor >= IDLE_WARNING_AFTER_MS) {
          set({ silenceWarningStartedAt: now });
        }
        return;
      }

      // Banner is showing. If the grace window has fully elapsed and
      // there's been no voice activity since the warning fired, request
      // an auto-stop. Voice activity during the grace period would have
      // already cleared `silenceWarningStartedAt` from the meter loop.
      if (now - warningStarted >= IDLE_AUTOSTOP_GRACE_MS) {
        // The store can't safely save the recording — that lives in
        // Record.tsx where IDB schema + view navigation are wired up.
        // Flag the request; Record.tsx watches it and runs its normal
        // handleStop flow (which persists audio + meta and routes to
        // Review). Idempotent: extra ticks setting true are no-ops.
        if (!get().silenceAutoStopRequested) {
          set({
            silenceAutoStopRequested: true,
            silenceWarningStartedAt: null,
            stopReason: 'silence_autostop',
          });
        }
      }
    }, ACTIVITY_TICK_MS);
  }

  return {
    state: 'idle',
    mode: 'ambient',
    elapsedMs: 0,
    level: 0,
    error: null,
    bookmarks: [],
    activeRecordingId: null,
    hasBeenInterrupted: false,
    totalInterruptedMs: 0,
    storageError: null,
    silenceWarningStartedAt: null,
    silenceAutoStopRequested: false,
    stopReason: null,
    silenceCheckPaused: false,
    _internals: internals,

    async start(mode = 'ambient') {
      // Idempotent if already recording.
      if (get().state === 'recording') return;
      set({ error: null, mode });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        internals.stream = stream;
        // Listen on each audio track for mute/unmute events. The OS fires
        // these when something else takes the mic — most commonly an incoming
        // phone call (CallKit on iOS, telephony on Android), but also other
        // apps grabbing the input. Some platforms (Android in particular)
        // take the mic without firing document.visibilitychange, so this is
        // a complementary signal we MUST listen for to catch interruptions.
        // We feed the mute window into the same hasBeenInterrupted state as
        // the visibility handler so the user gets one consolidated warning.
        let muteStartMs: number | null = null;
        for (const track of stream.getAudioTracks()) {
          track.addEventListener('mute', () => {
            // Only record the mute as an interruption if we're actively
            // recording. (Permission denial fires mute on stream open, which
            // we don't want to flag.)
            if (get().state !== 'recording') return;
            muteStartMs = Date.now();
          });
          track.addEventListener('unmute', () => {
            if (muteStartMs === null) return;
            const gap = Date.now() - muteStartMs;
            muteStartMs = null;
            internals.totalHiddenMs += gap;
            internals.hiddenIntervals.push({
              startMs: muteStartMs ?? Date.now() - gap,
              endMs: Date.now(),
            });
            // Same threshold as visibility — a sub-1.5s blip isn't worth
            // surfacing.
            if (gap > 1500) {
              set({
                hasBeenInterrupted: true,
                totalInterruptedMs: internals.totalHiddenMs,
              });
            }
          });
          track.addEventListener('ended', () => {
            // Mic permanently lost (revoked permission, hardware unplugged).
            // Setting error here surfaces the failure UI — user can retry
            // or cancel.
            if (get().state === 'recording' || get().state === 'paused') {
              set({
                error:
                  'The microphone became unavailable. Another app may have taken it, the device was unplugged, or permission was revoked. Stop and re-record when the mic is available again.',
                stopReason: 'error',
              });
            }
          });
        }
        const mime = pickMimeType();
        const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          audioBitsPerSecond: 32_000,
        });
        // Generate the recording id NOW so each chunk gets persisted with a
        // stable key. Recovery on next app load reassembles chunks by this id.
        const recordingId = generateRecordingId();
        internals.mediaRecorder = recorder;
        internals.chunks = [];
        internals.seq = 0;
        recorder.ondataavailable = (e) => {
          if (e.data.size === 0) return;
          internals.chunks.push(e.data);
          // Persist the chunk to IndexedDB so a tab crash mid-visit doesn't
          // lose audio. Fire-and-forget — the in-memory copy is the primary
          // path; persistence is a safety net.
          const seq = internals.seq;
          internals.seq += 1;
          appendAudioChunk(recordingId, seq, e.data).catch((err) => {
            console.warn('brtlb: chunk persistence failed', err);
            // QuotaExceededError means the browser's storage quota is full.
            // The recording still has the in-memory blob, but the safety net
            // is gone. Surface it so the user can decide to stop and free space.
            const isQuota =
              (err instanceof DOMException && err.name === 'QuotaExceededError') ||
              (err instanceof Error && /quota/i.test(err.message));
            if (isQuota && !get().storageError) {
              set({
                storageError:
                  'Device storage is full — chunk backup paused. The current recording still works in memory, but a tab crash from here on could lose audio. Stop and delete old recordings to free space.',
              });
            }
          });
        };
        recorder.start(1000);
        internals.accumulatedMs = 0;
        internals.lastHiddenAt = null;
        internals.totalHiddenMs = 0;
        internals.hiddenIntervals = [];
        // Stamp voice activity at start so the silence timer doesn't fire
        // immediately on a brand-new (and thus far silent) recording.
        internals.lastVoiceActivityAt = Date.now();
        set({
          elapsedMs: 0,
          state: 'recording',
          bookmarks: [],
          activeRecordingId: recordingId,
          hasBeenInterrupted: false,
          totalInterruptedMs: 0,
          silenceWarningStartedAt: null,
          silenceAutoStopRequested: false,
          stopReason: null,
        });
        startTicker();
        startMeter(stream);
        void logAudit('record_started', { recordingId });

        // Best-effort screen wake lock so accidental auto-lock doesn't kill
        // the recording. Granted when supported (iOS 16.4+, Android Chrome
        // 84+); silently no-ops elsewhere.
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
          (
            navigator as Navigator & {
              wakeLock: { request: (type: string) => Promise<WakeLockSentinel> };
            }
          ).wakeLock
            .request('screen')
            .then((sentinel) => {
              internals.wakeLock = sentinel;
            })
            .catch((err: unknown) => {
              console.warn('brtlb: wake lock denied', err);
            });
        }

        // Detect screen lock / app backgrounding mid-recording. We use a
        // chunk-count check on return to decide whether audio was actually
        // lost: MediaRecorder emits a chunk every ~1s, and on iOS the tab
        // fully suspends with no chunks during the hidden window. So if
        // seq stayed flat across the hidden period, audio was lost. If it
        // increased, MediaRecorder kept running underneath (e.g., desktop
        // browser with display sleep, or some Android cases) and there's
        // no real loss — we suppress the banner to avoid false alarms.
        let seqAtHide: number | null = null;
        const handler = () => {
          if (document.hidden) {
            internals.lastHiddenAt = Date.now();
            seqAtHide = internals.seq;
            // Best-effort vibration alert. Android responds; iOS ignores.
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try {
                navigator.vibrate([400, 100, 400]);
              } catch {
                // some browsers throw on policy violation; not load-bearing
              }
            }
          } else if (internals.lastHiddenAt !== null && seqAtHide !== null) {
            const gap = Date.now() - internals.lastHiddenAt;
            const chunksDuringHide = internals.seq - seqAtHide;
            internals.lastHiddenAt = null;
            seqAtHide = null;
            // Only treat as real loss if MediaRecorder produced no chunks
            // during the hidden window AND the window was >1.5s. Sub-1.5s
            // is noise either way; chunk activity during the window means
            // audio kept capturing.
            if (gap > 1500 && chunksDuringHide === 0) {
              internals.totalHiddenMs += gap;
              internals.hiddenIntervals.push({
                startMs: Date.now() - gap,
                endMs: Date.now(),
              });
              set({
                hasBeenInterrupted: true,
                totalInterruptedMs: internals.totalHiddenMs,
              });
            }
          }
        };
        document.addEventListener('visibilitychange', handler);
        internals.visibilityHandler = handler;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'microphone access failed';
        set({ error: msg, state: 'idle' });
      }
    },

    pause() {
      const recorder = internals.mediaRecorder;
      if (!recorder || recorder.state !== 'recording') return;
      recorder.pause();
      internals.accumulatedMs += Date.now() - internals.startTs;
      stopTicker();
      stopMeter();
      set({ state: 'paused' });
    },

    resume() {
      const recorder = internals.mediaRecorder;
      if (!recorder || recorder.state !== 'paused') return;
      recorder.resume();
      startTicker();
      if (internals.stream) startMeter(internals.stream);
      set({ state: 'recording' });
    },

    async stop(): Promise<Blob | null> {
      const recorder = internals.mediaRecorder;
      if (!recorder) return null;
      // If no other code path has already claimed credit (silence autostop,
      // error handler) then this stop was user-initiated.
      if (get().stopReason === null) {
        set({ stopReason: 'user' });
      }
      return new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(internals.chunks, { type: mimeType });
          internals.chunks = [];
          internals.stream?.getTracks().forEach((t) => t.stop());
          internals.stream = null;
          internals.mediaRecorder = null;
          stopTicker();
          stopMeter();
          if (recorder.state !== 'inactive' && get().state === 'recording') {
            internals.accumulatedMs += Date.now() - internals.startTs;
          }
          set({ elapsedMs: internals.accumulatedMs, state: 'stopped' });
          const recId = get().activeRecordingId;
          if (recId) {
            void logAudit('record_completed', {
              recordingId: recId,
              n: Math.round(internals.accumulatedMs / 1000),
            });
          }
          resolve(blob);
        };
        recorder.stop();
      });
    },

    reset() {
      // Clean up any leftovers and return to idle so the next session is fresh.
      // Also clear any persisted chunks for the active id — they're either
      // already in the saved blob (handleStop path) or being explicitly
      // discarded (handleCancel path).
      stopTicker();
      stopMeter();
      internals.stream?.getTracks().forEach((t) => t.stop());
      internals.stream = null;
      internals.mediaRecorder = null;
      internals.chunks = [];
      internals.seq = 0;
      internals.accumulatedMs = 0;
      // Release wake lock + visibility listener.
      if (internals.wakeLock && !internals.wakeLock.released) {
        internals.wakeLock.release().catch(() => {});
      }
      internals.wakeLock = null;
      if (internals.visibilityHandler) {
        document.removeEventListener('visibilitychange', internals.visibilityHandler);
        internals.visibilityHandler = null;
      }
      internals.lastHiddenAt = null;
      internals.totalHiddenMs = 0;
      internals.hiddenIntervals = [];
      internals.lastVoiceActivityAt = 0;
      const previousId = get().activeRecordingId;
      if (previousId) {
        clearAudioChunks(previousId).catch(() => {});
      }
      set({
        state: 'idle',
        elapsedMs: 0,
        level: 0,
        error: null,
        bookmarks: [],
        activeRecordingId: null,
        hasBeenInterrupted: false,
        totalInterruptedMs: 0,
        storageError: null,
        silenceWarningStartedAt: null,
        silenceAutoStopRequested: false,
        stopReason: null,
        silenceCheckPaused: false,
      });
    },

    setSilenceCheckPaused(paused: boolean) {
      const wasPaused = get().silenceCheckPaused;
      if (wasPaused === paused) return;
      if (!paused) {
        // Coming out of pause: give a fresh window so we don't fire
        // immediately on the first tick.
        internals.lastVoiceActivityAt = Date.now();
        set({ silenceCheckPaused: false, silenceWarningStartedAt: null });
        return;
      }
      set({ silenceCheckPaused: true });
    },

    dismissSilenceWarning() {
      // User tapped "Keep recording" — reset the voice timer so the
      // banner doesn't re-fire for another full IDLE_WARNING_AFTER_MS.
      internals.lastVoiceActivityAt = Date.now();
      set({ silenceWarningStartedAt: null });
    },

    addBookmark(label) {
      const s = get();
      if (s.state !== 'recording' && s.state !== 'paused') return;
      const trimmed = label?.trim();
      const bookmark: Bookmark = {
        ms: s.elapsedMs,
        label: trimmed ? trimmed : null,
      };
      set({ bookmarks: [...s.bookmarks, bookmark] });
    },
  };
});
