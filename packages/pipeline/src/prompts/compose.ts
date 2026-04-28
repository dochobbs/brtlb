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
