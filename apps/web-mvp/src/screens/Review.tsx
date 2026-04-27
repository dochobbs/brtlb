import { useEffect, useState } from 'react';
import { Button } from '@brtlb/ui';
import { useAppStore } from '../store';
import {
  deleteRecording,
  getAudio,
  getRecording,
  putRecording,
  type RecordingMeta,
} from '../lib/db';
import { runMvpPipeline, type PipelineStage } from '../lib/pipeline-browser';

const STAGE_LABEL: Record<PipelineStage, string> = {
  uploading: 'Uploading audio…',
  transcribing: 'Transcribing with diarization…',
  generating: 'Generating note…',
  done: 'Done',
  failed: 'Failed',
};

export function Review() {
  const { settings, currentRecordingId, setView } = useAppStore();
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [editedNote, setEditedNote] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!currentRecordingId) {
      setView('home');
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = await getRecording(currentRecordingId);
      if (!m) {
        setView('home');
        return;
      }
      if (cancelled) return;
      setMeta(m);
      setEditedNote(m.noteMarkdown ?? '');
      if (m.stage === 'recorded') {
        await runPipelineForRecording(m);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecordingId]);

  async function runPipelineForRecording(m: RecordingMeta): Promise<void> {
    setError(null);
    const audio = await getAudio(m.id);
    if (!audio) {
      setError(
        m.audioPurgedAt
          ? `Audio was auto-purged on ${new Date(m.audioPurgedAt).toLocaleString()} (privacy retention). Transcript and note are still available, but you can no longer regenerate.`
          : 'Audio not found in storage.',
      );
      return;
    }
    try {
      const out = await runMvpPipeline({
        audio,
        mode: m.mode,
        settings,
        onStage: setStage,
      });
      const transcriptText = out.transcript.utterances
        .map((u) => `[${u.role ?? 'Speaker ' + u.speakerId}] ${u.text}`)
        .join('\n');
      const updated: RecordingMeta = {
        ...m,
        stage: 'ready_for_review',
        transcriptText,
        noteMarkdown: out.note,
        providerUsed: out.providerUsed,
      };
      await putRecording(updated);
      setMeta(updated);
      setEditedNote(out.note);
      setStage('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'pipeline failed';
      setError(msg);
      setStage('failed');
      const failed: RecordingMeta = { ...m, stage: 'failed', errorMessage: msg };
      await putRecording(failed);
      setMeta(failed);
    }
  }

  async function handleSaveEdits(): Promise<void> {
    if (!meta) return;
    const updated: RecordingMeta = { ...meta, noteMarkdown: editedNote };
    await putRecording(updated);
    setMeta(updated);
  }

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(editedNote);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload(): void {
    if (!meta) return;
    const blob = new Blob([editedNote], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brtlb-${meta.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(): Promise<void> {
    if (!meta) return;
    const ok = window.confirm('Delete this recording, transcript, and note?');
    if (!ok) return;
    await deleteRecording(meta.id);
    setView('home');
  }

  async function handleRetry(): Promise<void> {
    if (!meta) return;
    setStage('uploading');
    await runPipelineForRecording({ ...meta, stage: 'recorded' });
  }

  if (!meta) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-graphite-soft">Loading…</p>
      </main>
    );
  }

  const isProcessing =
    stage !== null && stage !== 'done' && stage !== 'failed' && meta.stage !== 'ready_for_review';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView('home')}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          ← All recordings
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-sm text-graphite-soft hover:text-red-700"
        >
          Delete
        </button>
      </header>

      {isProcessing ? (
        <div className="mb-6 rounded-md border border-graphite-soft/20 bg-seafoam-pale p-4 text-sm text-graphite">
          {stage ? STAGE_LABEL[stage] : 'Working…'}
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 space-y-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Pipeline failed</p>
          <p className="font-mono text-xs">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-graphite-soft">
            Transcript
          </h2>
          {meta.transcriptText ? (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-graphite">
              {meta.transcriptText}
            </pre>
          ) : (
            <p className="text-sm text-graphite-soft">No transcript yet.</p>
          )}
        </section>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-graphite-soft">Note</h2>
            {meta.providerUsed ? (
              <span className="text-xs text-graphite-soft">via {meta.providerUsed}</span>
            ) : null}
          </div>
          <textarea
            value={editedNote}
            onChange={(e) => setEditedNote(e.target.value)}
            onBlur={handleSaveEdits}
            disabled={isProcessing}
            placeholder={isProcessing ? 'Working…' : 'No note yet.'}
            className="min-h-[400px] w-full resize-y rounded-md border border-graphite-soft/20 bg-white p-3 font-mono text-sm leading-relaxed text-graphite focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={handleCopy} disabled={!editedNote}>
              {copied ? 'Copied' : 'Copy as Markdown'}
            </Button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!editedNote}
              className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
            >
              Download .md
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
