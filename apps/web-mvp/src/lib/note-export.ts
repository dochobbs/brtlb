export interface NoteSection {
  /** Section heading text - "HPI", "Exam", "Plan", etc. */
  label: string;
  /** Section body without the heading line. */
  body: string;
}

/**
 * Separator that pipeline-browser uses between per-patient sections in the
 * concatenated multi-patient note: see `regenerateNoteFromTranscript` and
 * `runMvpPipeline`. Splitting on this gives one chunk per patient.
 */
export const MULTI_PATIENT_SEPARATOR = '\n\n---\n\n';

export interface PatientNoteChunk {
  /** Matches the patient segment id (p0, p1, ...). */
  id: string;
  /** Display label for the tab — segment.patientLabel. */
  label: string;
  /** segment.visitType, used for the sub-label under the tab. */
  visitType: string;
  /** Full markdown for this patient — heading + body, as stored. */
  body: string;
}

/**
 * Split a concatenated multi-patient note (joined with MULTI_PATIENT_SEPARATOR)
 * into one chunk per patient segment, in order. Returns [] if the note is
 * empty, the segment list has 1 or fewer entries, or the chunk count doesn't
 * match the segment count (in which case the caller should fall back to
 * treating the note as one combined view — splitting incorrectly would lose
 * content silently).
 */
export function splitConcatenatedMultiPatientNote(
  note: string,
  segments: ReadonlyArray<{ id: string; patientLabel: string; visitType: string }>,
): PatientNoteChunk[] {
  if (!note.trim()) return [];
  if (segments.length <= 1) return [];
  const parts = note.split(MULTI_PATIENT_SEPARATOR);
  if (parts.length !== segments.length) return [];
  return parts.map((body, i) => ({
    id: segments[i]!.id,
    label: segments[i]!.patientLabel,
    visitType: segments[i]!.visitType,
    body,
  }));
}

/**
 * Recovery / fallback: detect multi-patient structure from the rendered
 * note text alone, without relying on RecordingMeta.patientSegments.
 *
 * This activates the per-patient tab UI in cases where the splitter
 * fell back to single-patient (typically because diarization collapsed
 * speakers, so stage-1 identify-patients only saw one child) but the
 * note-generation LLM noticed multiple patients in the transcript and
 * self-recovered by emitting labeled sections.
 *
 * Handles both header styles:
 *   - Canonical `## <Patient Label> · <Visit Type>` (with optional
 *     `— <acute concerns>` tail) emitted by `patientHeader()` in the
 *     pipeline's per-segment flow.
 *   - LLM-emitted `**Patient: <Name>**` variant produced by the model
 *     when it self-recovers without the pipeline's hand.
 *
 * And both separator styles between sections:
 *   - Canonical `---` markdown horizontal rule.
 *   - LLM-emitted `***` variant.
 *
 * Returns null when the note doesn't have at least two parseable
 * patient sections — callers fall back to single-patient view.
 */
const HORIZONTAL_RULE_SPLIT_RE = /\n\s*[*\-_]{3,}\s*\n/;
const CANONICAL_HEADER_RE = /^##\s+(.+?)\s*·\s*([^—\n]+?)(?:\s+—.*)?$/m;
const LLM_HEADER_RE = /\*\*Patient:\s*([^*\n]+?)\s*\*\*/;

