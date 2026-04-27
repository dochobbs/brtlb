import { create } from 'zustand';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecordingMode = 'ambient' | 'dictation';

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
  // Internals are stored on the store object but never trigger re-renders.
  _internals: RecorderInternals;
  start: (mode?: RecordingMode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob | null>;
  reset: () => void;
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
    if (typeof window === 'undefined' || !window.AudioContext) return;
    const ctx = new window.AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    internals.audioCtx = ctx;
    internals.analyser = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
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
      set({ level: Math.min(1, rms * 2) });
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
        set({ elapsedMs: 0, state: 'recording' });
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
      set({ state: 'idle', elapsedMs: 0, level: 0, error: null });
    },
  };
});
