import { useState } from 'react';
import { Button, DotsMark } from '@brtlb/ui';
import { useAppStore } from '../store';
import { useRecorder } from '../components/Recorder';
import { putAudio, putRecording, type RecordingMeta } from '../lib/db';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function Record() {
  const { setView, selectRecording } = useAppStore();
  const { state, elapsedMs, level, error, start, pause, resume, stop } = useRecorder();
  const [mode, setMode] = useState<'ambient' | 'dictation'>('ambient');
  const [saving, setSaving] = useState(false);

  async function handleStop(): Promise<void> {
    setSaving(true);
    const blob = await stop();
    if (!blob) {
      setSaving(false);
      return;
    }
    const id = generateId();
    const meta: RecordingMeta = {
      id,
      createdAt: new Date().toISOString(),
      durationMs: elapsedMs,
      mode,
      stage: 'recorded',
      errorMessage: null,
      transcriptText: null,
      noteMarkdown: null,
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: null,
    };
    await putAudio(id, blob);
    await putRecording(meta);
    selectRecording(id);
    setView('review');
  }

  function handleCancel(): void {
    if (state === 'recording' || state === 'paused') {
      stop().catch(() => {});
    }
    setView('home');
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <button
        type="button"
        onClick={handleCancel}
        className="absolute left-4 top-4 text-sm text-graphite-soft hover:text-graphite"
      >
        ← Cancel
      </button>

      {state === 'idle' && !error ? (
        <div className="max-w-md space-y-6">
          <DotsMark size={64} />
          <h1 className="text-2xl font-semibold text-graphite">Ready to record</h1>
          <div className="inline-flex rounded-md border border-graphite-soft/30 p-0.5">
            {(['ambient', 'dictation'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  'rounded px-4 py-1.5 text-sm font-medium transition ' +
                  (mode === m ? 'bg-graphite text-white' : 'text-graphite-soft hover:text-graphite')
                }
              >
                {m === 'ambient' ? 'Ambient' : 'Dictation'}
              </button>
            ))}
          </div>
          <p className="text-sm text-graphite-soft">
            {mode === 'ambient'
              ? 'Captures the full room. Speakers are diarized.'
              : 'Provider-only dictation. No diarization.'}
          </p>
          <Button onClick={start}>Start recording</Button>
        </div>
      ) : null}

      {error ? (
        <div className="max-w-md space-y-4">
          <p className="text-base font-medium text-red-700">{error}</p>
          <p className="text-sm text-graphite-soft">
            Make sure you've granted microphone permission and that no other tab is using the mic.
          </p>
          <Button onClick={start}>Try again</Button>
        </div>
      ) : null}

      {(state === 'recording' || state === 'paused') && !error ? (
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-graphite-soft">
              {mode === 'ambient' ? 'Ambient' : 'Dictation'} ·{' '}
              {state === 'paused' ? 'Paused' : 'Recording'}
            </p>
            <p className="mt-2 font-mono text-5xl font-semibold tabular-nums text-graphite">
              {formatElapsed(elapsedMs)}
            </p>
          </div>

          <div className="flex h-24 items-center justify-center gap-1">
            {Array.from({ length: 24 }).map((_, i) => {
              const threshold = (i + 1) / 24;
              const active = level >= threshold;
              return (
                <span
                  key={i}
                  className={
                    'block w-1.5 rounded-full transition-all duration-75 ' +
                    (active ? 'bg-seafoam' : 'bg-graphite-soft/15')
                  }
                  style={{ height: `${20 + i * 2.5}%` }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-3">
            {state === 'recording' ? (
              <button
                type="button"
                onClick={pause}
                className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist"
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={resume}
                className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist"
              >
                Resume
              </button>
            )}
            <Button onClick={handleStop}>{saving ? 'Saving…' : 'Stop'}</Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
