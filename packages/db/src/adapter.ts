export type SqlValue = string | number | bigint | Buffer | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number | bigint;
}

export interface PreparedStatement {
  run(...params: SqlValue[]): RunResult;
  get<T = unknown>(...params: SqlValue[]): T | undefined;
  all<T = unknown>(...params: SqlValue[]): T[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  pragma<T = unknown>(directive: string): T;
  transaction<T>(fn: () => T): T;
  close(): void;
}
