import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createSettingsRepo, type SettingsRepo } from './settings';

function setup(): {
  db: ReturnType<typeof openBetterSqliteDatabase>;
  repo: SettingsRepo;
} {
  const db = openBetterSqliteDatabase(':memory:');
  applyMigrations(db);
  return { db, repo: createSettingsRepo(db) };
}

describe('SettingsRepo', () => {
  let repo: SettingsRepo;
  beforeEach(() => {
    repo = setup().repo;
  });

  it('get returns null before init', () => {
    expect(repo.get()).toBeNull();
  });

  it('init inserts defaults', () => {
    repo.init({});
    const s = repo.get();
    expect(s).toBeDefined();
    expect(s?.audioPurgeDays).toBe(7);
    expect(s?.lockPolicy).toBe('after_5_min');
    expect(s?.activeProvider).toBeNull();
  });

  it('init is idempotent (INSERT OR IGNORE)', () => {
    repo.init({ audioPurgeDays: 30 });
    repo.init({ audioPurgeDays: 1 });
    expect(repo.get()?.audioPurgeDays).toBe(30);
  });

  it('update only writes provided fields', () => {
    repo.init({});
    repo.update({ activeProvider: 'gemini-vertex', audioPurgeDays: 14 });
    const s = repo.get();
    expect(s?.activeProvider).toBe('gemini-vertex');
    expect(s?.audioPurgeDays).toBe(14);
    expect(s?.lockPolicy).toBe('after_5_min');
  });

  it('update before init throws', () => {
    expect(() => repo.update({ activeProvider: 'anthropic' })).toThrow();
  });
});
