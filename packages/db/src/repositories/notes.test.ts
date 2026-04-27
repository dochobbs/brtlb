import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createRecordingsRepo } from './recordings';
import { createNotesRepo, type NotesRepo } from './notes';

function setup(): {
  db: ReturnType<typeof openBetterSqliteDatabase>;
  repo: NotesRepo;
} {
  const db = openBetterSqliteDatabase(':memory:');
  applyMigrations(db);
  createRecordingsRepo(db).insert({
    id: 'rec_1',
    durationMs: 0,
    audioPath: '/r.m4a',
    mode: 'ambient',
    status: 'ready_for_review',
    errorMessage: null,
  });
  return { db, repo: createNotesRepo(db) };
}

describe('NotesRepo', () => {
  let _db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: NotesRepo;
  beforeEach(() => {
    ({ db: _db, repo } = setup());
  });

  it('insert returns the persisted row with default timestamps', () => {
    const before = new Date().toISOString();
    const row = repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'gemini-vertex',
      generatedText: 'SOAP note v1',
      editedText: null,
      status: 'draft',
    });
    const after = new Date().toISOString();
    expect(row.id).toBe('n1');
    expect(row.generatedText).toBe('SOAP note v1');
    expect(row.editedText).toBeNull();
    expect(row.status).toBe('draft');
    expect(row.createdAt >= before && row.createdAt <= after).toBe(true);
    expect(row.updatedAt).toBe(row.createdAt);
  });

  it('updateGeneratedText replaces text and bumps updatedAt', async () => {
    const row = repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'anthropic',
      generatedText: 'first',
      editedText: null,
      status: 'draft',
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGeneratedText('n1', 'second')).toBe(1);
    const after = repo.getById('n1');
    expect(after?.generatedText).toBe('second');
    expect(after?.updatedAt).not.toBe(row.updatedAt);
  });

  it('updateEditedText sets editedText without touching generatedText', () => {
    repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'anthropic',
      generatedText: 'auto',
      editedText: null,
      status: 'draft',
    });
    expect(repo.updateEditedText('n1', 'human edit')).toBe(1);
    const row = repo.getById('n1');
    expect(row?.generatedText).toBe('auto');
    expect(row?.editedText).toBe('human edit');
  });

  it('setStatus enforces enum via CHECK', () => {
    repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'anthropic',
      generatedText: 't',
      editedText: null,
      status: 'draft',
    });
    expect(repo.setStatus('n1', 'finalized')).toBe(1);
    expect(repo.getById('n1')?.status).toBe('finalized');
    expect(() => repo.setStatus('n1', 'bogus' as 'draft')).toThrow();
  });

  it('getByRecordingId returns all notes for a recording', () => {
    for (const id of ['n1', 'n2']) {
      repo.insert({
        id,
        recordingId: 'rec_1',
        templateId: 'soap',
        patternId: 'narrative',
        providerUsed: 'anthropic',
        generatedText: id,
        editedText: null,
        status: 'draft',
      });
    }
    const all = repo.getByRecordingId('rec_1');
    expect(all.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  it('delete removes the row', () => {
    repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'anthropic',
      generatedText: 't',
      editedText: null,
      status: 'draft',
    });
    expect(repo.delete('n1')).toBe(1);
    expect(repo.getById('n1')).toBeNull();
  });

  it('rejects an insert with non-existent recording_id (FK violation)', () => {
    expect(() =>
      repo.insert({
        id: 'n1',
        recordingId: 'does-not-exist',
        templateId: 'soap',
        patternId: 'narrative',
        providerUsed: 'anthropic',
        generatedText: 'x',
        editedText: null,
        status: 'draft',
      }),
    ).toThrow();
  });

  it('updateEditedText accepts null to clear edits', () => {
    repo.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'anthropic',
      generatedText: 'auto',
      editedText: 'first edit',
      status: 'draft',
    });
    expect(repo.updateEditedText('n1', null)).toBe(1);
    expect(repo.getById('n1')?.editedText).toBeNull();
  });
});
