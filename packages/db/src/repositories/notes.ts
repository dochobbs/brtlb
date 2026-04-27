import type { Database } from '../adapter';

export type NoteStatus = 'draft' | 'finalized';

export interface NoteRow {
  id: string;
  recordingId: string;
  templateId: string;
  patternId: string;
  providerUsed: string;
  generatedText: string;
  editedText: string | null;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InsertNote {
  id: string;
  recordingId: string;
  templateId: string;
  patternId: string;
  providerUsed: string;
  generatedText: string;
  editedText: string | null;
  status: NoteStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotesRepo {
  insert(input: InsertNote): NoteRow;
  getById(id: string): NoteRow | null;
  getByRecordingId(recordingId: string): NoteRow[];
  updateGeneratedText(id: string, generatedText: string): number;
  updateEditedText(id: string, editedText: string | null): number;
  setStatus(id: string, status: NoteStatus): number;
  delete(id: string): number;
}

interface NoteDbRow {
  id: string;
  recording_id: string;
  template_id: string;
  pattern_id: string;
  provider_used: string;
  generated_text: string;
  edited_text: string | null;
  status: NoteStatus;
  created_at: string;
  updated_at: string;
}

function toRow(r: NoteDbRow): NoteRow {
  return {
    id: r.id,
    recordingId: r.recording_id,
    templateId: r.template_id,
    patternId: r.pattern_id,
    providerUsed: r.provider_used,
    generatedText: r.generated_text,
    editedText: r.edited_text,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createNotesRepo(db: Database): NotesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO notes (id, recording_id, template_id, pattern_id, provider_used, generated_text, edited_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getByIdStmt = db.prepare(`SELECT * FROM notes WHERE id = ?`);
  const getByRecordingStmt = db.prepare(
    `SELECT * FROM notes WHERE recording_id = ? ORDER BY created_at ASC`,
  );
  const updateGeneratedStmt = db.prepare(
    `UPDATE notes SET generated_text = ?, updated_at = ? WHERE id = ?`,
  );
  const updateEditedStmt = db.prepare(
    `UPDATE notes SET edited_text = ?, updated_at = ? WHERE id = ?`,
  );
  const setStatusStmt = db.prepare(`UPDATE notes SET status = ?, updated_at = ? WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM notes WHERE id = ?`);

  return {
    insert(input) {
      const now = new Date().toISOString();
      const createdAt = input.createdAt ?? now;
      const updatedAt = input.updatedAt ?? createdAt;
      insertStmt.run(
        input.id,
        input.recordingId,
        input.templateId,
        input.patternId,
        input.providerUsed,
        input.generatedText,
        input.editedText,
        input.status,
        createdAt,
        updatedAt,
      );
      return {
        id: input.id,
        recordingId: input.recordingId,
        templateId: input.templateId,
        patternId: input.patternId,
        providerUsed: input.providerUsed,
        generatedText: input.generatedText,
        editedText: input.editedText,
        status: input.status,
        createdAt,
        updatedAt,
      };
    },
    getById(id) {
      const r = getByIdStmt.get<NoteDbRow>(id);
      return r ? toRow(r) : null;
    },
    getByRecordingId(recordingId) {
      return getByRecordingStmt.all<NoteDbRow>(recordingId).map(toRow);
    },
    updateGeneratedText(id, generatedText) {
      return updateGeneratedStmt.run(generatedText, new Date().toISOString(), id).changes;
    },
    updateEditedText(id, editedText) {
      return updateEditedStmt.run(editedText, new Date().toISOString(), id).changes;
    },
    setStatus(id, status) {
      return setStatusStmt.run(status, new Date().toISOString(), id).changes;
    },
    delete(id) {
      return deleteStmt.run(id).changes;
    },
  };
}
