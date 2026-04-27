export * from './schema';
export type { Database, PreparedStatement, RunResult, SqlValue } from './adapter';
export { openBetterSqliteDatabase } from './better-sqlite3-adapter';
export { applyMigrations } from './migrations';
export { createRecordingsRepo } from './repositories/recordings';
export type {
  RecordingsRepo,
  RecordingRow,
  InsertRecording,
  RecordingMode,
} from './repositories/recordings';
export { createTranscriptsRepo } from './repositories/transcripts';
export type {
  TranscriptsRepo,
  TranscriptRow,
  UtteranceRow,
  InsertTranscriptInput,
  SpeakerRole,
} from './repositories/transcripts';
export { createNotesRepo } from './repositories/notes';
export type { NotesRepo, NoteRow, InsertNote, NoteStatus } from './repositories/notes';
export { createSpeakerRolesRepo } from './repositories/speaker-roles';
export type { SpeakerRolesRepo, SpeakerRoleAssignment } from './repositories/speaker-roles';
export { createSettingsRepo } from './repositories/settings';
export type {
  SettingsRepo,
  SettingsRow,
  SettingsInit,
  SettingsUpdate,
} from './repositories/settings';
export { createDataLayer } from './data-layer';
export type { DataLayer } from './data-layer';
