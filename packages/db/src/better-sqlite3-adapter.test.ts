import { describe, expect, it } from 'vitest';
import { openBetterSqliteDatabase } from './better-sqlite3-adapter';

describe('openBetterSqliteDatabase', () => {
  it('opens an in-memory database when path is ":memory:"', () => {
    const db = openBetterSqliteDatabase(':memory:');
    expect(db).toBeDefined();
    db.close();
  });

  it('exec creates tables and prepare runs statements', () => {
    const db = openBetterSqliteDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT NOT NULL);');
    const insert = db.prepare('INSERT INTO t (id, name) VALUES (?, ?)');
    const result = insert.run('a', 'apple');
    expect(result.changes).toBe(1);
    const all = db.prepare('SELECT id, name FROM t ORDER BY id').all<{
      id: string;
      name: string;
    }>();
    expect(all).toEqual([{ id: 'a', name: 'apple' }]);
    db.close();
  });

  it('pragma reads and sets PRAGMA values', () => {
    const db = openBetterSqliteDatabase(':memory:');
    db.pragma('user_version = 7');
    expect(db.pragma<{ user_version: number }[]>('user_version')).toEqual([{ user_version: 7 }]);
    db.close();
  });

  it('transaction runs the callback inside an atomic transaction', () => {
    const db = openBetterSqliteDatabase(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY);');
    db.transaction(() => {
      db.prepare('INSERT INTO t (id) VALUES (?)').run(1);
      db.prepare('INSERT INTO t (id) VALUES (?)').run(2);
    });
    const count = db.prepare('SELECT COUNT(*) as c FROM t').get<{ c: number }>();
    expect(count?.c).toBe(2);
    db.close();
  });

  it('transaction rolls back on thrown error', () => {
    const db = openBetterSqliteDatabase(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY);');
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO t (id) VALUES (?)').run(1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const count = db.prepare('SELECT COUNT(*) as c FROM t').get<{ c: number }>();
    expect(count?.c).toBe(0);
    db.close();
  });
});
