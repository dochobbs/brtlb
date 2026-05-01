import { useState } from 'react';
import { Button, DotsMark } from '@brtlb/ui';
import { useAppStore } from '../store';
import { useRecorderStore } from '../lib/recorder-store';
import { putAudio, putRecording, type RecordingMeta, type RecordingBookmark } from '../lib/db';
import type { RecorderState, RecordingMode } from '../lib/recorder-store';

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
        <LiveRecordingView
          mode={mode}
          state={state}
          elapsedMs={elapsedMs}
          level={level}
          bookmarks={bookmarks}
          saving={saving}
          onPause={pause}
          onResume={resume}
          onMark={addBookmark}
          onStop={handleStop}
        />
      ) : null}
    </main>
  );
}

interface LiveRecordingViewProps {
  mode: RecordingMode;
  state: RecorderState;
  elapsedMs: number;
  level: number;
  bookmarks: RecordingBookmark[];
  saving: boolean;
  onPause: () => void;
  onResume: () => void;
  onMark: () => void;
  onStop: () => void;
}

/**
 * Recording UI tuned for the exam room. Ambient mode (patient in the room
 * watching the screen) is subtle by default — small status dot, modest
 * timer, calm breathing line. No animated VU meter unless the physician
 * explicitly asks for it via the "Mic check" link.
 *
 * Dictation mode (no patient) defaults to the full meter since there's
 * no audience to make uncomfortable.
 */
function LiveRecordingView(props: LiveRecordingViewProps) {
  const isAmbient = props.mode === 'ambient';
  const [showMeter, setShowMeter] = useState(!isAmbient);

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-graphite-soft">
          <span
            aria-hidden
            className={
              'inline-block h-2 w-2 rounded-full ' +
              (props.state === 'paused'
                ? 'bg-graphite-soft/40'
                : 'animate-pulse bg-red-500')
            }
          />
          {props.mode === 'ambient' ? 'Ambient' : 'Dictation'} ·{' '}
          {props.state === 'paused' ? 'Paused' : 'Recording'}
        </p>
        <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-graphite">
          {formatElapsed(props.elapsedMs)}
        </p>
      </div>

      {showMeter ? (
        <div className="flex h-16 items-center justify-center gap-1">
          {Array.from({ length: 24 }).map((_, i) => {
            const threshold = (i + 1) / 24;
            const active = props.level >= threshold;
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
      ) : (
        // Single calm horizontal line that breathes with the audio level.
        // Conveys "mic is alive" without an attention-grabbing bouncing
        // meter that a patient in the room would notice.
        <div className="flex h-2 items-center justify-center" aria-hidden>
          <div
            className="h-0.5 rounded-full bg-graphite-soft/30 transition-all duration-150"
            style={{
              width: `${20 + Math.min(60, props.level * 80)}%`,
              opacity: 0.4 + Math.min(0.5, props.level),
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {props.state === 'recording' ? (
          <button
            type="button"
            onClick={props.onPause}
            className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onResume}
            className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={props.onMark}
          className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist active:bg-seafoam-pale"
          title="Tap to mark this moment — brtlb will pay special attention here"
        >
          Mark moment
        </button>
        <Button onClick={props.onStop}>{props.saving ? 'Saving…' : 'Stop'}</Button>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setShowMeter((v) => !v)}
          className="text-[11px] text-graphite-soft underline-offset-2 hover:underline"
        >
          {showMeter ? 'Hide mic meter' : 'Mic check'}
        </button>
      </div>

      {props.bookmarks.length > 0 ? (
        <div className="text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-graphite-soft">
            Marked moments
          </p>
          <ul className="mt-1 space-y-1 text-xs text-graphite-soft">
            {props.bookmarks.map((b, i) => (
              <li key={i}>
                <span className="font-mono">{formatElapsed(b.ms)}</span>
                {b.label ? ` — ${b.label}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
