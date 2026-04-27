import type { Database } from '../adapter';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface TranscriptRow {
  id: string;
  recordingId: string;
  assemblyAiId: string | null;
  rawJson: string;
  createdAt: string;
}

export interface UtteranceRow {
  id: string;
  transcriptId: string;
  speakerId: string;
  role: SpeakerRole | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface InsertTranscriptInput {
  transcript: {
    id: string;
    recordingId: string;
    assemblyAiId: string | null;
    rawJson: string;
    createdAt?: string;
  };
  utterances: Array<{
    id: string;
    speakerId: string;
    role: SpeakerRole | null;
    startMs: number;
    endMs: number;
    text: string;
    confidence: number;
  }>;
}

export interface TranscriptsRepo {
  insert(input: InsertTranscriptInput): void;
  getByRecordingId(
    recordingId: string,
  ): { transcript: TranscriptRow; utterances: UtteranceRow[] } | null;
  delete(transcriptId: string): number;
}

interface TranscriptDbRow {
  id: string;
  recording_id: string;
  assemblyai_id: string | null;
  raw_json: string;
  created_at: string;
}

interface UtteranceDbRow {
  id: string;
  transcript_id: string;
  speaker_id: string;
  role: SpeakerRole | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

function toTranscript(r: TranscriptDbRow): TranscriptRow {
  return {
    id: r.id,
    recordingId: r.recording_id,
    assemblyAiId: r.assemblyai_id,
    rawJson: r.raw_json,
    createdAt: r.created_at,
  };
}

function toUtterance(r: UtteranceDbRow): UtteranceRow {
  return {
    id: r.id,
    transcriptId: r.transcript_id,
    speakerId: r.speaker_id,
    role: r.role,
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
    confidence: r.confidence,
  };
}

export function createTranscriptsRepo(db: Database): TranscriptsRepo {
  const insertTranscriptStmt = db.prepare(
    `INSERT INTO transcripts (id, recording_id, assemblyai_id, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertUtteranceStmt = db.prepare(
    `INSERT INTO utterances (id, transcript_id, speaker_id, role, start_ms, end_ms, text, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getTranscriptByRecordingStmt = db.prepare(
    `SELECT * FROM transcripts WHERE recording_id = ?`,
  );
  const getUtterancesStmt = db.prepare(
    `SELECT * FROM utterances WHERE transcript_id = ? ORDER BY start_ms ASC`,
  );
  const deleteStmt = db.prepare(`DELETE FROM transcripts WHERE id = ?`);

  return {
    insert(input) {
      const createdAt = input.transcript.createdAt ?? new Date().toISOString();
      db.transaction(() => {
        insertTranscriptStmt.run(
          input.transcript.id,
          input.transcript.recordingId,
          input.transcript.assemblyAiId,
          input.transcript.rawJson,
          createdAt,
        );
        for (const u of input.utterances) {
          insertUtteranceStmt.run(
            u.id,
            input.transcript.id,
            u.speakerId,
            u.role,
            u.startMs,
            u.endMs,
            u.text,
            u.confidence,
          );
        }
      });
    },
    getByRecordingId(recordingId) {
      const t = getTranscriptByRecordingStmt.get<TranscriptDbRow>(recordingId);
      if (!t) return null;
      const utterances = getUtterancesStmt.all<UtteranceDbRow>(t.id).map(toUtterance);
      return { transcript: toTranscript(t), utterances };
    },
    delete(transcriptId) {
      return deleteStmt.run(transcriptId).changes;
    },
  };
}
