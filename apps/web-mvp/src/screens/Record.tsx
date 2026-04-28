import { useState } from 'react';
import { Button, DotsMark } from '@brtlb/ui';
import { useAppStore } from '../store';
import { useRecorderStore } from '../lib/recorder-store';
import { putAudio, putRecording, type RecordingMeta } from '../lib/db';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}


export function Record() {
  const { setView, selectRecording } = useAppStore();
  const state = useRecorderStore((s) => s.state);
  const elapsedMs = useRecorderStore((s) => s.elapsedMs);
  const level = useRecorderStore((s) => s.level);
  const error = useRecorderStore((s) => s.error);
  const mode = useRecorderStore((s) => s.mode);
  const bookmarks = useRecorderStore((s) => s.bookmarks);
  const activeRecordingId = useRecorderStore((s) => s.activeRecordingId);
  const start = useRecorderStore((s) => s.start);
  const pause = useRecorderStore((s) => s.pause);
  const resume = useRecorderStore((s) => s.resume);
  const stop = useRecorderStore((s) => s.stop);
  const reset = useRecorderStore((s) => s.reset);
  const addBookmark = useRecorderStore((s) => s.addBookmark);

  const [saving, setSaving] = useState(false);

  async function handleStop(): Promise<void> {
    setSaving(true);
    const blob = await stop();
    if (!blob) {
      setSaving(false);
      return;
    }
    // Use the id the recorder-store generated at start time so persisted
    // audio chunks are tied to the same id we save the final blob under.
    const id =
      activeRecordingId ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const meta: RecordingMeta = {
      id,
      createdAt: new Date().toISOString(),
      durationMs: elapsedMs,
      mode,
      stage: 'recorded',
      errorMessage: null,
      transcriptText: null,
      noteMarkdown: null,
      // Dictation mode → dictation template by default; ambient → SOAP.
      templateId: mode === 'dictation' ? 'dictation' : 'soap',
      patternId: 'narrative',
      providerUsed: null,
      label: null,
      bookmarks: bookmarks.length > 0 ? [...bookmarks] : undefined,
    };
    await putAudio(id, blob);
    await putRecording(meta);
    selectRecording(id);
    reset();
    setView('review');
  }

  function handleCancel(): void {
    if (state === 'recording' || state === 'paused') {
      stop().catch(() => {});
    }
    reset();
    setView('home');
  }

  const isLive = state === 'recording' || state === 'paused';

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 text-center sm:px-6 sm:py-12">
      <button
        type="button"
        onClick={handleCancel}
        className="absolute left-4 top-4 text-sm text-graphite-soft hover:text-graphite"
      >
        ← Cancel
      </button>

      {error ? (
        <div className="max-w-md space-y-4">
          <p className="text-base font-medium text-red-700">{error}</p>
          <p className="text-sm text-graphite-soft">
            Make sure you've granted microphone permission and that no other tab is using the mic.
          </p>
          <Button onClick={() => start(mode)}>Try again</Button>
        </div>
      ) : null}

      {!error && state === 'idle' ? (
        <div className="w-full max-w-md space-y-5">
          <DotsMark size={56} />
          <h1 className="text-2xl font-semibold text-graphite">Ready when you are</h1>
          <div className="inline-flex rounded-md border border-graphite-soft/30 p-0.5">
            {(['ambient', 'dictation'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => start(m)}
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
              ? 'Captures the full room with speaker diarization.'
              : 'Provider-only dictation. No diarization.'}
          </p>
          <Button onClick={() => start(mode)}>Start recording</Button>
        </div>
      ) : null}

      {!error && isLive ? (
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

          <div className="flex flex-wrap items-center justify-center gap-3">
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
            <button
              type="button"
              onClick={() => addBookmark()}
              className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist active:bg-seafoam-pale"
              title="Tap to mark this moment — brtlb will pay special attention here"
            >
              Mark moment
            </button>
            <Button onClick={handleStop}>{saving ? 'Saving…' : 'Stop'}</Button>
          </div>

          {bookmarks.length > 0 ? (
            <div className="mt-4 text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-graphite-soft">
                Marked moments
              </p>
              <ul className="mt-1 space-y-1 text-xs text-graphite-soft">
                {bookmarks.map((b, i) => (
                  <li key={i}>
                    <span className="font-mono">{formatElapsed(b.ms)}</span>
                    {b.label ? ` — ${b.label}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
