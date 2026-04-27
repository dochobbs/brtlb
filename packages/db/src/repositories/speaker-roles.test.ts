import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createRecordingsRepo } from './recordings';
import { createSpeakerRolesRepo, type SpeakerRolesRepo } from './speaker-roles';

function setup(): {
  db: ReturnType<typeof openBetterSqliteDatabase>;
  repo: SpeakerRolesRepo;
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
  return { db, repo: createSpeakerRolesRepo(db) };
}

describe('SpeakerRolesRepo', () => {
  let repo: SpeakerRolesRepo;
  beforeEach(() => {
    repo = setup().repo;
  });

  it('setRole inserts new assignment and getRoles returns it', () => {
    repo.setRole('rec_1', 'A', 'parent');
    expect(repo.getRoles('rec_1')).toEqual([{ speakerId: 'A', role: 'parent' }]);
  });

  it('setRole upserts an existing assignment for the same speaker', () => {
    repo.setRole('rec_1', 'A', 'parent');
    repo.setRole('rec_1', 'A', 'patient');
    expect(repo.getRoles('rec_1')).toEqual([{ speakerId: 'A', role: 'patient' }]);
  });

  it('getRoles returns empty array when none assigned', () => {
    expect(repo.getRoles('rec_1')).toEqual([]);
  });

  it('clearRoles removes all assignments for a recording', () => {
    repo.setRole('rec_1', 'A', 'parent');
    repo.setRole('rec_1', 'B', 'provider');
    repo.clearRoles('rec_1');
    expect(repo.getRoles('rec_1')).toEqual([]);
  });
});
