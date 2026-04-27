import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createRecordingsRepo } from './recordings';
import { createTranscriptsRepo, type TranscriptsRepo } from './transcripts';

function setup(): {
  db: ReturnType<typeof openBetterSqliteDatabase>;
  repo: TranscriptsRepo;
} {
  const db = openBetterSqliteDatabase(':memory:');
  applyMigrations(db);
  createRecordingsRepo(db).insert({
    id: 'rec_1',
    durationMs: 0,
    audioPath: '/r.m4a',
    mode: 'ambient',
    status: 'transcribing',
    errorMessage: null,
  });
  return { db, repo: createTranscriptsRepo(db) };
}

describe('TranscriptsRepo', () => {
  let db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: TranscriptsRepo;
  beforeEach(() => {
    ({ db, repo } = setup());
  });

  it('insert persists transcript + utterances atomically', () => {
    repo.insert({
      transcript: {
        id: 't1',
        recordingId: 'rec_1',
        assemblyAiId: 'aai_42',
        rawJson: '{"hello": true}',
      },
      utterances: [
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'hi',
          confidence: 0.9,
        },
        {
          id: 'u2',
          speakerId: 'B',
          role: 'parent',
          startMs: 1000,
          endMs: 2000,
          text: 'hi back',
          confidence: 0.92,
        },
      ],
    });
    const out = repo.getByRecordingId('rec_1');
    expect(out?.transcript.id).toBe('t1');
    expect(out?.transcript.assemblyAiId).toBe('aai_42');
    expect(out?.utterances).toHaveLength(2);
    expect(out?.utterances[0]?.text).toBe('hi');
    expect(out?.utterances[1]?.role).toBe('parent');
  });

  it('rolls back utterance inserts if any utterance is invalid', () => {
    expect(() =>
      repo.insert({
        transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
        utterances: [
          {
            id: 'u1',
            speakerId: 'A',
            role: null,
            startMs: 0,
            endMs: 500,
            text: 'first',
            confidence: 0.9,
          },
          {
            id: 'u1',
            speakerId: 'B',
            role: null,
            startMs: 500,
            endMs: 1000,
            text: 'second',
            confidence: 0.9,
          },
        ],
      }),
    ).toThrow();
    expect(repo.getByRecordingId('rec_1')).toBeNull();
  });

  it('getByRecordingId returns null for unknown recording', () => {
    expect(repo.getByRecordingId('nope')).toBeNull();
  });

  it('delete cascades to utterances', () => {
    repo.insert({
      transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
      utterances: [
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'hi',
          confidence: 0.9,
        },
      ],
    });
    expect(repo.delete('t1')).toBe(1);
    expect(repo.getByRecordingId('rec_1')).toBeNull();
    const remaining = db.prepare('SELECT COUNT(*) as c FROM utterances').get<{ c: number }>();
    expect(remaining?.c).toBe(0);
  });

  it('preserves utterance order via start_ms', () => {
    repo.insert({
      transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
      utterances: [
        {
          id: 'u3',
          speakerId: 'A',
          role: null,
          startMs: 2000,
          endMs: 3000,
          text: 'third',
          confidence: 0.9,
        },
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'first',
          confidence: 0.9,
        },
        {
          id: 'u2',
          speakerId: 'A',
          role: null,
          startMs: 1000,
          endMs: 2000,
          text: 'second',
          confidence: 0.9,
        },
      ],
    });
    const out = repo.getByRecordingId('rec_1');
    expect(out?.utterances.map((u) => u.text)).toEqual(['first', 'second', 'third']);
  });
});
