export const SCHEMA_VERSION = 1;

export interface TableDef {
  name: string;
  createSql: string;
}

export const TABLES: TableDef[] = [
  {
    name: 'recordings',
    createSql: `CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      audio_path TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('ambient', 'dictation')),
      status TEXT NOT NULL,
      error_message TEXT
    );`,
  },
  {
    name: 'transcripts',
    createSql: `CREATE TABLE transcripts (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      assemblyai_id TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
  },
  {
    name: 'utterances',
    createSql: `CREATE TABLE utterances (
      id TEXT PRIMARY KEY,
      transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      speaker_id TEXT NOT NULL,
      role TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL
    );`,
  },
  {
    name: 'notes',
    createSql: `CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      provider_used TEXT NOT NULL,
      generated_text TEXT NOT NULL,
      edited_text TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
  },
  {
    name: 'speaker_role_assignments',
    createSql: `CREATE TABLE speaker_role_assignments (
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      speaker_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (recording_id, speaker_id)
    );`,
  },
  {
    name: 'settings',
    createSql: `CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_provider TEXT,
      gemini_config_json TEXT,
      anthropic_config_json TEXT,
      openai_compatible_config_json TEXT,
      assemblyai_key_encrypted TEXT,
      audio_purge_days INTEGER NOT NULL DEFAULT 7,
      default_template_id TEXT,
      default_pattern_id TEXT,
      letterhead_html TEXT,
      lock_policy TEXT NOT NULL DEFAULT 'after_5_min'
    );`,
  },
];
