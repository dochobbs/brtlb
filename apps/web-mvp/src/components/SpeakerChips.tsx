import type { ReactElement } from 'react';
import type { SpeakerRole, SpeakerRoleAssignment } from '../lib/db';

const ROLES: Array<SpeakerRole | null> = [
  null,
  'parent',
  'patient',
  'provider',
  'sibling',
  'other',
];

const ROLE_LABEL: Record<SpeakerRole, string> = {
  parent: 'Parent',
  patient: 'Patient',
  provider: 'Provider',
  sibling: 'Sibling',
  other: 'Other',
};

const ROLE_BG: Record<SpeakerRole, string> = {
  parent: 'bg-seafoam text-graphite',
  patient: 'bg-amber-200 text-graphite',
  provider: 'bg-graphite text-white',
  sibling: 'bg-blue-200 text-graphite',
  other: 'bg-graphite-soft text-white',
};

export interface SpeakerChipsProps {
  speakerIds: string[];
  assignments: SpeakerRoleAssignment[];
  onChange: (next: SpeakerRoleAssignment[]) => void;
  disabled?: boolean;
}

function nextRole(current: SpeakerRole | null): SpeakerRole | null {
  const idx = ROLES.indexOf(current);
  const nextIdx = (idx + 1) % ROLES.length;
  return ROLES[nextIdx] ?? null;
}

export function SpeakerChips({
  speakerIds,
  assignments,
  onChange,
  disabled,
}: SpeakerChipsProps): ReactElement | null {
  if (speakerIds.length === 0) return null;
  const map = new Map(assignments.map((a) => [a.speakerId, a.role]));

  function cycle(speakerId: string): void {
    if (disabled) return;
    const current = map.get(speakerId) ?? null;
    const next = nextRole(current);
    const filtered = assignments.filter((a) => a.speakerId !== speakerId);
    if (next === null) {
      onChange(filtered);
    } else {
      onChange([...filtered, { speakerId, role: next }]);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-graphite-soft">Speakers</span>
      {speakerIds.map((id) => {
        const role = map.get(id) ?? null;
        const className =
          'rounded-full px-3 py-1 text-xs font-medium transition ' +
          (role
            ? ROLE_BG[role]
            : 'border border-graphite-soft/30 bg-white text-graphite-soft hover:bg-mist');
        return (
          <button
            key={id}
            type="button"
            onClick={() => cycle(id)}
            disabled={disabled}
            className={className + (disabled ? ' opacity-50 cursor-not-allowed' : '')}
            title={
              role
                ? `Speaker ${id}: ${ROLE_LABEL[role]} — tap to change`
                : `Speaker ${id} — tap to assign a role`
            }
          >
            {role ? ROLE_LABEL[role] : `Speaker ${id}`}
          </button>
        );
      })}
    </div>
  );
}
