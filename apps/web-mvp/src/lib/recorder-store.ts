import { create } from 'zustand';
import { appendAudioChunk, clearAudioChunks, logAudit } from './db';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecordingMode = 'ambient' | 'dictation';

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
}

interface WakeLockSentinel extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

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
  // Internals are stored on the store object but never trigger re-renders.
  _internals: RecorderInternals;
  start: (mode?: RecordingMode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob | null>;
  reset: () => void;
  addBookmark: (label?: string) => void;
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
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    _internals: internals,

    async start(mode = 'ambient') {
      // Idempotent if already recording.
      if (get().state === 'recording') return;
      set({ error: null, mode });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        internals.stream = stream;
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
          });
        };
        recorder.start(1000);
        internals.accumulatedMs = 0;
        internals.lastHiddenAt = null;
        internals.totalHiddenMs = 0;
        internals.hiddenIntervals = [];
        set({
          elapsedMs: 0,
          state: 'recording',
          bookmarks: [],
          activeRecordingId: recordingId,
          hasBeenInterrupted: false,
          totalInterruptedMs: 0,
        });
        startTicker();
        startMeter(stream);
        void logAudit('record_started', { recordingId });

        // Best-effort screen wake lock so accidental auto-lock doesn't kill
        // the recording. Granted when supported (iOS 16.4+, Android Chrome
        // 84+); silently no-ops elsewhere.
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
          (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock
            .request('screen')
            .then((sentinel) => {
              internals.wakeLock = sentinel;
            })
            .catch((err: unknown) => {
              console.warn('brtlb: wake lock denied', err);
            });
        }

        // Detect screen lock / app backgrounding mid-recording. The user
        // can't see a visual warning when the screen is off, but we can:
        //  1. Try to vibrate (Android only, no-op on iOS)
        //  2. Track wall-clock time spent hidden so we can report the
        //     gap when the user returns
        //  3. Set a flag the UI can read on resume to show a clear warning
        const handler = () => {
          if (document.hidden) {
            internals.lastHiddenAt = Date.now();
            // Best-effort vibration alert. Android responds; iOS ignores.
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try {
                navigator.vibrate([400, 100, 400]);
              } catch {
                // some browsers throw on policy violation; not load-bearing
              }
            }
          } else if (internals.lastHiddenAt !== null) {
            const gap = Date.now() - internals.lastHiddenAt;
            internals.totalHiddenMs += gap;
            internals.hiddenIntervals.push({
              startMs: internals.lastHiddenAt,
              endMs: Date.now(),
            });
            internals.lastHiddenAt = null;
            // Only flag interruptions over 1.5s to avoid noise from quick
            // app-switch peeks that didn't actually disrupt audio.
            if (gap > 1500) {
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
      });
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
