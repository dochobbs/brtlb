import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface UseRecorderResult {
  state: RecorderState;
  elapsedMs: number;
  level: number; // 0..1
  error: string | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob | null>;
}

export function useRecorder(): UseRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopMeter();
      stopTicker();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [stopMeter, stopTicker],
  );

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] ?? 128) - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length) / 128;
      setLevel(Math.min(1, rms * 2));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startTicker = useCallback(() => {
    startTsRef.current = Date.now();
    tickerRef.current = window.setInterval(() => {
      const live = Date.now() - startTsRef.current;
      setElapsedMs(accumulatedRef.current + live);
    }, 200);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm';
      // 32 kbps opus is plenty for clear voice and keeps Blobs small enough
      // to round-trip through IndexedDB without bumping into quota limits.
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 32_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      accumulatedRef.current = 0;
      setElapsedMs(0);
      startTicker();
      startMeter(stream);
      setState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'microphone access failed';
      setError(msg);
      setState('idle');
    }
  }, [startTicker, startMeter]);

  const pause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    accumulatedRef.current += Date.now() - startTsRef.current;
    stopTicker();
    stopMeter();
    setState('paused');
  }, [stopTicker, stopMeter]);

  const resume = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    startTicker();
    if (streamRef.current) startMeter(streamRef.current);
    setState('recording');
  }, [startTicker, startMeter]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;
    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        stopTicker();
        stopMeter();
        if (recorder.state !== 'inactive' && state === 'recording') {
          accumulatedRef.current += Date.now() - startTsRef.current;
        }
        setElapsedMs(accumulatedRef.current);
        setState('stopped');
        resolve(blob);
      };
      recorder.stop();
    });
  }, [state, stopMeter, stopTicker]);

  return { state, elapsedMs, level, error, start, pause, resume, stop };
}
