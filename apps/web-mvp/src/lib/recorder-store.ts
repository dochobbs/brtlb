import { create } from 'zustand';

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
  startTs: number;
  accumulatedMs: number;
  tickerId: number | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  rafId: number | null;
}

interface RecorderStore {
  state: RecorderState;
  mode: RecordingMode;
  elapsedMs: number;
  level: number;
  error: string | null;
  bookmarks: Bookmark[];
  // Internals are stored on the store object but never trigger re-renders.
  _internals: RecorderInternals;
  start: (mode?: RecordingMode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob | null>;
  reset: () => void;
  addBookmark: (label?: string) => void;
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
    startTs: 0,
    accumulatedMs: 0,
    tickerId: null,
    audioCtx: null,
    analyser: null,
    rafId: null,
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
        internals.mediaRecorder = recorder;
        internals.chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) internals.chunks.push(e.data);
        };
        recorder.start(1000);
        internals.accumulatedMs = 0;
        set({ elapsedMs: 0, state: 'recording', bookmarks: [] });
        startTicker();
        startMeter(stream);
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
          resolve(blob);
        };
        recorder.stop();
      });
    },

    reset() {
      // Clean up any leftovers and return to idle so the next session is fresh.
      stopTicker();
      stopMeter();
      internals.stream?.getTracks().forEach((t) => t.stop());
      internals.stream = null;
      internals.mediaRecorder = null;
      internals.chunks = [];
      internals.accumulatedMs = 0;
      set({ state: 'idle', elapsedMs: 0, level: 0, error: null, bookmarks: [] });
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
