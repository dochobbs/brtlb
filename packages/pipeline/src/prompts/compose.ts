import type {
  GenerateNoteInput,
  NoteBookmark,
  SpeakerRole,
  SpeakerRoleAssignment,
  Utterance,
} from '../types';

const ROLE_LABEL: Record<SpeakerRole, string> = {
  parent: 'Parent',
  patient: 'Patient',
  provider: 'Provider',
  sibling: 'Sibling',
  other: 'Other',
};

function speakerLabel(utterance: Utterance, roleMap: Map<string, SpeakerRole>): string {
  const overrideRole = roleMap.get(utterance.speakerId);
  if (overrideRole) return ROLE_LABEL[overrideRole];
  if (utterance.role) return ROLE_LABEL[utterance.role];
  return `Speaker ${utterance.speakerId}`;
}

function buildRoleMap(assignments: SpeakerRoleAssignment[]): Map<string, SpeakerRole> {
  const map = new Map<string, SpeakerRole>();
  for (const a of assignments) map.set(a.speakerId, a.role);
  return map;
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function bookmarksBlock(bookmarks: NoteBookmark[] | undefined): string {
  if (!bookmarks || bookmarks.length === 0) return '';
  const lines = bookmarks.map((b) => {
    const ts = formatTimestamp(b.ms);
    return `- ${ts}${b.label ? ` — ${b.label}` : ''}`;
  });
  return [
    'PHYSICIAN BOOKMARKS DURING THIS VISIT (review these moments carefully — the physician flagged them as important):',
    ...lines,
    '',
  ].join('\n');
}

const ADAPTIVE_LENGTH_RULE = `NOTE LENGTH:
Match the note length to the visit's complexity, not a fixed template. A focused 5-minute URI visit gets a brief note; a 60-minute mental-health follow-up or 90-minute autism evaluation gets a longer, richer note that captures the breadth of what was discussed. Do not pad short visits and do not truncate long ones. Length is a function of clinical content density, not template defaults.`;

/**
 * Shared documentation-discipline rules applied to every visit type.
 *
 * Compressed in 2026-05 from a 5-rule paragraph format to a 7-bullet block
 * after a side-by-side eval against three real visits showed the longer
 * format was paradoxically producing MORE fabrication, not less:
 *   - Ethan (WCV): "water safety" fabricated; "denies penile" verb misuse
 *   - Hudson (asthma): "viral URI" fabricated; "denies breathing difficulty"
 *     verb misuse; "no wheezing, rales, or rhonchi" exam over-expansion
 *   - Maddie (WCV+cough): "denies known history of asthma" denial-from-silence;
 *     "all other systems negative" boilerplate; eye exam described when
 *     no exam was performed; conditional plan ("if X then Y") collapsed
 *     to definite ("Y will be done")
 *
 * The compressed rules earned their keep on a 3-fixture eval — every major
 * failure mode above was eliminated under the new prompt. The structure
 * is borrowed from Roci's note-generation prompt, which has been
 * consistently producing better notes with a leaner discipline block.
 *
 * Calibration choices preserved:
 * - Light expansion of generic positives is still allowed ("sounds good"
 *   → "lungs clear to auscultation"), since that matches how clinicians
 *   narrate exams. The boundary is now explicit: do not name specific
 *   abnormalities that weren't stated.
 * - Staging classifiers can be inferred from use pattern (e.g.,
 *   "intermittent" asthma from a PRN-controller pattern), since refusing
 *   any inference produces awkwardly un-classified diagnoses.
 *
 * If you soften these rules or add new ones, run the regression eval
 * against the recorded fixtures first (eval-fixtures/, local-only PHI)
 * so we catch any failure-mode regression.
 */
const FABRICATION_DISCIPLINE_RULES = `DOCUMENTATION DISCIPLINE:
- Document only what was discussed or observed. Prefer omission over fabrication.
- If a topic, system, or section was not addressed, leave it out. Do not pad sections with blanket negatives ("all other systems negative," "remainder of exam unremarkable") or import content that's "common" for this visit type but absent from the transcript.
- Exam: include only systems actually examined. A clinician's generic positive ("sounds good") may be rendered in standard exam language ("lungs clear to auscultation"), but do not name specific abnormalities that were not stated — no "no wheezing, rales, or rhonchi" unless the clinician named them; no "erythema, loss of landmarks" unless the clinician named them. Never describe an exam that did not happen.
- ROS: pertinent positives and negatives only. Use "denies/reports/endorses" only when the transcript shows an explicit question-and-answer. For clinician observations without a question, use observation language ("no work of breathing observed"). Do not invent denials from silence.
- Apply staging adjectives (intermittent, mild, well-controlled) when the clinician uses them or when the transcript clearly supports the classification by use pattern.
- Preserve conditional plans as conditional. "If X works, then Y" is not the same as "Y will be done."
- When the clinician explicitly disagrees with a prior diagnosis, test, or family assumption, capture both the prior framing and the clinician's reasoning.
- Counseling specificity (Plan / Anticipatory Guidance only — does NOT modify the Exam rule above): when the clinician's specific teaching content or rationale appears in the transcript, document it rather than a generic confirmation. "Reviewed back-sleep, firm surface, no blankets" is stronger than "safe-sleep counseling provided." Use generic phrasing only when the transcript truly lacks specifics. Never invent counseling content. Exam findings continue to follow the rule above — do not add specific abnormality rule-outs ("no wheezing") unless the clinician named them.`;

export function composeNotePrompt(input: GenerateNoteInput): string {
  const roleMap = buildRoleMap(input.speakerRoles);
  const lines = input.transcript.utterances
    .map((u) => `[${speakerLabel(u, roleMap)}] ${u.text}`)
    .join('\n');

  const bookmarks = bookmarksBlock(input.bookmarks);

  return [
    input.template.promptBody,
    '',
    ADAPTIVE_LENGTH_RULE,
    '',
    FABRICATION_DISCIPLINE_RULES,
    '',
    input.pattern.promptModifier,
    '',
    `Recording mode: ${input.mode}`,
    '',
    bookmarks,
    'Transcript:',
    lines,
  ]
    .filter((s, idx, arr) => {
      // Drop the empty bookmarks block but keep its leading blank line slot collapsed
      if (s === '' && arr[idx - 1] === '' && arr[idx + 1] === 'Transcript:') return false;
      return true;
    })
    .join('\n');
}
