import { useEffect, useState } from 'react';
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
  const hasBeenInterrupted = useRecorderStore((s) => s.hasBeenInterrupted);
  const totalInterruptedMs = useRecorderStore((s) => s.totalInterruptedMs);
  const storageError = useRecorderStore((s) => s.storageError);
  const silenceWarningStartedAt = useRecorderStore((s) => s.silenceWarningStartedAt);
  const silenceAutoStopRequested = useRecorderStore((s) => s.silenceAutoStopRequested);
  const start = useRecorderStore((s) => s.start);
  const pause = useRecorderStore((s) => s.pause);
  const resume = useRecorderStore((s) => s.resume);
  const stop = useRecorderStore((s) => s.stop);
  const reset = useRecorderStore((s) => s.reset);
  const addBookmark = useRecorderStore((s) => s.addBookmark);
  const dismissSilenceWarning = useRecorderStore((s) => s.dismissSilenceWarning);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Wraps a promise with a timeout so a stalled IDB write or recorder.onstop
  // can't strand the UI on "Saving recording…" forever. Times out after 15s.
  function withTimeout<T>(p: Promise<T>, label: string, ms = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  async function handleStop(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      // Capture stopReason BEFORE awaiting stop() — the recorder clears
      // it on the next start() and we want the value set during this stop.
      const stopReason = useRecorderStore.getState().stopReason ?? 'user';
      const blob = await withTimeout(stop(), 'recorder.stop');
      if (!blob) {
        setSaving(false);
        return;
      }
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
        templateId: mode === 'dictation' ? 'dictation' : 'soap',
        patternId: 'narrative',
        providerUsed: null,
        label: null,
        bookmarks: bookmarks.length > 0 ? [...bookmarks] : undefined,
        stopReason,
      };
      await withTimeout(putAudio(id, blob), 'putAudio');
      await withTimeout(putRecording(meta), 'putRecording');
      selectRecording(id);
      reset();
      setView('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error during save';
      console.warn('brtlb: save failed', err);
      setSaveError(msg);
      setSaving(false);
    }
  }

  async function handleForceDiscard(): Promise<void> {
    // Last-resort recovery if IDB is wedged. Reset the recorder, drop the
    // pending state, and bounce the user home. The audio chunks persisted
    // mid-recording are still in IDB and will surface as "recovered" on
    // next app load via recoverOrphanedRecordings — so they don't lose
    // anything permanently.
    setSaveError(null);
    setSaving(false);
    reset();
    setView('home');
  }

  function handleCancel(): void {
    if (state === 'recording' || state === 'paused') {
      stop().catch(() => {});
    }
    reset();
    setView('home');
  }

  // The store flags `silenceAutoStopRequested` when 30 min idle + 60 s
  // grace expires. We can't auto-stop from inside the store because the
  // save flow (putAudio + putRecording + setView) lives here. Watch the
  // flag and route through handleStop, which already saves cleanly.
  useEffect(() => {
    if (!silenceAutoStopRequested) return;
    if (state !== 'recording' && state !== 'paused') return;
    void handleStop();
    // handleStop is intentionally not in deps — it's a stable closure
    // that captures the latest store getters via useRecorderStore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenceAutoStopRequested, state]);

  // Live-tick the grace-period countdown so the banner updates each
  // second. Without this, the displayed seconds-remaining freezes until
  // some other state change re-renders.
  const [graceTickHack, setGraceTickHack] = useState(0);
  useEffect(() => {
    if (silenceWarningStartedAt === null) return;
    const t = window.setInterval(() => setGraceTickHack((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [silenceWarningStartedAt]);
  void graceTickHack; // referenced so React keeps the state binding

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

      {!error && saving ? <SavingState /> : null}

      {!error && saveError ? (
        <div className="w-full max-w-md space-y-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Couldn't save the recording</p>
          <p className="font-mono text-xs break-all">{saveError}</p>
          <p className="text-xs text-red-700/90">
            The audio chunks captured during recording are still on this device — they'll surface as
            a "recovered" recording on the home screen next time you load brtlb.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStop}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleForceDiscard}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Cancel and go home
            </button>
          </div>
        </div>
      ) : null}

      {!error && !saving && isLive ? (
        <LiveRecordingView
          mode={mode}
          state={state}
          elapsedMs={elapsedMs}
          level={level}
          bookmarks={bookmarks}
          saving={saving}
          hasBeenInterrupted={hasBeenInterrupted}
          totalInterruptedMs={totalInterruptedMs}
          storageError={storageError}
          silenceWarningStartedAt={silenceWarningStartedAt}
          onKeepRecording={dismissSilenceWarning}
          onStopFromSilence={handleStop}
          onPause={pause}
          onResume={resume}
          onMark={addBookmark}
          onStop={handleStop}
        />
      ) : null}
    </main>
  );
}

function SavingState() {
  // After ~3 seconds, show a "taking longer than usual" hint. Saves should
  // be sub-second normally; if we're past 3s it means IDB is congested
  // (large audio blob, slow disk, or a wedged transaction). User gets
  // visibility instead of staring at a static spinner.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="w-full max-w-md text-center">
      <p className="inline-flex items-center gap-2 text-sm text-graphite-soft">
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-seafoam" />
        Saving recording…
      </p>
      {slow ? (
        <p className="mt-2 text-xs text-graphite-soft">
          Taking longer than usual. Don't close this tab — the audio is still being written.
        </p>
      ) : null}
    </div>
  );
}

interface LiveRecordingViewProps {
  mode: RecordingMode;
  state: RecorderState;
  elapsedMs: number;
  level: number;
  bookmarks: RecordingBookmark[];
  saving: boolean;
  hasBeenInterrupted: boolean;
  totalInterruptedMs: number;
  storageError: string | null;
  silenceWarningStartedAt: number | null;
  onKeepRecording: () => void;
  onStopFromSilence: () => void;
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

  // Grace-window seconds remaining for the auto-stop countdown. Recomputed
  // each render — Record.tsx's interval forces a re-render every second
  // while the warning is active so this counts down visibly.
  const silenceSecondsLeft =
    props.silenceWarningStartedAt !== null
      ? Math.max(0, 60 - Math.floor((Date.now() - props.silenceWarningStartedAt) / 1000))
      : 0;

  return (
    <div className="w-full max-w-md space-y-6">
      {props.silenceWarningStartedAt !== null ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">No voice detected for 30 minutes</p>
          <p className="mt-1">
            Looks like the visit ended. Auto-stopping in {silenceSecondsLeft} second
            {silenceSecondsLeft === 1 ? '' : 's'}. The audio captured up to now will be saved.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onKeepRecording}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Keep recording
            </button>
            <button
              type="button"
              onClick={props.onStopFromSilence}
              className="rounded-md bg-graphite px-3 py-1.5 text-xs font-medium text-white hover:bg-graphite-soft"
            >
              Stop now
            </button>
          </div>
        </div>
      ) : null}
      {props.storageError ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-left text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">Device storage full</p>
          <p className="mt-1">{props.storageError}</p>
        </div>
      ) : null}
      {props.hasBeenInterrupted ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-left text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">
            Recording was interrupted — {Math.round(props.totalInterruptedMs / 1000)}s of audio lost
          </p>
          <p className="mt-1">
            Audio captured before and after is intact. Keep the screen on for the rest of the visit,
            or stop now and re-record.
          </p>
        </div>
      ) : isAmbient ? (
        <div className="rounded-md border border-seafoam bg-seafoam/20 p-2.5 text-left text-xs leading-relaxed text-graphite">
          <p>
            <span className="font-medium">Heads up:</span> keep the screen on for the whole visit —
            recording stops if you lock the phone or switch apps.
          </p>
        </div>
      ) : null}

      <div className="text-center">
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-graphite-soft">
          <span
            aria-hidden
            className={
              'inline-block h-2 w-2 rounded-full ' +
              (props.state === 'paused' ? 'bg-graphite-soft/40' : 'animate-pulse bg-red-500')
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
