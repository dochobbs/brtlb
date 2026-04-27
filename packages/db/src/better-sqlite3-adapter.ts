import BetterSqlite3 from 'better-sqlite3';
import type { Database, PreparedStatement, RunResult, SqlValue } from './adapter';

class BetterSqlite3Statement implements PreparedStatement {
  constructor(private readonly stmt: BetterSqlite3.Statement) {}

  run(...params: SqlValue[]): RunResult {
    const result = this.stmt.run(...params);
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
  }

  get<T = unknown>(...params: SqlValue[]): T | undefined {
    return this.stmt.get(...params) as T | undefined;
  }

  all<T = unknown>(...params: SqlValue[]): T[] {
    return this.stmt.all(...params) as T[];
  }
}

class BetterSqlite3Database implements Database {
  constructor(private readonly db: BetterSqlite3.Database) {
    db.pragma('foreign_keys = ON');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    return new BetterSqlite3Statement(this.db.prepare(sql));
  }

  pragma<T = unknown>(directive: string): T {
    return this.db.pragma(directive) as T;
  }

  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }

  close(): void {
    this.db.close();
  }
}

export function openBetterSqliteDatabase(path: string): Database {
  return new BetterSqlite3Database(new BetterSqlite3(path));
}
