import { describe, expect, it } from 'vitest';
import { openBetterSqliteDatabase } from './better-sqlite3-adapter';
import { applyMigrations } from './migrations';
import { SCHEMA_VERSION } from './index';
import { TABLES } from './schema';

function tableNames(db: ReturnType<typeof openBetterSqliteDatabase>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all<{ name: string }>()
    .map((r) => r.name);
}

describe('applyMigrations', () => {
  it('creates every table on a fresh DB and stamps user_version', () => {
    const db = openBetterSqliteDatabase(':memory:');
    const version = applyMigrations(db);
    expect(version).toBe(SCHEMA_VERSION);
    const names = tableNames(db);
    for (const t of TABLES) expect(names).toContain(t.name);
    db.close();
  });

  it('is idempotent: running twice does not throw', () => {
    const db = openBetterSqliteDatabase(':memory:');
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(applyMigrations(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('sets PRAGMA foreign_keys = ON', () => {
    const db = openBetterSqliteDatabase(':memory:');
    applyMigrations(db);
    const fk = db.pragma<Array<{ foreign_keys: number }>>('foreign_keys');
    expect(fk[0]?.foreign_keys).toBe(1);
    db.close();
  });
});