export function detectMultiPatientStructureFromNote(
  note: string,
): { chunks: PatientNoteChunk[] } | null {
  if (!note.trim()) return null;
  const parts = note
    .split(HORIZONTAL_RULE_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  const chunks: PatientNoteChunk[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    let label: string | null = null;
    let visitType = 'other';

    const canonical = part.match(CANONICAL_HEADER_RE);
    if (canonical) {
      label = canonical[1]!.trim();
      visitType = canonical[2]!.trim().toLowerCase().replace(/\s+/g, '_');
    } else {
      const llm = part.match(LLM_HEADER_RE);
      if (llm) label = llm[1]!.trim();
    }

    // If any single chunk lacks an identifiable patient label, refuse —
    // we can't confidently re-derive structure if part of the note is
    // unlabeled. Better to fall back to the combined view than mis-attribute.
    if (!label) return null;
    chunks.push({ id: `p${i}`, label, visitType, body: part });
  }

  if (chunks.length < 2) return null;
  return { chunks };
}

/**
 * Splice a new body for one segment back into the full concatenated note.
 * If the segment index is out of range or the note isn't actually multi-
 * patient (no separator found), returns the new body as-is — single-patient
 * notes have no concatenation to preserve.
 */
export function spliceMultiPatientNote(
  fullNote: string,
  segmentIndex: number,
  newSegmentBody: string,
): string {
  const parts = fullNote.split(MULTI_PATIENT_SEPARATOR);
  if (parts.length === 1) return newSegmentBody;
  if (segmentIndex < 0 || segmentIndex >= parts.length) return fullNote;
  parts[segmentIndex] = newSegmentBody;
  return parts.join(MULTI_PATIENT_SEPARATOR);
}

/**
 * Split a markdown note into discrete sections by heading. Recognizes both
 * `## Heading` and `**Heading**` styles since brtlb's templates use a mix.
 * Sections without bodies are skipped. Returns an empty array if no headings
 * were detected.
 */
export function splitNoteIntoSections(md: string): NoteSection[] {
  if (!md.trim()) return [];
  const lines = md.split('\n');
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;

  const hashHeading = /^#{1,3}\s+(.+?)\s*$/;
  const boldHeading = /^\s*\*\*([^*\n]+?)\*\*\s*$/;

  for (const line of lines) {
    const hashMatch = hashHeading.exec(line);
    const boldMatch = boldHeading.exec(line);
    const match = hashMatch ?? boldMatch;
    if (match) {
      if (current && current.body.trim()) sections.push(current);
      current = { label: match[1]!.trim(), body: '' };
      continue;
    }
    if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current && current.body.trim()) sections.push(current);

  return sections.map((s) => ({ label: s.label, body: s.body.replace(/^\n+|\n+$/g, '') }));
}

/**
 * Look at the rendered note and the template's expected section list
 * and surface coverage gaps that may indicate a quiet failure mode:
 *
 * - **Missing sections**: the template told the model to produce a
 *   section and the model never emitted it. Templates explicitly say
 *   "omit any not addressed" so this is a soft signal — the banner
 *   asks "was this discussed?" rather than declaring an error.
 * - **Truncation suspicion**: the last section body ends without
 *   terminal punctuation. Models that hit max-token caps mid-output
 *   produce notes that look structurally complete but trail off.
 *
 * Returns an empty report when the template doesn't follow the
 * conventional "RETURN MARKDOWN with these sections" pattern or the
 * note has no parseable sections — better to skip than false-positive.
 */
export interface NoteCoverageReport {
  /** Section labels the template promised that aren't in the note. */
  missingSections: string[];
  /** True when the note ends abruptly (no terminal punctuation). */
  potentialTruncation: boolean;
}

const SECTION_LIST_BLOCK_RE =
  /RETURN MARKDOWN with these sections[^:\n]*:(?:[^\n]*\n)?((?:[ \t]*[-*][^\n]+\n?)+)/i;

export function extractExpectedSections(templatePromptBody: string): string[] {
  const match = SECTION_LIST_BLOCK_RE.exec(templatePromptBody);
  if (!match) return [];
  return match[1]!
    .split('\n')
    .map((line) => line.replace(/^[ \t]*[-*]\s*/, '').trim())
    .filter((s) => s.length > 0 && s.length < 80)
    // "Anticipatory Guidance (if discussed)" → strip parenthetical for matching.
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim());
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function validateNoteCoverage(
  noteMarkdown: string,
  expectedSectionLabels: ReadonlyArray<string>,
): NoteCoverageReport {
  if (!noteMarkdown.trim() || expectedSectionLabels.length === 0) {
    return { missingSections: [], potentialTruncation: false };
  }

  const sections = splitNoteIntoSections(noteMarkdown);
  if (sections.length === 0) {
    return { missingSections: [], potentialTruncation: false };
  }

  const presentNormalized = new Set(sections.map((s) => normalizeLabel(s.label)));
  const missingSections = expectedSectionLabels
    .filter((label) => !presentNormalized.has(normalizeLabel(label)))
    .filter((label) => {
      // Treat label aliases — Subjective vs HPI vs Interim History,
      // Follow-up rolled into Plan, etc. — to suppress false positives.
      const n = normalizeLabel(label);
      if (n === 'follow up' && presentNormalized.has('plan')) return false;
      if (n === 'hpi' && presentNormalized.has('subjective')) return false;
      if (n === 'hpi' && presentNormalized.has('interim history')) return false;
      if (n === 'subjective interval history' && presentNormalized.has('subjective')) return false;
      return true;
    });

  const lastBody = sections[sections.length - 1]!.body.trimEnd();
  const lastChar = lastBody.slice(-1);
  const potentialTruncation =
    lastBody.length > 0 &&
    lastChar !== '.' &&
    lastChar !== '!' &&
    lastChar !== '?' &&
    lastChar !== ')';

  return { missingSections, potentialTruncation };
}

/**
 * Lightweight markdown to HTML for clipboard rich-text. Subset only:
 * bold, italic, lists, headings, line breaks. Enough to preserve bolded
 * abnormal exam findings when pasted into rich-text-aware destinations.
 */
export function markdownToHtml(md: string): string {
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, '<em>$1</em>');
  html = html.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_match, group: string) => {
    const items = group
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^- /, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });
  html = html.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_match, group: string) => {
    const items = group
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `\n<ol>${items}</ol>`;
  });
  html = html
    .split(/\n{2,}/)
    .map((para) => {
      if (/^\s*<(h\d|ul|ol|li|p|blockquote|hr)/i.test(para)) return para;
      const trimmed = para.trim();
      if (!trimmed) return '';
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');

  return html;
}

/**
 * Best-effort markdown to plain text for the clipboard plain fallback and
 * for .txt downloads. Strips markdown sigils, leaves words intact.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[a-zA-Z0-9]*\n?/g, '')
    .replace(/`/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Copy the note to the clipboard with BOTH HTML and plain-text payloads.
 * EHRs that accept formatted paste keep the bold; everything else falls
 * back to plain text. Returns true on success.
 */
export async function copyNoteRich(md: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  const html = markdownToHtml(md);
  const plain = markdownToPlainText(md);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      // Fall through to plain-text path
    }
  }
  if (navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(plain);
    return true;
  }
  return false;
}

/**
 * Build a mailto: URL with the note pre-filled as the body. Subject is the
 * visit label when available. Mailto bodies have practical length limits
 * (~2000 chars across clients), longer notes may be truncated by the OS
 * mail handler.
 */
export function mailtoForNote(note: string, subject: string, recipient = ''): string {
  const cleanSubject = subject.trim() || 'brtlb visit note';
  const plain = markdownToPlainText(note);
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(cleanSubject)}&body=${encodeURIComponent(plain)}`;
}
