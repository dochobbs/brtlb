import { useEffect, useMemo, useState } from 'react';
import { Button } from '@brtlb/ui';
import { listTemplates } from '@brtlb/prompts';
import type { Transcript } from '@brtlb/pipeline';
import { useAppStore } from '../store';
import {
  deleteRecording,
  getAudio,
  getRecording,
  logAudit,
  putRecording,
  type RecordingMeta,
  type SpeakerRoleAssignment,
} from '../lib/db';
import {
  captureQuotes,
  filterTranscriptForSegment,
  generateClinicalPearls,
  regenerateNoteFromTranscript,
  regenerateSinglePatientNote,
  reviewNoteQuality,
  runMvpPipeline,
  tweakNote,
  type PipelineStage,
} from '../lib/pipeline-browser';
import { redactKeysInText } from '../lib/redact';
import { Markdown, remarkGfm } from '../lib/markdown';
import { SpeakerChips } from '../components/SpeakerChips';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  copyNoteRich,
  mailtoForNote,
  markdownToPlainText as exportMarkdownToPlainText,
  spliceMultiPatientNote,
  splitConcatenatedMultiPatientNote,
  splitNoteIntoSections,
  type PatientNoteChunk,
} from '../lib/note-export';

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

function GuidedPaste(props: {
  sections: { label: string; body: string }[];
  idx: number;
  onCopy: () => void;
  onJump: (i: number) => void;
  copiedSet: Set<string>;
  copiedJustNow: string | null;
}) {
  const { sections, idx, onCopy, onJump, copiedSet, copiedJustNow } = props;
  const total = sections.length;
  const done = idx >= total;
  const current = sections[Math.min(idx, total - 1)];

  if (done) {
    return (
      <div className="mt-2">
        <p className="text-sm text-emerald-700">✓ All {total} sections copied. Nice work.</p>
        <button
          type="button"
          onClick={() => onJump(0)}
          className="mt-2 text-xs text-graphite-soft underline-offset-2 hover:underline"
        >
          Start over
        </button>
      </div>
    );
  }

  if (!current) return null;
  const justCopied = copiedJustNow === current.label;
  const wordCount = current.body.split(/\s+/).filter(Boolean).length;

  return (
    <div className="mt-2 space-y-2.5">
      <div className="flex items-center justify-between text-[11px] text-graphite-soft">
        <span>
          Section {idx + 1} of {total}
        </span>
        <span>~{wordCount} words</span>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={
          'flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition ' +
          (justCopied
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : 'border-graphite bg-graphite text-white hover:bg-graphite-soft')
        }
      >
        <span className="text-sm font-medium">
          {justCopied ? '✓ Copied — paste it now, then come back' : `Copy ${current.label}`}
        </span>
        <span aria-hidden className="text-base">
          {justCopied ? '✓' : '→'}
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 text-[11px] text-graphite-soft">
        <button
          type="button"
          onClick={() => onJump(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="hover:text-graphite disabled:opacity-40"
        >
          ← Previous
        </button>
        <div className="flex flex-1 justify-center gap-1">
          {sections.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onJump(i)}
              title={s.label}
              className={
                'h-1.5 w-5 rounded-full transition ' +
                (i === idx
                  ? 'bg-graphite'
                  : copiedSet.has(s.label)
                    ? 'bg-graphite/40'
                    : 'bg-graphite-soft/25')
              }
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onJump(Math.min(total, idx + 1))}
          className="hover:text-graphite"
        >
          Skip →
        </button>
      </div>
    </div>
  );
}

function EmptyTranscriptState(props: {
  stage: PipelineStage | null;
  recordingStage: RecordingMeta['stage'];
  isProcessing: boolean;
  onRetry: () => void;
}) {
  if (props.isProcessing) {
    const label =
      props.stage === 'uploading'
        ? 'Uploading audio…'
        : props.stage === 'transcribing'
          ? 'Transcribing… (this can take a minute on long visits)'
          : props.stage === 'generating'
            ? 'Transcript captured. Generating note…'
            : 'Working…';
    return <p className="text-sm text-graphite-soft">{label}</p>;
  }
  if (props.recordingStage === 'recorded') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-graphite-soft">
          Transcription hasn't started yet for this recording.
        </p>
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist"
        >
          Transcribe now
        </button>
      </div>
    );
  }
  if (props.recordingStage === 'ready_for_review') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-graphite-soft">
          The transcription pass returned no speech. Common causes: very quiet audio, mic permission
          denied mid-record, or a recording that happened to capture mostly silence.
        </p>
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist"
        >
          Retry from audio
        </button>
      </div>
    );
  }
  return <p className="text-sm text-graphite-soft">No transcript yet.</p>;
}

