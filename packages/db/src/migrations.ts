import type { Database } from './adapter';
import { TABLES } from './schema';

// SCHEMA_VERSION lives in index.ts until Task 8 moves it to schema.ts.
// Import it here directly to avoid a potential circular reference once
// index.ts re-exports ./migrations (Task 8).  When Task 8 lands, both
// this file and migrations.test.ts will switch to importing from './schema'.
const SCHEMA_VERSION = 1;

function readUserVersion(db: Database): number {
  const rows = db.pragma<Array<{ user_version: number }>>('user_version');
  return rows[0]?.user_version ?? 0;
}

export function applyMigrations(db: Database): number {
  const current = readUserVersion(db);
  if (current >= SCHEMA_VERSION) return current;

  db.transaction(() => {
    for (const t of TABLES) db.exec(t.createSql);
  });

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return SCHEMA_VERSION;
}
