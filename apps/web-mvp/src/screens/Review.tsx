import { useEffect, useMemo, useState } from 'react';
import { Button } from '@brtlb/ui';
import { listTemplates } from '@brtlb/prompts';
import type { Transcript } from '@brtlb/pipeline';
import { useAppStore } from '../store';
import {
  deleteRecording,
  getAudio,
  getRecording,
  putRecording,
  type RecordingMeta,
  type SpeakerRoleAssignment,
} from '../lib/db';
import {
  captureQuotes,
  generateClinicalPearls,
  regenerateNoteFromTranscript,
  reviewNoteQuality,
  runMvpPipeline,
  tweakNote,
  type PipelineStage,
} from '../lib/pipeline-browser';
import { redactKeysInText } from '../lib/redact';
import { Markdown, remarkGfm } from '../lib/markdown';
import { SpeakerChips } from '../components/SpeakerChips';

const STAGE_LABEL: Record<PipelineStage, string> = {
  uploading: 'Uploading audio…',
  transcribing: 'Transcribing with diarization…',
  generating: 'Generating note…',
  done: 'Done',
  failed: 'Failed',
};

const BUILTIN_TEMPLATES = listTemplates();

const ROLE_DISPLAY: Record<string, string> = {
  parent: 'Parent',
  patient: 'Patient',
  provider: 'Provider',
  sibling: 'Sibling',
  other: 'Other',
};

function renderTranscriptText(transcript: Transcript, roles: SpeakerRoleAssignment[]): string {
  const map = new Map(roles.map((r) => [r.speakerId, r.role]));
  return transcript.utterances
    .map((u) => {
      const role = map.get(u.speakerId);
      const label = role ? ROLE_DISPLAY[role] : `Speaker ${u.speakerId}`;
      return `[${label}] ${u.text}`;
    })
    .join('\n');
}