/**
 * Diagnostic-only export. Writes the stored transcriptJson to a .json
 * file so the raw STT output (utterances, speaker labels, confidence)
 * can be inspected outside the app — used to verify diarization quality
 * against the rendered note. Intentionally subtle in the UI; not user-
 * facing copy.
 */
function downloadTranscriptJson(meta: RecordingMeta): void {
  if (!meta.transcriptJson) return;
  const blob = new Blob([meta.transcriptJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const labelSlug = (meta.label || meta.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || meta.id;
  a.download = `transcript-${labelSlug}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  /** Set of section labels copied during this Review session — persists for guided paste. */
  const [copiedSections, setCopiedSections] = useState<Set<string>>(new Set());
  /** Index of the section the guided-paste flow is currently on. */
  const [guidedIdx, setGuidedIdx] = useState<number>(0);
  const [pasteMode, setPasteMode] = useState<'chips' | 'guided' | 'combined'>('combined');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [templateAppliedToast, setTemplateAppliedToast] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('soap');
  /** Active tab for multi-patient view. Either a segment id (p0, p1, …) or
   * the literal 'all' for the combined view. Ignored when patientSegments
   * has 1 or 0 entries. Defaults to the first patient on load — landing
   * on a scoped tab immediately makes the per-tab retargeting model
   * obvious. The 'All combined' tab is always there for global edits. */
  const [activeTab, setActiveTab] = useState<string>('all');
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
      // Land on the first patient's tab when this is a multi-patient
      // recording — the per-tab scope is the load-bearing UX, putting the
      // user on 'all' first hides it. Single-patient stays on 'all' (which
      // is just the whole note since there are no tabs).
      const firstSegId = m.patientSegments?.[0]?.id;
      if ((m.patientSegments?.length ?? 0) > 1 && firstSegId) {
        setActiveTab(firstSegId);
      } else {
        setActiveTab('all');
      }
      // Hydrate the error banner + retry buttons from the persisted state so
      // a failed recording reopened later (refresh, navigation back) still
      // shows the retry options. Without this, error stays null and the
      // retry block never renders.
      if (m.stage === 'failed' && m.errorMessage) {
        setError(m.errorMessage);
        setStage('failed');
      }
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

  // Multi-patient tabs derived at render time by splitting the concatenated
  // note on the '\n\n---\n\n' separator the pipeline emits. No data model
  // change: notes still stored as one string. Tabs disappear automatically
  // for single-patient recordings or when the chunk count doesn't match
  // the segment count (rare; could happen if the user manually deleted a
  // separator while editing).
  const segments = useMemo(() => meta?.patientSegments ?? [], [meta?.patientSegments]);
  const isMultiPatient = segments.length > 1;
  const noteChunks: PatientNoteChunk[] = useMemo(() => {
    if (!isMultiPatient) return [];
    return splitConcatenatedMultiPatientNote(editedNote, segments);
  }, [editedNote, segments, isMultiPatient]);
  const activeChunkIdx =
    isMultiPatient && activeTab !== 'all' ? noteChunks.findIndex((c) => c.id === activeTab) : -1;
  const activeChunk = activeChunkIdx >= 0 ? noteChunks[activeChunkIdx] : null;
  const activeSegment = activeChunk
    ? (segments.find((s) => s.id === activeChunk.id) ?? null)
    : null;
  /** The note string the user's actions (copy, share, email, download,
   * section paste, edit textarea) operate on. When a single-patient tab is
   * active, this is just that patient's section. Otherwise it's the full
   * note. */
  const effectiveNote = activeChunk ? activeChunk.body : editedNote;

  const noteSections = useMemo(() => splitNoteIntoSections(effectiveNote), [effectiveNote]);

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
      void logAudit('transcribe_started', { recordingId: m.id });
      const out = await runMvpPipeline({
        audio,
        mode: m.mode,
        settings,
        onStage: (s) => {
          setStage(s);
          if (s === 'generating') void logAudit('transcribe_completed', { recordingId: m.id });
        },
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
      void logAudit('generate_completed', { recordingId: m.id });
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
      // Distinguish transcription vs generation failure by which event happened
      // last. The error message itself is the source of truth for the user;
      // these are coarse-grained tags for the audit log only.
      void logAudit(/AssemblyAI|transcript/i.test(msg) ? 'transcribe_failed' : 'generate_failed', {
        recordingId: m.id,
      });
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

  function handleTabChange(tabId: string): void {
    if (tabId === activeTab) return;
    setActiveTab(tabId);
    // Section-paste progress is per-scope: switching from Tommy → Lily, the
    // user is starting Lily's paste flow fresh, not continuing Tommy's.
    setCopiedSections(new Set());
    setGuidedIdx(0);
    setCopiedSection(null);
  }

  function handleEditChange(next: string): void {
    // In a per-patient tab, the textarea is showing just that segment's
    // chunk. We splice it back into the full concatenated note so siblings'
    // sections stay intact, then update editedNote with the merged result.
    // On the 'all' tab (or single-patient), the value IS the full note.
    if (activeChunkIdx >= 0) {
      setEditedNote((prev) => spliceMultiPatientNote(prev, activeChunkIdx, next));
      return;
    }
    setEditedNote(next);
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
    // Prefer rich-text copy so bolded abnormal exam findings survive paste
    // into Elation / Word / any rich-text-aware destination. Falls back to
    // plain text on browsers that don't support ClipboardItem.
    const ok = await copyNoteRich(effectiveNote);
    if (!ok) {
      try {
        await navigator.clipboard.writeText(effectiveNote);
      } catch {
        return; // permission denied; show nothing rather than crash
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (meta) void logAudit('note_copied', { recordingId: meta.id });
  }

  async function handleCopySection(section: { label: string; body: string }): Promise<void> {
    // Per-section copy uses the same rich/plain dual-format trick so the
    // section pastes into the corresponding EHR field with bold preserved.
    const md = `**${section.label}**\n\n${section.body}`;
    const ok = await copyNoteRich(md);
    if (!ok) {
      try {
        await navigator.clipboard.writeText(`${section.label}\n\n${section.body}`);
      } catch {
        return;
      }
    }
    setCopiedSection(section.label);
    setCopiedSections((prev) => {
      const next = new Set(prev);
      next.add(section.label);
      return next;
    });
    setTimeout(() => setCopiedSection(null), 1500);
    if (meta) void logAudit('note_copied', { recordingId: meta.id });
  }

  async function handleGuidedCopy(): Promise<void> {
    const section = noteSections[guidedIdx];
    if (!section) return;
    await handleCopySection(section);
    // Auto-advance to the next section after a brief pause so the user sees
    // the ✓ acknowledgement before the button label changes.
    setTimeout(() => {
      setGuidedIdx((i) => Math.min(i + 1, noteSections.length));
    }, 450);
  }

  async function handleCopyCombined(): Promise<void> {
    // The bold section headings (**HPI**, **Plan**, etc.) carry the visual
    // structure on their own — no horizontal-rule separator needed. Plain
    // text fallback gets the same shape: heading, blank line, body, blank line.
    if (noteSections.length === 0) {
      await handleCopy();
      return;
    }
    const md = noteSections.map((s) => `**${s.label}**\n\n${s.body}`).join('\n\n');
    const ok = await copyNoteRich(md);
    if (!ok) {
      try {
        await navigator.clipboard.writeText(
          noteSections.map((s) => `${s.label}\n\n${s.body}`).join('\n\n'),
        );
      } catch {
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (meta) void logAudit('note_copied', { recordingId: meta.id });
  }

  function handleEmail(): void {
    if (!meta || !effectiveNote) return;
    const subject = (editedLabel || meta.label || 'brtlb visit note').trim();
    window.location.href = mailtoForNote(effectiveNote, subject);
    void logAudit('note_shared', { recordingId: meta.id });
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
        await navigator.share({ title, text: effectiveNote });
        if (meta) void logAudit('note_shared', { recordingId: meta.id });
        return;
      } catch {
        // user cancelled or share failed — fall through to copy
      }
    }
    await handleCopy();
  }

  function handleDownload(): void {
    if (!meta) return;
    const plain = exportMarkdownToPlainText(effectiveNote);
    const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseStem = meta.label
      ? meta.label
          .replace(/[^a-z0-9-_ ]/gi, '')
          .replace(/\s+/g, '-')
          .toLowerCase()
      : meta.id;
    // Per-tab downloads include the patient label so the file system
    // doesn't end up with three identical filenames after the user
    // downloads each kid's note from a sibling visit.
    const tabSuffix = activeChunk
      ? '-' +
        activeChunk.label
          .replace(/[^a-z0-9-_ ]/gi, '')
          .replace(/\s+/g, '-')
          .toLowerCase()
      : '';
    const stem = baseStem + tabSuffix;
    a.download = `brtlb-${stem}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    void logAudit('note_downloaded', { recordingId: meta.id });
  }

  function handleDelete(): void {
    setShowDeleteDialog(true);
  }

  async function confirmDelete(): Promise<void> {
    if (!meta) return;
    setShowDeleteDialog(false);
    await deleteRecording(meta.id);
    void logAudit('note_deleted', { recordingId: meta.id });
    setView('home');
  }

  async function handleRetry(): Promise<void> {
    if (!meta) return;
    setStage('uploading');
    await runPipelineForRecording({ ...meta, stage: 'recorded' });
  }

  /** True if the user has manually edited the note since it was generated. */
  function noteHasManualEdits(): boolean {
    if (!meta) return false;
    return (meta.noteMarkdown ?? '') !== editedNote;
  }

  function handleRegenerate(): void {
    if (!meta) return;
    if (!transcript) {
      setError(
        'No structured transcript saved for this recording. Re-run the full pipeline (Retry) to capture one.',
      );
      return;
    }
    if (noteHasManualEdits()) {
      setShowRegenConfirm(true);
      return;
    }
    void runRegenerate();
  }

  async function runRegenerate(): Promise<void> {
    if (!meta || !transcript) return;
    setShowRegenConfirm(false);
    setRegenerating(true);
    setError(null);
    try {
      // Per-patient regenerate: the active tab is one segment of a multi-
      // patient recording. Re-run the LLM for just that patient and splice
      // the result back into the concatenated note. Siblings' sections are
      // untouched — no re-pay for transcription, no risk of clobbering.
      if (activeSegment && activeChunkIdx >= 0) {
        const out = await regenerateSinglePatientNote({
          transcript,
          segment: activeSegment,
          mode: meta.mode,
          settings,
          templateId: selectedTemplateId,
          speakerRoles,
          bookmarks: meta.bookmarks ?? [],
        });
        const merged = spliceMultiPatientNote(editedNote, activeChunkIdx, out.segmentBody);
        await persistMeta({
          noteMarkdown: merged,
          providerUsed: out.providerUsed,
          qaReviewMarkdown: null,
          qaReviewedAt: null,
          pearlsMarkdown: null,
          pearlsAt: null,
        });
        setEditedNote(merged);
        setQaReview(null);
        setPearls(null);
        const builtIn = BUILTIN_TEMPLATES.find((t) => t.id === selectedTemplateId);
        const custom = settings.customTemplates.find((t) => t.id === selectedTemplateId);
        const name = builtIn?.name ?? custom?.name ?? selectedTemplateId;
        setTemplateAppliedToast(`Generated ${activeSegment.patientLabel} as ${name}`);
        setTimeout(() => setTemplateAppliedToast(null), 2500);
        return;
      }

      // 'All combined' tab (or single-patient): full regenerate.
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
      const builtIn = BUILTIN_TEMPLATES.find((t) => t.id === selectedTemplateId);
      const custom = settings.customTemplates.find((t) => t.id === selectedTemplateId);
      const name = builtIn?.name ?? custom?.name ?? selectedTemplateId;
      const scopeLabel = isMultiPatient ? 'all patients' : null;
      setTemplateAppliedToast(
        scopeLabel ? `Generated ${scopeLabel} as ${name}` : `Generated as ${name}`,
      );
      setTimeout(() => setTemplateAppliedToast(null), 2500);
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
      // Per-patient tweak: pre-scope the note + transcript to the active
      // segment, then splice the LLM's revision back into the concatenated
      // note. The other patients' sections are not in the prompt, so the
      // LLM physically cannot edit them.
      let revised: string;
      if (activeSegment && activeChunkIdx >= 0 && activeChunk) {
        const filtered = filterTranscriptForSegment(transcript, activeSegment);
        const segRevised = await tweakNote({
          note: activeChunk.body,
          transcript: filtered,
          mode: meta.mode,
          settings,
          instruction,
          speakerRoles,
        });
        revised = spliceMultiPatientNote(editedNote, activeChunkIdx, segRevised);
      } else {
        revised = await tweakNote({
          note: editedNote,
          transcript,
          mode: meta.mode,
          settings,
          instruction,
          speakerRoles,
          // 'All combined' tab on a multi-patient recording: the prompt
          // needs to know it's editing a multi-patient note so it preserves
          // every patient's section unless the instruction says otherwise.
          noteCoversMultiplePatients: isMultiPatient,
        });
      }
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
        <div className="flex items-center gap-4">
          {meta.transcriptJson ? (
            <button
              type="button"
              onClick={() => downloadTranscriptJson(meta)}
              title="Download the raw transcript JSON (for diagnostics)"
              className="text-xs text-graphite-soft/60 hover:text-graphite-soft"
            >
              raw json
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm text-graphite-soft hover:text-red-700"
          >
            Delete
          </button>
        </div>
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

      {isMultiPatient ? (
        <div className="mb-4 rounded-md border border-seafoam/40 bg-seafoam-pale/40 p-3 text-sm text-graphite sm:mb-6 sm:p-4">
          <p className="font-medium">
            {segments.length} patients detected. Tap a patient tab below to view, copy, or edit just
            that note.
          </p>
          <p className="mt-1 text-xs text-graphite-soft">
            The "All combined" tab shows every patient's note for one-shot copy. The active tab
            decides what Tweak, Regenerate, and the export buttons apply to.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 space-y-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 sm:mb-6 sm:p-4">
          <p className="font-medium">Something went wrong</p>
          <p className="font-mono text-xs break-all">{error}</p>
          <div className="flex flex-wrap gap-2">
            {transcript ? (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                title="Re-runs note generation only — uses the existing transcript, no new transcription cost."
              >
                {regenerating ? 'Retrying note…' : 'Retry note only'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
              title="Re-uploads the audio and re-transcribes from scratch."
            >
              Retry from audio
            </button>
          </div>
          {transcript ? (
            <p className="text-xs text-red-700/80">
              Transcript already exists — try note-only first to avoid re-paying transcription.
            </p>
          ) : null}
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
            <EmptyTranscriptState
              stage={stage}
              recordingStage={meta.stage}
              isProcessing={isProcessing}
              onRetry={handleRetry}
            />
          )}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-graphite-soft">Note</h2>
            {meta.providerUsed ? (
              <span className="text-xs text-graphite-soft">via {meta.providerUsed}</span>
            ) : null}
          </div>

          {isMultiPatient && noteChunks.length > 0 ? (
            <div
              role="tablist"
              aria-label="Patient tabs — switch to retarget Tweak, Regenerate, Copy, Share, Email, Download"
              className="-mx-1 mb-3 flex flex-wrap gap-1 overflow-x-auto pb-1"
            >
              {noteChunks.map((chunk) => {
                const isActive = activeTab === chunk.id;
                const visitTypeShort = chunk.visitType
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <button
                    key={chunk.id}
                    role="tab"
                    aria-selected={isActive}
                    type="button"
                    onClick={() => handleTabChange(chunk.id)}
                    className={
                      'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ' +
                      (isActive
                        ? 'border-graphite border-2 bg-seafoam/40 text-graphite font-semibold'
                        : 'border-graphite-soft/30 bg-white text-graphite hover:bg-mist')
                    }
                  >
                    {chunk.label}
                    <span className="text-[10px] text-graphite-soft">· {visitTypeShort}</span>
                  </button>
                );
              })}
              <button
                role="tab"
                aria-selected={activeTab === 'all'}
                type="button"
                onClick={() => handleTabChange('all')}
                className={
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ' +
                  (activeTab === 'all'
                    ? 'border-graphite border-2 bg-seafoam/40 text-graphite font-semibold'
                    : 'border-graphite-soft/30 bg-mist/60 text-graphite-soft hover:bg-mist')
                }
              >
                All combined
              </button>
            </div>
          ) : null}

          {isMultiPatient && activeChunk ? (
            <p className="mb-3 text-xs text-graphite-soft">
              <span className="font-medium text-graphite">Scoped to {activeChunk.label}.</span>{' '}
              Copy, Share, Email, Download, Tweak, and Regenerate apply to {activeChunk.label} only.
              Switch tabs to retarget.
            </p>
          ) : isMultiPatient && activeTab === 'all' ? (
            <p className="mb-3 text-xs text-graphite-soft">
              <span className="font-medium text-graphite">All-combined view.</span> Copy and export
              apply to every patient. Tweak edits across all patients (e.g.,{' '}
              <em>"add return precautions to all plans"</em>) — switch to a patient tab to scope
              edits.
            </p>
          ) : null}

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
              value={effectiveNote}
              onChange={(e) => handleEditChange(e.target.value)}
              onBlur={handleSaveEdits}
              disabled={isProcessing || regenerating}
              placeholder={isProcessing ? 'Working…' : 'No note yet.'}
              className="min-h-[280px] w-full resize-y rounded-md border border-graphite-soft/20 bg-white p-3 font-mono text-sm leading-relaxed text-graphite focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite sm:min-h-[400px]"
            />
          ) : effectiveNote ? (
            <div className="prose min-h-[280px] max-w-none overflow-y-auto rounded-md border border-graphite-soft/20 bg-white p-3 text-sm leading-relaxed text-graphite sm:min-h-[400px]">
              <Markdown remarkPlugins={[remarkGfm]}>{effectiveNote}</Markdown>
            </div>
          ) : (
            <div className="min-h-[280px] rounded-md border border-graphite-soft/20 bg-white p-3 text-sm text-graphite-soft sm:min-h-[400px]">
              No note yet.
            </div>
          )}

          {/* Natural-language edit — the hero interaction. Tell brtlb what to change in plain English. */}
          {transcript && editedNote ? (
            <div className="mt-4 rounded-xl border border-seafoam/40 bg-seafoam-pale/40 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="block text-sm font-semibold text-graphite">
                  Tell brtlb what to change
                </label>
                {isMultiPatient ? (
                  <span className="rounded-full bg-graphite px-2.5 py-0.5 text-[11px] font-medium text-white">
                    {activeChunk ? activeChunk.label : 'All 3'}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-graphite-soft">
                {isMultiPatient && activeChunk
                  ? `Edit applies to ${activeChunk.label} only. Switch to All combined for cross-patient edits.`
                  : isMultiPatient
                    ? 'Edit applies across all patients. Switch to a patient tab to scope.'
                    : 'Plain English. Press ⌘/Ctrl + Enter to send.'}
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

          <div className="mt-4 rounded-md border border-dashed border-graphite-soft/30 bg-mist/30 px-3 py-2 text-xs text-graphite-soft">
            <span className="font-medium text-graphite">Tip:</span> open brtlb and your EHR{' '}
            <span className="font-medium">side-by-side</span>. Easiest path on Chrome desktop:
            right-click brtlb's tab → <span className="font-medium">Split tab with…</span> → pick
            your EHR tab. Both stay in the same window, fastest paste loop. Window-snap or macOS
            Sequoia's Tile shortcut also work.
          </div>

          {noteSections.length >= 2 ? (
            <div className="mt-3 rounded-md border border-graphite-soft/20 bg-mist/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-graphite-soft">
                  Section paste
                </p>
                <div className="inline-flex rounded-full border border-graphite-soft/25 bg-white p-0.5 text-[11px]">
                  {(['chips', 'guided', 'combined'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setPasteMode(m);
                        if (m === 'guided') setGuidedIdx(0);
                      }}
                      className={
                        'rounded-full px-2.5 py-0.5 font-medium transition ' +
                        (pasteMode === m
                          ? 'bg-graphite text-white'
                          : 'text-graphite-soft hover:text-graphite')
                      }
                    >
                      {m === 'chips' ? 'Pick' : m === 'guided' ? 'Walk through' : 'All-in-one'}
                    </button>
                  ))}
                </div>
              </div>

              {pasteMode === 'chips' ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {noteSections.map((s) => {
                      const seenThisSession = copiedSections.has(s.label);
                      const justCopied = copiedSection === s.label;
                      return (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => handleCopySection(s)}
                          disabled={!editedNote}
                          className={
                            'rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 ' +
                            (justCopied
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : seenThisSession
                                ? 'border-graphite-soft/30 bg-white text-graphite-soft'
                                : 'border-graphite-soft/30 bg-white text-graphite hover:bg-mist')
                          }
                        >
                          {justCopied ? `✓ ${s.label}` : seenThisSession ? `✓ ${s.label}` : s.label}
                        </button>
                      );
                    })}
                  </div>
                  {copiedSections.size > 0 ? (
                    <p className="mt-2 text-[11px] text-graphite-soft">
                      {copiedSections.size} of {noteSections.length} copied
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-graphite-soft">
                      Tap to copy that section into your EHR's matching field. Bold formatting
                      preserved.
                    </p>
                  )}
                </>
              ) : pasteMode === 'guided' ? (
                <GuidedPaste
                  sections={noteSections}
                  idx={guidedIdx}
                  onCopy={handleGuidedCopy}
                  onJump={(i) => setGuidedIdx(i)}
                  copiedSet={copiedSections}
                  copiedJustNow={copiedSection}
                />
              ) : (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleCopyCombined}
                    disabled={!editedNote}
                    className="rounded-md bg-graphite px-4 py-2 text-sm font-medium text-white hover:bg-graphite-soft disabled:opacity-50"
                  >
                    {copied ? '✓ Copied' : 'Copy whole note'}
                  </button>
                  <p className="mt-2 text-[11px] text-graphite-soft">
                    Bold section headings keep the structure visible when pasted into a single
                    field. Switch to <em>Pick</em> or <em>Walk through</em> if your EHR has separate
                    fields per section.
                  </p>
                </div>
              )}
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
              title="Copies with bold formatting preserved when the destination supports it"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleEmail}
              disabled={!editedNote}
              className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
              title="Opens your mail app with the note pre-filled. Only safe if your email provider is HIPAA-BAA-covered."
            >
              Email…
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

          <details className="mt-3 rounded-md border border-graphite-soft/20 p-2.5 text-xs">
            <summary className="cursor-pointer text-graphite-soft hover:text-graphite">
              Move this note to another device
            </summary>
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
              <span className="font-medium">HIPAA caveat:</span> these convenience routes use
              ecosystem services (iCloud, your mail provider) that are <em>not</em> automatically
              BAA-covered. The lowest-risk options are <span className="font-medium">AirDrop</span>{' '}
              (peer-to-peer, never hits the cloud) and{' '}
              <span className="font-medium">Workspace Gmail</span> (covered when your domain has an
              active HIPAA BAA with Google). Avoid personal Gmail / iCloud Mail / iCloud Drive for
              real PHI unless your practice's HIPAA program explicitly permits.
            </p>
            <ul className="mt-2 space-y-1.5 pl-1 leading-relaxed text-graphite-soft">
              <li>
                <span className="font-medium text-graphite">AirDrop (lowest risk):</span> tap{' '}
                <em>Share</em> → pick your laptop in the recipient list. Note arrives as a text file
                on macOS. Peer-to-peer, never traverses any cloud.
              </li>
              <li>
                <span className="font-medium text-graphite">
                  Universal Clipboard (Apple to Apple):
                </span>{' '}
                tap <em>Copy</em>, paste on your Mac/iPad. Convenient but transits Apple briefly —
                Apple does not sign BAAs for iCloud.
              </li>
              <li>
                <span className="font-medium text-graphite">Email to yourself:</span> tap{' '}
                <em>Email</em>. Safe only if your email provider (Workspace Gmail with HIPAA BAA,
                Office 365 with BAA) is BAA-covered. Personal Gmail / iCloud Mail are not.
              </li>
              <li>
                <span className="font-medium text-graphite">iOS Notes (Apple to Apple):</span> tap{' '}
                <em>Share</em> → pick <em>Notes</em>. The note lands in your Notes app and (if you
                have iCloud-synced Notes) appears on Mac/iPad within seconds — same legal profile as
                Universal Clipboard. For PHI, prefer <em>"On My iPhone"</em> Notes accounts (no
                iCloud sync) over the iCloud account.
              </li>
              <li>
                <span className="font-medium text-graphite">iOS Save to Files:</span> tap{' '}
                <em>Download</em>, save to <em>On My iPhone</em> (local, safe) or{' '}
                <em>iCloud Drive</em> (convenient, not BAA-covered).
              </li>
            </ul>
          </details>

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
                  {qaRunning
                    ? 'Checking…'
                    : meta.qaReviewMarkdown
                      ? 'Re-run'
                      : 'Check for warnings'}
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
                  {pearlsRunning
                    ? 'Generating…'
                    : meta.pearlsMarkdown
                      ? 'Re-generate'
                      : 'Generate pearls'}
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

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this recording?"
        message="The audio, transcript, and note will be permanently removed from this device. There is no undo."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />

      <ConfirmDialog
        open={showRegenConfirm}
        title="Discard your manual edits?"
        message="The note has manual edits since it was generated. Regenerating will replace the note with a fresh LLM output and lose your edits. There's no undo."
        tone="danger"
        confirmLabel="Regenerate anyway"
        onConfirm={runRegenerate}
        onCancel={() => setShowRegenConfirm(false)}
      />

      {templateAppliedToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
          <div className="rounded-full bg-graphite px-4 py-2 text-xs font-medium text-white shadow-lg">
            {templateAppliedToast}
          </div>
        </div>
      ) : null}
    </main>
  );
}
