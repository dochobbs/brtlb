import type { Database } from './adapter';
import { SCHEMA_VERSION, TABLES } from './schema';

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