export function Review() {
  const { settings, currentRecordingId, setView } = useAppStore();
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [editedNote, setEditedNote] = useState<string>('');
  const [editedLabel, setEditedLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('soap');
  const [speakerRoles, setSpeakerRoles] = useState<SpeakerRoleAssignment[]>([]);
  const [noteView, setNoteView] = useState<'edit' | 'preview'>('edit');
  const [qaReview, setQaReview] = useState<string | null>(null);
  const [qaRunning, setQaRunning] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [tweakInstruction, setTweakInstruction] = useState<string>('');
  const [tweaking, setTweaking] = useState(false);
  const [pearls, setPearls] = useState<string | null>(null);
  const [pearlsRunning, setPearlsRunning] = useState(false);
  const [pearlsError, setPearlsError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<string | null>(null);
  const [quotesRunning, setQuotesRunning] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);

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
      setEditedLabel(m.label ?? '');
      setSelectedTemplateId(m.templateId || 'soap');
      setSpeakerRoles(m.speakerRoles ?? []);
      setQaReview(m.qaReviewMarkdown ?? null);
      setPearls(m.pearlsMarkdown ?? null);
      setQuotes(m.quotesMarkdown ?? null);
      if (m.stage === 'recorded') {
        await runPipelineForRecording(m);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecordingId]);

  const transcript = useMemo<Transcript | null>(() => {
    if (!meta?.transcriptJson) return null;
    try {
      return JSON.parse(meta.transcriptJson) as Transcript;
    } catch {
      return null;
    }
  }, [meta?.transcriptJson]);

  const speakerIds = useMemo<string[]>(() => {
    if (!transcript) return [];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const u of transcript.utterances) {
      if (!seen.has(u.speakerId)) {
        seen.add(u.speakerId);
        order.push(u.speakerId);
      }
    }
    return order;
  }, [transcript]);

  const renderedTranscript = useMemo<string>(() => {
    if (transcript) return renderTranscriptText(transcript, speakerRoles);
    return meta?.transcriptText ?? '';
  }, [transcript, speakerRoles, meta?.transcriptText]);

  async function runPipelineForRecording(m: RecordingMeta): Promise<void> {
    setError(null);
    const audio = await getAudio(m.id);
    if (!audio) {
      setError(
        m.audioPurgedAt
          ? `Audio was auto-purged on ${new Date(m.audioPurgedAt).toLocaleString()} (privacy retention). Transcript and note are still available, but you can no longer regenerate from audio.`
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
        templateId: m.templateId || (m.mode === 'dictation' ? 'dictation' : 'soap'),
        patternId: m.patternId || 'narrative',
        speakerRoles: m.speakerRoles ?? [],
        bookmarks: m.bookmarks ?? [],
      });
      // Apply the auto-suggested label only when the user hasn't already
      // typed one — never overwrite their explicit choice.
      const existingLabel = (m.label ?? '').trim();
      const newLabel =
        existingLabel.length > 0
          ? existingLabel
          : out.suggestedLabel
            ? out.suggestedLabel
            : (m.label ?? null);

      const updated: RecordingMeta = {
        ...m,
        stage: 'ready_for_review',
        label: newLabel,
        transcriptText: renderTranscriptText(out.transcript, m.speakerRoles ?? []),
        transcriptJson: JSON.stringify(out.transcript),
        noteMarkdown: out.note,
        providerUsed: out.providerUsed,
        templateId: out.templateId,
        patientSegments: out.patientSegments.map((s) => ({
          id: s.id,
          patientLabel: s.patientLabel,
          visitType: s.visitType,
          includesPreventiveCare: s.includesPreventiveCare,
          acuteConcerns: s.acuteConcerns,
          chiefComplaint: s.chiefComplaint,
          relevantUtteranceIndices: s.relevantUtteranceIndices,
        })),
        transcriptChapters: out.transcriptChapters,
      };
      await putRecording(updated);
      setMeta(updated);
      setSelectedTemplateId(out.templateId);
      setEditedNote(out.note);
      // If the auto-label was applied, mirror it into the editable label
      // field so the user sees it populated rather than empty.
      if (newLabel && (!existingLabel || existingLabel.length === 0)) {
        setEditedLabel(newLabel);
      }
      setStage('done');
    } catch (err) {
      const msg = redactKeysInText(err instanceof Error ? err.message : 'pipeline failed');
      setError(msg);
      setStage('failed');
      const failed: RecordingMeta = { ...m, stage: 'failed', errorMessage: msg };
      await putRecording(failed);
      setMeta(failed);
    }
  }

  async function persistMeta(patch: Partial<RecordingMeta>): Promise<void> {
    if (!meta) return;
    const updated: RecordingMeta = { ...meta, ...patch };
    await putRecording(updated);
    setMeta(updated);
  }

  async function handleSaveLabel(): Promise<void> {
    const trimmed = editedLabel.trim();
    if ((meta?.label ?? '') === trimmed) return;
    await persistMeta({ label: trimmed || null });
  }

  async function handleSaveEdits(): Promise<void> {
    if (!meta) return;
    if (meta.noteMarkdown === editedNote) return;
    await persistMeta({ noteMarkdown: editedNote });
  }

  async function handleSpeakerRolesChange(next: SpeakerRoleAssignment[]): Promise<void> {
    setSpeakerRoles(next);
    if (!meta) return;
    // Keep the rendered transcript text aligned with the new role labels
    const nextTranscriptText = transcript
      ? renderTranscriptText(transcript, next)
      : meta.transcriptText;
    await persistMeta({ speakerRoles: next, transcriptText: nextTranscriptText });
  }

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(editedNote);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare(): Promise<void> {
    if (!meta) return;
    // Use a generic title — the user's label may contain patient name / DOB
    // / other PHI, and the Web Share title is visible to every recipient app
    // (AirDrop preview, Messages thread title, Mail subject, etc.). The
    // note text in `text` is the actual content; the title is just chrome.
    const title = 'brtlb visit note';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: editedNote });
        return;
      } catch {
        // user cancelled or share failed — fall through to copy
      }
    }
    await handleCopy();
  }

  function markdownToPlainText(md: string): string {
    return md
      // Strip fenced code blocks but keep their content.
      .replace(/```[a-zA-Z0-9]*\n?/g, '')
      // Drop heading hashes; keep the heading text.
      .replace(/^#{1,6}\s+/gm, '')
      // Bold / italic / inline code wrappers.
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      // Bullet list markers → "- " stays readable; ordered list stays.
      .replace(/^\s*[-*+]\s+/gm, '- ')
      // Markdown links [text](url) → text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      // Collapse triple+ blank lines.
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function handleDownload(): void {
    if (!meta) return;
    const plain = markdownToPlainText(editedNote);
    const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stem = meta.label
      ? meta.label
          .replace(/[^a-z0-9-_ ]/gi, '')
          .replace(/\s+/g, '-')
          .toLowerCase()
      : meta.id;
    a.download = `brtlb-${stem}.txt`;
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

  async function handleRegenerate(): Promise<void> {
    if (!meta) return;
    if (!transcript) {
      setError(
        'No structured transcript saved for this recording. Re-run the full pipeline (Retry) to capture one.',
      );
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const out = await regenerateNoteFromTranscript({
        transcript,
        mode: meta.mode,
        settings,
        templateId: selectedTemplateId,
        speakerRoles,
        bookmarks: meta.bookmarks ?? [],
        patientSegments: meta.patientSegments?.map((s) => ({
          id: s.id,
          patientLabel: s.patientLabel,
          visitType: s.visitType,
          includesPreventiveCare: s.includesPreventiveCare,
          acuteConcerns: s.acuteConcerns,
          chiefComplaint: s.chiefComplaint,
          relevantUtteranceIndices: s.relevantUtteranceIndices,
        })),
      });
      await persistMeta({
        templateId: selectedTemplateId,
        noteMarkdown: out.note,
        providerUsed: out.providerUsed,
        qaReviewMarkdown: null,
        qaReviewedAt: null,
        pearlsMarkdown: null,
        pearlsAt: null,
      });
      setEditedNote(out.note);
      setQaReview(null);
      setPearls(null);
    } catch (err) {
      const msg = redactKeysInText(err instanceof Error ? err.message : 'regenerate failed');
      setError(msg);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleQualityCheck(): Promise<void> {
    if (!meta || !transcript || !editedNote) return;
    setQaRunning(true);
    setQaError(null);
    try {
      const out = await reviewNoteQuality({
        note: editedNote,
        transcript,
        mode: meta.mode,
        settings,
        speakerRoles,
      });
      setQaReview(out);
      const stamp = new Date().toISOString();
      await persistMeta({ qaReviewMarkdown: out, qaReviewedAt: stamp });
    } catch (err) {
      setQaError(redactKeysInText(err instanceof Error ? err.message : 'quality check failed'));
    } finally {
      setQaRunning(false);
    }
  }

  async function handleTweak(): Promise<void> {
    if (!meta || !transcript || !editedNote) return;
    const instruction = tweakInstruction.trim();
    if (!instruction) return;
    setTweaking(true);
    setError(null);
    try {
      const revised = await tweakNote({
        note: editedNote,
        transcript,
        mode: meta.mode,
        settings,
        instruction,
        speakerRoles,
      });
      await persistMeta({
        noteMarkdown: revised,
        // any tweak invalidates a prior QA pass + pearls
        qaReviewMarkdown: null,
        qaReviewedAt: null,
        pearlsMarkdown: null,
        pearlsAt: null,
      });
      setEditedNote(revised);
      setQaReview(null);
      setPearls(null);
      setTweakInstruction('');
    } catch (err) {
      setError(redactKeysInText(err instanceof Error ? err.message : 'tweak failed'));
    } finally {
      setTweaking(false);
    }
  }

  async function handleQuotes(): Promise<void> {
    if (!meta || !transcript) return;
    setQuotesRunning(true);
    setQuotesError(null);
    try {
      const out = await captureQuotes({
        transcript,
        mode: meta.mode,
        settings,
        speakerRoles,
      });
      setQuotes(out);
      const stamp = new Date().toISOString();
      await persistMeta({ quotesMarkdown: out, quotesAt: stamp });
    } catch (err) {
      setQuotesError(redactKeysInText(err instanceof Error ? err.message : 'quotes failed'));
    } finally {
      setQuotesRunning(false);
    }
  }

  async function handlePearls(): Promise<void> {
    if (!meta || !transcript || !editedNote) return;
    setPearlsRunning(true);
    setPearlsError(null);
    try {
      const out = await generateClinicalPearls({
        note: editedNote,
        transcript,
        mode: meta.mode,
        settings,
        speakerRoles,
      });
      setPearls(out);
      const stamp = new Date().toISOString();
      await persistMeta({ pearlsMarkdown: out, pearlsAt: stamp });
    } catch (err) {
      setPearlsError(redactKeysInText(err instanceof Error ? err.message : 'pearls failed'));
    } finally {
      setPearlsRunning(false);
    }
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
  const canRegenerate = Boolean(transcript) && !isProcessing && !regenerating;
  const templateChanged = selectedTemplateId !== meta.templateId;
  const rolesChanged = JSON.stringify(speakerRoles) !== JSON.stringify(meta.speakerRoles ?? []);
  const showRegenerate = templateChanged || rolesChanged;

  return (
    <main className="mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-12">
      <header className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
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

      <input
        type="text"
        value={editedLabel}
        onChange={(e) => setEditedLabel(e.target.value)}
        onBlur={handleSaveLabel}
        placeholder="Add a visit label (e.g., MM age 4 WCV)"
        className="mb-4 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-medium text-graphite placeholder:text-graphite-soft/60 hover:border-graphite-soft/20 focus:border-graphite-soft/40 focus:outline-none sm:text-lg"
      />

      {isProcessing ? (
        <div className="mb-4 rounded-md border border-graphite-soft/20 bg-seafoam-pale p-3 text-sm text-graphite sm:mb-6 sm:p-4">
          {stage ? STAGE_LABEL[stage] : 'Working…'}
        </div>
      ) : null}

      {meta.patientSegments && meta.patientSegments.length > 1 ? (
        <div className="mb-4 rounded-md border border-seafoam/40 bg-seafoam-pale/40 p-3 text-sm text-graphite sm:mb-6 sm:p-4">
          <p className="font-medium">
            {meta.patientSegments.length} patients detected in this recording:
          </p>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs text-graphite-soft">
            {meta.patientSegments.map((s) => {
              const visitTypeLabel = s.visitType
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
              const concerns =
                s.acuteConcerns.length > 0 ? ` — ${s.acuteConcerns.join(', ')}` : '';
              return (
                <li key={s.id}>
                  <span className="font-medium text-graphite">{s.patientLabel}</span>
                  <span> · {visitTypeLabel}{concerns}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-graphite-soft">
            One section per patient appears in the note below, separated by a horizontal rule.
            Copy the section you need into the matching chart.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 space-y-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 sm:mb-6 sm:p-4">
          <p className="font-medium">Something went wrong</p>
          <p className="font-mono text-xs break-all">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry from audio
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-graphite-soft">
            Transcript
          </h2>
          {speakerIds.length > 0 ? (
            <div className="mb-3">
              <SpeakerChips
                speakerIds={speakerIds}
                assignments={speakerRoles}
                onChange={handleSpeakerRolesChange}
                disabled={isProcessing || regenerating}
              />
              <p className="mt-2 text-xs text-graphite-soft">
                Tap a chip to assign a role. The transcript and the next regenerate will use it.
              </p>
            </div>
          ) : null}
          {meta.bookmarks && meta.bookmarks.length > 0 ? (
            <div className="mb-3 rounded-md border border-seafoam/40 bg-seafoam-pale/30 p-2">
              <p className="text-xs font-medium uppercase tracking-wide text-graphite-soft">
                Marked moments
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-graphite">
                {meta.bookmarks.map((b, i) => {
                  const totalSec = Math.floor(b.ms / 1000);
                  const min = Math.floor(totalSec / 60);
                  const sec = totalSec % 60;
                  const stamp = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
                  return (
                    <li key={i}>
                      <span className="font-mono">{stamp}</span>
                      {b.label ? ` — ${b.label}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {meta.transcriptChapters && meta.transcriptChapters.length > 0 ? (
            <div className="mb-3 rounded-md border border-graphite-soft/20 bg-mist/40 p-2">
              <p className="text-xs font-medium uppercase tracking-wide text-graphite-soft">
                Visit chapters
              </p>
              <ol className="mt-1 space-y-1 text-xs text-graphite">
                {meta.transcriptChapters.map((c, i) => {
                  const totalSec = Math.floor(c.startMs / 1000);
                  const h = Math.floor(totalSec / 3600);
                  const m = Math.floor((totalSec % 3600) / 60);
                  const stamp =
                    h > 0
                      ? `${h}:${m.toString().padStart(2, '0')}`
                      : `${m}:${(totalSec % 60).toString().padStart(2, '0')}`;
                  return (
                    <li key={i}>
                      <span className="font-mono text-graphite-soft">{stamp}</span>
                      <span className="ml-2 font-medium">{c.label}</span>
                      {c.summary ? (
                        <span className="ml-1 text-graphite-soft"> — {c.summary}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
          {renderedTranscript ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-sm font-medium text-graphite-soft hover:text-graphite">
                <span className="inline group-open:hidden">Show transcript</span>
                <span className="hidden group-open:inline">Hide transcript</span>
              </summary>
              <pre className="mt-3 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-graphite-soft/20 bg-mist/40 p-3 text-sm leading-relaxed text-graphite">
                {renderedTranscript}
              </pre>
            </details>
          ) : (
            <p className="text-sm text-graphite-soft">No transcript yet.</p>
          )}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-graphite-soft">Note</h2>
            {meta.providerUsed ? (
              <span className="text-xs text-graphite-soft">via {meta.providerUsed}</span>
            ) : null}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-graphite-soft">Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              disabled={isProcessing || regenerating}
              className="rounded-md border border-graphite-soft/30 bg-white px-2 py-1 text-xs text-graphite focus:border-graphite focus:outline-none"
            >
              <optgroup label="Built-in">
                {BUILTIN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              {settings.customTemplates.length > 0 ? (
                <optgroup label="Yours">
                  {settings.customTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={!canRegenerate || !showRegenerate}
              className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1 text-xs font-medium text-graphite hover:bg-mist disabled:opacity-50"
              title={
                !transcript
                  ? 'No structured transcript saved'
                  : showRegenerate
                    ? 'Regenerate the note with the current template + speaker roles'
                    : 'Change template or speaker roles to enable'
              }
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <div className="ml-auto inline-flex rounded-md border border-graphite-soft/30 p-0.5">
              {(
                [
                  ['edit', 'Edit'],
                  ['preview', 'Formatted'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setNoteView(v)}
                  className={
                    'rounded px-2 py-1 text-xs font-medium transition ' +
                    (noteView === v
                      ? 'bg-graphite text-white'
                      : 'text-graphite-soft hover:text-graphite')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {noteView === 'edit' ? (
            <textarea
              value={editedNote}
              onChange={(e) => setEditedNote(e.target.value)}
              onBlur={handleSaveEdits}
              disabled={isProcessing || regenerating}
              placeholder={isProcessing ? 'Working…' : 'No note yet.'}
              className="min-h-[280px] w-full resize-y rounded-md border border-graphite-soft/20 bg-white p-3 font-mono text-sm leading-relaxed text-graphite focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite sm:min-h-[400px]"
            />
          ) : editedNote ? (
            <div className="prose min-h-[280px] max-w-none overflow-y-auto rounded-md border border-graphite-soft/20 bg-white p-3 text-sm leading-relaxed text-graphite sm:min-h-[400px]">
              <Markdown remarkPlugins={[remarkGfm]}>{editedNote}</Markdown>
            </div>
          ) : (
            <div className="min-h-[280px] rounded-md border border-graphite-soft/20 bg-white p-3 text-sm text-graphite-soft sm:min-h-[400px]">
              No note yet.
            </div>
          )}

          {/* Natural-language edit — the hero interaction. Tell brtlb what to change in plain English. */}
          {transcript && editedNote ? (
            <div className="mt-4 rounded-xl border border-seafoam/40 bg-seafoam-pale/40 p-3 sm:p-4">
              <label className="block text-sm font-semibold text-graphite">
                Tell brtlb what to change
              </label>
              <p className="mt-0.5 text-xs text-graphite-soft">
                Plain English. Press ⌘/Ctrl + Enter to send.
              </p>
              <textarea
                value={tweakInstruction}
                onChange={(e) => setTweakInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !tweaking) {
                    e.preventDefault();
                    handleTweak();
                  }
                }}
                disabled={tweaking}
                rows={2}
                placeholder='e.g., "shorten the assessment", "rewrite plan as a numbered list", "add return precautions for fever"'
                className="mt-2 w-full resize-y rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite placeholder:text-graphite-soft/60 focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
              />
              <div className="mt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleTweak}
                  disabled={tweaking || !tweakInstruction.trim()}
                  className="rounded-md bg-graphite px-4 py-2 text-sm font-medium text-white hover:bg-graphite-soft disabled:opacity-50"
                >
                  {tweaking ? 'Revising…' : 'Revise note'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={handleShare} disabled={!editedNote}>
              Share
            </Button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!editedNote}
              className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
            >
              {copied ? 'Copied' : 'Copy text'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!editedNote}
              className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
            >
              Download
            </button>
          </div>

          {/* QA review — Roci-style note-vs-transcript safety check */}
          {transcript && editedNote ? (
            <div className="mt-4 rounded-md border border-graphite-soft/20 bg-mist p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-graphite-soft">
                    Review warnings
                  </label>
                  <p className="text-xs text-graphite-soft">
                    {meta.qaReviewedAt
                      ? `Last reviewed ${new Date(meta.qaReviewedAt).toLocaleString()}.`
                      : 'Flags risks of hallucination (note says something the transcript doesn’t support) and omission (transcript content missing from the note).'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleQualityCheck}
                  disabled={qaRunning}
                  className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist disabled:opacity-50"
                >
                  {qaRunning ? 'Checking…' : meta.qaReviewMarkdown ? 'Re-run' : 'Check for warnings'}
                </button>
              </div>
              {qaError ? (
                <p className="mt-2 text-xs text-red-700">{qaError}</p>
              ) : qaReview ? (
                <div className="prose mt-3 max-w-none rounded-md border border-graphite-soft/20 bg-white p-3 text-sm leading-relaxed text-graphite">
                  <Markdown remarkPlugins={[remarkGfm]}>{qaReview}</Markdown>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Quote capture — verbatim parent / child quotes worth preserving */}
          {transcript ? (
            <div className="mt-4 rounded-md border border-graphite-soft/20 bg-mist p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-graphite-soft">
                    Quotes captured
                  </label>
                  <p className="text-xs text-graphite-soft">
                    {meta.quotesAt
                      ? `Generated ${new Date(meta.quotesAt).toLocaleString()}.`
                      : 'Verbatim parent / patient quotes worth preserving — useful for HPI, safety screens, and the medicolegal record.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleQuotes}
                  disabled={quotesRunning}
                  className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist disabled:opacity-50"
                >
                  {quotesRunning ? 'Capturing…' : meta.quotesMarkdown ? 'Re-run' : 'Capture quotes'}
                </button>
              </div>
              {quotesError ? (
                <p className="mt-2 text-xs text-red-700">{quotesError}</p>
              ) : quotes ? (
                <div className="prose mt-3 max-w-none rounded-md border border-graphite-soft/20 bg-white p-3 text-sm leading-relaxed text-graphite">
                  <Markdown remarkPlugins={[remarkGfm]}>{quotes}</Markdown>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Clinical pearls — Roci-style 0-3 collegial observations */}
          {transcript && editedNote ? (
            <div className="mt-4 rounded-md border border-graphite-soft/20 bg-mist p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-graphite-soft">
                    Clinical pearls
                  </label>
                  <p className="text-xs text-graphite-soft">
                    {meta.pearlsAt
                      ? `Generated ${new Date(meta.pearlsAt).toLocaleString()}.`
                      : 'Helpful observations surfaced from the visit — patterns, differentials, family dynamics worth noting.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePearls}
                  disabled={pearlsRunning}
                  className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist disabled:opacity-50"
                >
                  {pearlsRunning ? 'Generating…' : meta.pearlsMarkdown ? 'Re-generate' : 'Generate pearls'}
                </button>
              </div>
              {pearlsError ? (
                <p className="mt-2 text-xs text-red-700">{pearlsError}</p>
              ) : pearls ? (
                <div className="prose mt-3 max-w-none rounded-md border border-graphite-soft/20 bg-white p-3 text-sm leading-relaxed text-graphite">
                  <Markdown remarkPlugins={[remarkGfm]}>{pearls}</Markdown>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
