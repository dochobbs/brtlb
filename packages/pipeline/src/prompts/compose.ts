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
 * is borrowed from an earlier production note-generation prompt that
 * consistently produced better notes with a leaner discipline block.
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
- Counseling specificity (Plan / Anticipatory Guidance only — does NOT modify the Exam rule above): when the clinician's specific teaching content or rationale appears in the transcript, document it rather than a generic confirmation. "Reviewed back-sleep, firm surface, no blankets" is stronger than "safe-sleep counseling provided." Use generic phrasing only when the transcript truly lacks specifics. Never invent counseling content. Exam findings continue to follow the rule above — do not add specific abnormality rule-outs ("no wheezing") unless the clinician named them.
- Do not cite guidelines, organizations, or authorities the clinician did not name. "Per AAFP guidelines," "AAP recommends," "per CDC," "based on Bright Futures," and similar attributions must appear in the transcript before they appear in the note. Plain clinical rationale ("watchful waiting given age, no fever, no perforation") is fine; rationale dressed up as a citation is not.
- Capture decision-making as past-tense narrative, not as forward-looking conditionals. When the clinician deliberates between two options and picks one ("two choices: bump to 27 or add a short-acting booster; going with 27 to keep moving parts minimal"), document the chosen option's rationale in past tense ("Opted to increase to 27 mg to minimize moving parts; short-acting booster discussed as alternative"), not as a future-conditional ("If 27 mg extends coverage..."). The deliberation itself is clinically meaningful — chart what was decided and why, not just what was decided.`;

/**
 * Output of {@link composeNotePrompt}: the prompt split into the slot the
 * provider should put its instructions in (`system`) and the slot for the
 * actual content to act on (`user`).
 *
 * Why split: a 2026-05-26 local A/B against 3 synthetic fixtures showed
 * sending template body + discipline rules in the provider's dedicated
 * system slot (vs. inlining into the user message) produced materially
 * better notes — especially on behavioral-health visits where the
 * single-message variant silently dropped the SI/HI safety screen.
 * Gemini's `systemInstruction`, OpenAI's `role: 'system'` message, and
 * Anthropic's top-level `system` parameter all consume `system` here.
 */
export interface ComposedNotePrompt {
  system: string;
  user: string;
}

export function composeNotePrompt(input: GenerateNoteInput): ComposedNotePrompt {
  const roleMap = buildRoleMap(input.speakerRoles);
  const lines = input.transcript.utterances
    .map((u) => `[${speakerLabel(u, roleMap)}] ${u.text}`)
    .join('\n');

  const bookmarks = bookmarksBlock(input.bookmarks);

  // Instructions: the template body, length policy, discipline rules,
  // and the per-pattern modifier are operating rules the model should
  // weight as constraints on its output.
  const system = [
    input.template.promptBody,
    '',
    ADAPTIVE_LENGTH_RULE,
    '',
    FABRICATION_DISCIPLINE_RULES,
    '',
    input.pattern.promptModifier,
  ]
    .join('\n')
    .trim();

  // Content to act on: bookmarks (physician-flagged moments) + the mode
  // label + the transcript itself.
  const userParts: string[] = [];
  if (bookmarks) userParts.push(bookmarks);
  userParts.push(`Recording mode: ${input.mode}`);
  userParts.push('');
  userParts.push('Transcript:');
  userParts.push(lines);
  const user = userParts.join('\n').trim();

  return { system, user };
}
