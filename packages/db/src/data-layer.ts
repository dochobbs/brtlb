import type { Database } from './adapter';
import { applyMigrations } from './migrations';
import { createRecordingsRepo, type RecordingsRepo } from './repositories/recordings';
import { createTranscriptsRepo, type TranscriptsRepo } from './repositories/transcripts';
import { createNotesRepo, type NotesRepo } from './repositories/notes';
import { createSpeakerRolesRepo, type SpeakerRolesRepo } from './repositories/speaker-roles';
import { createSettingsRepo, type SettingsRepo } from './repositories/settings';

export interface DataLayer {
  db: Database;
  recordings: RecordingsRepo;
  transcripts: TranscriptsRepo;
  notes: NotesRepo;
  speakerRoles: SpeakerRolesRepo;
  settings: SettingsRepo;
  close(): void;
}

export function createDataLayer(db: Database): DataLayer {
  applyMigrations(db);
  return {
    db,
    recordings: createRecordingsRepo(db),
    transcripts: createTranscriptsRepo(db),
    notes: createNotesRepo(db),
    speakerRoles: createSpeakerRolesRepo(db),
    settings: createSettingsRepo(db),
    close: () => db.close(),
  };
}
