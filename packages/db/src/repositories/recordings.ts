import type { Database } from '../adapter';

export type RecordingMode = 'ambient' | 'dictation';

export interface RecordingRow {
  id: string;
  createdAt: string;
  durationMs: number;
  audioPath: string;
  mode: RecordingMode;
  status: string;
  errorMessage: string | null;
}

export interface InsertRecording {
  id: string;
  createdAt?: string;
  durationMs: number;
  audioPath: string;
  mode: RecordingMode;
  status: string;
  errorMessage: string | null;
}

export interface RecordingsRepo {
  insert(input: InsertRecording): RecordingRow;
  getById(id: string): RecordingRow | null;
  list(opts: { limit: number; offset: number }): RecordingRow[];
  updateStatus(id: string, status: string, errorMessage?: string | null): number;
  updateDuration(id: string, durationMs: number): number;
  listOlderThan(beforeIso: string): RecordingRow[];
  delete(id: string): number;
}

interface Row {
  id: string;
  created_at: string;
  duration_ms: number;
  audio_path: string;
  mode: RecordingMode;
  status: string;
  error_message: string | null;
}

function rowToRecording(r: Row): RecordingRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    durationMs: r.duration_ms,
    audioPath: r.audio_path,
    mode: r.mode,
    status: r.status,
    errorMessage: r.error_message,
  };
}

export function createRecordingsRepo(db: Database): RecordingsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO recordings (id, created_at, duration_ms, audio_path, mode, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const getStmt = db.prepare(`SELECT * FROM recordings WHERE id = ?`);
  const listStmt = db.prepare(`SELECT * FROM recordings ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const updateStatusStmt = db.prepare(
    `UPDATE recordings SET status = ?, error_message = ? WHERE id = ?`,
  );
  const updateDurationStmt = db.prepare(`UPDATE recordings SET duration_ms = ? WHERE id = ?`);
  const olderThanStmt = db.prepare(
    `SELECT * FROM recordings WHERE created_at < ? ORDER BY created_at ASC`,
  );
  const deleteStmt = db.prepare(`DELETE FROM recordings WHERE id = ?`);

  return {
    insert(input) {
      const createdAt = input.createdAt ?? new Date().toISOString();
      insertStmt.run(
        input.id,
        createdAt,
        input.durationMs,
        input.audioPath,
        input.mode,
        input.status,
        input.errorMessage,
      );
      return {
        id: input.id,
        createdAt,
        durationMs: input.durationMs,
        audioPath: input.audioPath,
        mode: input.mode,
        status: input.status,
        errorMessage: input.errorMessage,
      };
    },
    getById(id) {
      const row = getStmt.get<Row>(id);
      return row ? rowToRecording(row) : null;
    },
    list({ limit, offset }) {
      return listStmt.all<Row>(limit, offset).map(rowToRecording);
    },
    updateStatus(id, status, errorMessage = null) {
      return updateStatusStmt.run(status, errorMessage, id).changes;
    },
    updateDuration(id, durationMs) {
      return updateDurationStmt.run(durationMs, id).changes;
    },
    listOlderThan(beforeIso) {
      return olderThanStmt.all<Row>(beforeIso).map(rowToRecording);
    },
    delete(id) {
      return deleteStmt.run(id).changes;
    },
  };
}
