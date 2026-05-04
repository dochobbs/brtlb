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
 * These are informed by real-world note evals where the LLM repeatedly
 * (1) imported "common" topics for a visit type that weren't actually
 * discussed (e.g., "water safety" anticipatory guidance, "viral URI"
 * differentials), (2) used "denies/reports/endorses" verbs for things the
 * clinician observed without asking, and (3) silently overrode the
 * clinician's clinical reasoning with a prior diagnosis or test result.
 *
 * The QA Review pass (`reviewNoteQuality` in apps/web-mvp's
 * pipeline-browser.ts) catches violations of these as a safety net, but
 * preventing the fabrication at generation time is much better than
 * flagging it after.
 *
 * Calibration choices:
 * - Rule 3 explicitly allows light expansion of generic positive findings
 *   ("sounds good" → "lungs clear to auscultation") because that matches
 *   how clinicians actually narrate exams. The boundary is "no
 *   differential rule-out language unless named, and no fabricated
 *   abnormal findings."
 * - Rule 4 allows easy inference for staging classifiers ("intermittent"
 *   from a use pattern is fine) because the alternative — refusing to
 *   stage anything unless explicitly stated — produces awkwardly
 *   un-classified diagnoses.
 *
 * If you soften these rules, ship a note-pair regression test against
 * the recorded eval cases first (Ethan WCV / Hudson asthma) so we
 * notice if a fabrication failure mode reappears.
 */
const FABRICATION_DISCIPLINE_RULES = `DOCUMENTATION DISCIPLINE — DO NOT FABRICATE:

Fill the note from the transcript. Do not pull in "common" or "expected" content for this visit type when the transcript doesn't address it.

1. NO FABRICATED TOPICS. If a subject was not discussed or observed, omit it. Do not document anticipatory guidance topics, exam findings, ROS items, assessments, or differential considerations that have no source in the transcript — even if they are standard for this visit type. Examples of fabrications to avoid: documenting "water safety" anticipatory guidance when only bicycle safety was discussed; documenting "viral URI" as a differential when only allergies and asthma were raised.

2. PATIENT-REPORTED VS. CLINICIAN-OBSERVED. The verbs "denies," "reports," and "endorses" require an actual question-and-answer exchange in the transcript. If the clinician observed something without asking, use observation language: "appears," "no signs of," "well-appearing." Do NOT write "denies breathing difficulty" when the clinician simply watched the patient breathe; write "no work of breathing observed."

3. EXAM DESCRIPTOR FIDELITY. When the clinician says "sounds good," "looks good," "appears normal," it is FINE to render that in standard exam language ("lungs clear to auscultation," "well-appearing," "no apparent abnormality"). What is NOT fine: expanding a generic positive into specific differential rule-out language ("no wheezing, rales, or rhonchi") unless the clinician named those findings, or fabricating abnormal findings that were not observed.

4. STAGING / SEVERITY. Apply staging adjectives (intermittent, mild, moderate, well-controlled) when the clinician uses them OR when the use pattern in the transcript clearly supports the classification (e.g., "intermittent" asthma is supportable when the controller is PRN with rescue dosing on bad days). Do not stage chronic diagnoses without clear evidence in the transcript.

5. CONTRARY CLINICAL REASONING. When the clinician explicitly disagrees with a prior diagnosis, test result, or family assumption, capture BOTH the prior framing AND the clinician's contrary reasoning. Example: if a strep test was positive but the clinician walked through scoring criteria and said the test was likely a false positive, the note should document both — do not silently treat the prior framing as confirmed.`;

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
