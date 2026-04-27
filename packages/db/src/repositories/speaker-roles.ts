import type { Database } from '../adapter';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface SpeakerRoleAssignment {
  speakerId: string;
  role: SpeakerRole;
}

export interface SpeakerRolesRepo {
  setRole(recordingId: string, speakerId: string, role: SpeakerRole): void;
  getRoles(recordingId: string): SpeakerRoleAssignment[];
  clearRoles(recordingId: string): number;
}

interface Row {
  speaker_id: string;
  role: SpeakerRole;
}

export function createSpeakerRolesRepo(db: Database): SpeakerRolesRepo {
  const upsertStmt = db.prepare(
    `INSERT INTO speaker_role_assignments (recording_id, speaker_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(recording_id, speaker_id) DO UPDATE SET role = excluded.role`,
  );
  const getStmt = db.prepare(
    `SELECT speaker_id, role FROM speaker_role_assignments WHERE recording_id = ? ORDER BY speaker_id ASC`,
  );
  const clearStmt = db.prepare(`DELETE FROM speaker_role_assignments WHERE recording_id = ?`);

  return {
    setRole(recordingId, speakerId, role) {
      upsertStmt.run(recordingId, speakerId, role);
    },
    getRoles(recordingId) {
      return getStmt.all<Row>(recordingId).map((r) => ({
        speakerId: r.speaker_id,
        role: r.role,
      }));
    },
    clearRoles(recordingId) {
      return clearStmt.run(recordingId).changes;
    },
  };
}
