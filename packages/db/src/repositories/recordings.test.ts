import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createRecordingsRepo, type RecordingsRepo, type RecordingRow } from './recordings';

function freshDb(): { db: ReturnType<typeof openBetterSqliteDatabase>; repo: RecordingsRepo } {
  const db = openBetterSqliteDatabase(':memory:');
  applyMigrations(db);
  return { db, repo: createRecordingsRepo(db) };
}

describe('RecordingsRepo', () => {
  let _db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: RecordingsRepo;
  beforeEach(() => {
    ({ db: _db, repo } = freshDb());
  });

  it('insert returns the row with created_at defaulted to now', () => {
    const before = new Date().toISOString();
    const row = repo.insert({
      id: 'r1',
      durationMs: 0,
      audioPath: '/tmp/r1.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    const after = new Date().toISOString();
    expect(row.id).toBe('r1');
    expect(row.audioPath).toBe('/tmp/r1.m4a');
    expect(row.mode).toBe('ambient');
    expect(row.status).toBe('recording');
    expect(row.createdAt >= before && row.createdAt <= after).toBe(true);
  });

  it('insert respects an explicit createdAt', () => {
    const row = repo.insert({
      id: 'r1',
      createdAt: '2020-01-01T00:00:00.000Z',
      durationMs: 0,
      audioPath: '/x.m4a',
      mode: 'dictation',
      status: 'recording',
      errorMessage: null,
    });
    expect(row.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('getById returns null when not found', () => {
    expect(repo.getById('nope')).toBeNull();
  });

  it('list returns newest first', () => {
    const ids = ['a', 'b', 'c'];
    let now = Date.parse('2026-04-26T00:00:00.000Z');
    for (const id of ids) {
      repo.insert({
        id,
        createdAt: new Date(now).toISOString(),
        durationMs: 0,
        audioPath: `/${id}.m4a`,
        mode: 'ambient',
        status: 'recording',
        errorMessage: null,
      });
      now += 60_000;
    }
    const all = repo.list({ limit: 10, offset: 0 });
    expect(all.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('updateStatus updates status and optional errorMessage', () => {
    repo.insert({
      id: 'r1',
      durationMs: 0,
      audioPath: '/r1.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    expect(repo.updateStatus('r1', 'failed', 'mic blocked')).toBe(1);
    const row = repo.getById('r1');
    expect(row?.status).toBe('failed');
    expect(row?.errorMessage).toBe('mic blocked');
  });

  it('updateDuration sets durationMs', () => {
    repo.insert({
      id: 'r1',
      durationMs: 0,
      audioPath: '/r1.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    expect(repo.updateDuration('r1', 12345)).toBe(1);
    expect(repo.getById('r1')?.durationMs).toBe(12345);
  });

  it('listOlderThan filters by created_at', () => {
    repo.insert({
      id: 'old',
      createdAt: '2020-01-01T00:00:00.000Z',
      durationMs: 0,
      audioPath: '/o.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    repo.insert({
      id: 'new',
      createdAt: '2026-04-26T00:00:00.000Z',
      durationMs: 0,
      audioPath: '/n.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    const old = repo.listOlderThan('2024-01-01T00:00:00.000Z');
    expect(old.map((r: RecordingRow) => r.id)).toEqual(['old']);
  });

  it('delete removes a row', () => {
    repo.insert({
      id: 'r1',
      durationMs: 0,
      audioPath: '/r1.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    expect(repo.delete('r1')).toBe(1);
    expect(repo.getById('r1')).toBeNull();
  });

  it('rejects an unknown mode value via CHECK constraint', () => {
    expect(() =>
      repo.insert({
        id: 'r1',
        durationMs: 0,
        audioPath: '/r1.m4a',
        mode: 'bogus' as 'ambient',
        status: 'recording',
        errorMessage: null,
      }),
    ).toThrow();
  });
});
