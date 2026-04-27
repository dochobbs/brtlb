# brtlb — Phase 3: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Stand up the Node-testable data layer behind a `Database` adapter interface: schema migrations, six repositories, and a `DataLayer` factory. Driven against `better-sqlite3` in-memory so every method is unit-tested without runtime SQLite dependency on platform code.

**Scope decision (read first).** The original Phase 3 plan was "encrypted storage" — that requires `@capacitor-community/sqlite + SQLCipher` plus platform-specific keychain integration, neither of which can run in Node. To keep Phase 3 fully test-covered and unblock Phase 4 (recording UX), this plan splits the work:

- **Phase 3 (this plan):** SQL-shape data layer. Pure Node tests via `better-sqlite3`. No encryption.
- **Phase 3.5 (deferred):** SQLCipher key derivation (Argon2id), Capacitor SQLite adapter, platform keychain bridges. Verified on devices; fits naturally with Phase 9 mobile finalization.

The adapter interface defined here is the seam Phase 3.5 will plug a Capacitor implementation into without changing any repo or app code.

**Architecture:**

```
packages/db/src/
├── index.ts                            # public exports
├── schema.ts                           # CREATE TABLE strings + SCHEMA_VERSION (existing)
├── adapter.ts                          # Database / PreparedStatement interfaces
├── better-sqlite3-adapter.ts           # adapter impl
├── better-sqlite3-adapter.test.ts
├── migrations.ts                       # applyMigrations(db) — uses user_version pragma
├── migrations.test.ts
├── repositories/
│   ├── recordings.ts
│   ├── recordings.test.ts
│   ├── transcripts.ts                  # transcripts + utterances together
│   ├── transcripts.test.ts
│   ├── notes.ts
│   ├── notes.test.ts
│   ├── speaker-roles.ts
│   ├── speaker-roles.test.ts
│   ├── settings.ts
│   └── settings.test.ts
└── data-layer.ts                       # createDataLayer(db) — bundles repos
```

**Tech Stack:** `better-sqlite3` (Node-only synchronous SQLite), TypeScript, Vitest.

---

## Conventions

- All `id` columns are TEXT (UUIDs minted by callers).
- All timestamps are ISO-8601 strings. Repos default `created_at`/`updated_at` to `new Date().toISOString()`.
- Repos return `null` when not found, never `undefined`.
- Repos throw on constraint violations (FK, CHECK).
- Bulk inserts use a single transaction.

---

## Out of scope (Phase 3.5+)

- SQLCipher integration
- Argon2id key derivation
- Platform keychain bridges (iOS Keychain, Android Keystore, Windows Credential Manager, libsecret)
- Application-layer encryption of `settings.assemblyai_key_encrypted` (stored as plain text in Phase 3)
- Capacitor SQLite adapter implementation
- Audio file lifecycle (lives in Phase 4)

---

## Per-task pattern

Each task follows the same shape as Phase 2 tasks: write failing tests verbatim, verify failures, write the implementation verbatim, verify passing, format/lint/typecheck, commit. The test code and implementation code are spelled out below for each repository so subagents do not need to invent shapes.

---

## Task 1: add `better-sqlite3` and bump package version

**Files:** Modify `packages/db/package.json`.

Replace package.json with:

```json
{
  "name": "@brtlb/db",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "vitest": "^2.1.9"
  }
}
```

Run `pnpm install`, tighten any specifiers that resolved higher. Verify the existing 3 schema tests still pass. Commit:

```
FEATURE(db): add better-sqlite3 for Node-side data layer testing
```

---

## Task 2: Database adapter interface + better-sqlite3 implementation

**Files:**

- Create `packages/db/src/adapter.ts`
- Create `packages/db/src/better-sqlite3-adapter.ts`
- Test `packages/db/src/better-sqlite3-adapter.test.ts`

### adapter.ts

```ts
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
```

### better-sqlite3-adapter.test.ts (5 tests)

```ts
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
```

### better-sqlite3-adapter.ts

```ts
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
```

Verify 8 tests pass (5 new + 3 existing). Format, lint, typecheck. Commit:

```
FEATURE(db): add Database adapter interface + better-sqlite3 impl
```

---

## Task 3: Migration runner

**Files:**

- Create `packages/db/src/migrations.ts`
- Test `packages/db/src/migrations.test.ts`

### migrations.test.ts (3 tests)

```ts
import { describe, expect, it } from 'vitest';
import { openBetterSqliteDatabase } from './better-sqlite3-adapter';
import { applyMigrations } from './migrations';
import { SCHEMA_VERSION, TABLES } from './schema';

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
```

### migrations.ts

```ts
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
```

Verify 11 tests pass. Format, lint, typecheck. Commit:

```
FEATURE(db): add applyMigrations runner using PRAGMA user_version
```

---

## Task 4: RecordingsRepo

**Files:**

- Create `packages/db/src/repositories/recordings.ts`
- Test `packages/db/src/repositories/recordings.test.ts`

The test file (full code) and implementation (full code) for this task live in the second half of this plan document — see APPENDIX A: RecordingsRepo below. Follow the same TDD pattern: write the test, verify failure, write the implementation, verify 9 new tests pass (20 total). Commit:

```
FEATURE(db): add RecordingsRepo with CRUD + status/duration updates + purge query
```

---

## Task 5: TranscriptsRepo (transcripts + utterances together)

See APPENDIX B for full test + implementation code. Atomic insert of transcript + utterances inside a transaction. CASCADE delete via FK. Verify 5 new tests pass (25 total). Commit:

```
FEATURE(db): add TranscriptsRepo with atomic transcript+utterances insert
```

---

## Task 6: NotesRepo

See APPENDIX C. Methods: insert, getById, getByRecordingId, updateGeneratedText, updateEditedText, setStatus, delete. All updates bump `updated_at`. Verify 6 new tests pass (31 total). Commit:

```
FEATURE(db): add NotesRepo with generated/edited text + status updates
```

---

## Task 7: SpeakerRolesRepo + SettingsRepo

See APPENDIX D. SpeakerRolesRepo: setRole (upsert via ON CONFLICT), getRoles, clearRoles. SettingsRepo: get, init (INSERT OR IGNORE), update (only writes provided fields, throws if not initialized). Verify 9 new tests pass (40 total). Commit:

```
FEATURE(db): add SpeakerRolesRepo (upsert) + SettingsRepo (singleton)
```

---

## Task 8: DataLayer aggregator + integration test

See APPENDIX E. createDataLayer(db) calls applyMigrations and constructs all five repos. One integration test runs through record → transcribe → role-assign → note-generate against an in-memory database. Update `packages/db/src/index.ts` to re-export everything. Move `SCHEMA_VERSION = 1` constant from `index.ts` to `schema.ts` so it lives next to the schema definitions. Verify 41 tests pass. Commit:

```
FEATURE(db): add DataLayer aggregator + integration test
```

---

## Task 9: Phase 3 docs and handoff

- Create `packages/db/README.md` describing the public surface, usage, and the Phase 3.5 SQLCipher handoff
- Update `docs/superpowers/plans/README.md`: Phase 3 → Complete; insert Phase 3.5 row "Encrypted storage (SQLCipher + key derivation + keychain)" with status Pending
- Update root `README.md` status line to: `Status: **Phase 1 + Brand v0.1 + Phase 2 (pipeline) + Phase 3 (data layer) complete.**`

Commit:

```
DOCS: phase 3 readme + plans status (3.5 split out for SQLCipher)
```

---

# APPENDIX — Full code for each repository

The following appendices are referenced from Tasks 4–8 above. The subagent should copy them verbatim. Test code is in tested files; implementation code is in the corresponding source files.

(Appendix code blocks follow in the next two chunks of this file.)

---

## APPENDIX A: RecordingsRepo

### recordings.test.ts (9 tests)

```ts
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
  let db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: RecordingsRepo;
  beforeEach(() => {
    ({ db, repo } = freshDb());
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
```

### recordings.ts

```ts
import type { Database } from '../adapter';

export type RecordingMode = 'ambient' | 'dictation';

export interface RecordingRow {
  id: string;
  createdAt: string;
  durationMs: number;
  audioPath: string;
  mode: RecordingMode;
  status: string;
  errorMessage: string | null;
}

export interface InsertRecording {
  id: string;
  createdAt?: string;
  durationMs: number;
  audioPath: string;
  mode: RecordingMode;
  status: string;
  errorMessage: string | null;
}

export interface RecordingsRepo {
  insert(input: InsertRecording): RecordingRow;
  getById(id: string): RecordingRow | null;
  list(opts: { limit: number; offset: number }): RecordingRow[];
  updateStatus(id: string, status: string, errorMessage?: string | null): number;
  updateDuration(id: string, durationMs: number): number;
  listOlderThan(beforeIso: string): RecordingRow[];
  delete(id: string): number;
}

interface Row {
  id: string;
  created_at: string;
  duration_ms: number;
  audio_path: string;
  mode: RecordingMode;
  status: string;
  error_message: string | null;
}

function rowToRecording(r: Row): RecordingRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    durationMs: r.duration_ms,
    audioPath: r.audio_path,
    mode: r.mode,
    status: r.status,
    errorMessage: r.error_message,
  };
}

export function createRecordingsRepo(db: Database): RecordingsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO recordings (id, created_at, duration_ms, audio_path, mode, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const getStmt = db.prepare(`SELECT * FROM recordings WHERE id = ?`);
  const listStmt = db.prepare(`SELECT * FROM recordings ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const updateStatusStmt = db.prepare(
    `UPDATE recordings SET status = ?, error_message = ? WHERE id = ?`,
  );
  const updateDurationStmt = db.prepare(`UPDATE recordings SET duration_ms = ? WHERE id = ?`);
  const olderThanStmt = db.prepare(
    `SELECT * FROM recordings WHERE created_at < ? ORDER BY created_at ASC`,
  );
  const deleteStmt = db.prepare(`DELETE FROM recordings WHERE id = ?`);

  return {
    insert(input) {
      const createdAt = input.createdAt ?? new Date().toISOString();
      insertStmt.run(
        input.id,
        createdAt,
        input.durationMs,
        input.audioPath,
        input.mode,
        input.status,
        input.errorMessage,
      );
      return {
        id: input.id,
        createdAt,
        durationMs: input.durationMs,
        audioPath: input.audioPath,
        mode: input.mode,
        status: input.status,
        errorMessage: input.errorMessage,
      };
    },
    getById(id) {
      const row = getStmt.get<Row>(id);
      return row ? rowToRecording(row) : null;
    },
    list({ limit, offset }) {
      return listStmt.all<Row>(limit, offset).map(rowToRecording);
    },
    updateStatus(id, status, errorMessage = null) {
      return updateStatusStmt.run(status, errorMessage, id).changes;
    },
    updateDuration(id, durationMs) {
      return updateDurationStmt.run(durationMs, id).changes;
    },
    listOlderThan(beforeIso) {
      return olderThanStmt.all<Row>(beforeIso).map(rowToRecording);
    },
    delete(id) {
      return deleteStmt.run(id).changes;
    },
  };
}
```

---

## APPENDIX B: TranscriptsRepo

### transcripts.test.ts (5 tests)

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter';
import { applyMigrations } from '../migrations';
import { createRecordingsRepo } from './recordings';
import { createTranscriptsRepo, type TranscriptsRepo } from './transcripts';

function setup(): {
  db: ReturnType<typeof openBetterSqliteDatabase>;
  repo: TranscriptsRepo;
} {
  const db = openBetterSqliteDatabase(':memory:');
  applyMigrations(db);
  createRecordingsRepo(db).insert({
    id: 'rec_1',
    durationMs: 0,
    audioPath: '/r.m4a',
    mode: 'ambient',
    status: 'transcribing',
    errorMessage: null,
  });
  return { db, repo: createTranscriptsRepo(db) };
}

describe('TranscriptsRepo', () => {
  let db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: TranscriptsRepo;
  beforeEach(() => {
    ({ db, repo } = setup());
  });

  it('insert persists transcript + utterances atomically', () => {
    repo.insert({
      transcript: {
        id: 't1',
        recordingId: 'rec_1',
        assemblyAiId: 'aai_42',
        rawJson: '{"hello": true}',
      },
      utterances: [
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'hi',
          confidence: 0.9,
        },
        {
          id: 'u2',
          speakerId: 'B',
          role: 'parent',
          startMs: 1000,
          endMs: 2000,
          text: 'hi back',
          confidence: 0.92,
        },
      ],
    });
    const out = repo.getByRecordingId('rec_1');
    expect(out?.transcript.id).toBe('t1');
    expect(out?.transcript.assemblyAiId).toBe('aai_42');
    expect(out?.utterances).toHaveLength(2);
    expect(out?.utterances[0]?.text).toBe('hi');
    expect(out?.utterances[1]?.role).toBe('parent');
  });

  it('rolls back utterance inserts if any utterance is invalid', () => {
    expect(() =>
      repo.insert({
        transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
        utterances: [
          {
            id: 'u1',
            speakerId: 'A',
            role: null,
            startMs: 0,
            endMs: 500,
            text: 'first',
            confidence: 0.9,
          },
          {
            id: 'u1',
            speakerId: 'B',
            role: null,
            startMs: 500,
            endMs: 1000,
            text: 'second',
            confidence: 0.9,
          },
        ],
      }),
    ).toThrow();
    expect(repo.getByRecordingId('rec_1')).toBeNull();
  });

  it('getByRecordingId returns null for unknown recording', () => {
    expect(repo.getByRecordingId('nope')).toBeNull();
  });

  it('delete cascades to utterances', () => {
    repo.insert({
      transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
      utterances: [
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'hi',
          confidence: 0.9,
        },
      ],
    });
    expect(repo.delete('t1')).toBe(1);
    expect(repo.getByRecordingId('rec_1')).toBeNull();
    const remaining = db.prepare('SELECT COUNT(*) as c FROM utterances').get<{ c: number }>();
    expect(remaining?.c).toBe(0);
  });

  it('preserves utterance order via start_ms', () => {
    repo.insert({
      transcript: { id: 't1', recordingId: 'rec_1', assemblyAiId: null, rawJson: '{}' },
      utterances: [
        {
          id: 'u3',
          speakerId: 'A',
          role: null,
          startMs: 2000,
          endMs: 3000,
          text: 'third',
          confidence: 0.9,
        },
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'first',
          confidence: 0.9,
        },
        {
          id: 'u2',
          speakerId: 'A',
          role: null,
          startMs: 1000,
          endMs: 2000,
          text: 'second',
          confidence: 0.9,
        },
      ],
    });
    const out = repo.getByRecordingId('rec_1');
    expect(out?.utterances.map((u) => u.text)).toEqual(['first', 'second', 'third']);
  });
});
```

### transcripts.ts

```ts
import type { Database } from '../adapter';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface TranscriptRow {
  id: string;
  recordingId: string;
  assemblyAiId: string | null;
  rawJson: string;
  createdAt: string;
}

export interface UtteranceRow {
  id: string;
  transcriptId: string;
  speakerId: string;
  role: SpeakerRole | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface InsertTranscriptInput {
  transcript: {
    id: string;
    recordingId: string;
    assemblyAiId: string | null;
    rawJson: string;
    createdAt?: string;
  };
  utterances: Array<{
    id: string;
    speakerId: string;
    role: SpeakerRole | null;
    startMs: number;
    endMs: number;
    text: string;
    confidence: number;
  }>;
}

export interface TranscriptsRepo {
  insert(input: InsertTranscriptInput): void;
  getByRecordingId(
    recordingId: string,
  ): { transcript: TranscriptRow; utterances: UtteranceRow[] } | null;
  delete(transcriptId: string): number;
}

interface TranscriptDbRow {
  id: string;
  recording_id: string;
  assemblyai_id: string | null;
  raw_json: string;
  created_at: string;
}

interface UtteranceDbRow {
  id: string;
  transcript_id: string;
  speaker_id: string;
  role: SpeakerRole | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

function toTranscript(r: TranscriptDbRow): TranscriptRow {
  return {
    id: r.id,
    recordingId: r.recording_id,
    assemblyAiId: r.assemblyai_id,
    rawJson: r.raw_json,
    createdAt: r.created_at,
  };
}

function toUtterance(r: UtteranceDbRow): UtteranceRow {
  return {
    id: r.id,
    transcriptId: r.transcript_id,
    speakerId: r.speaker_id,
    role: r.role,
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
    confidence: r.confidence,
  };
}

export function createTranscriptsRepo(db: Database): TranscriptsRepo {
  const insertTranscriptStmt = db.prepare(
    `INSERT INTO transcripts (id, recording_id, assemblyai_id, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertUtteranceStmt = db.prepare(
    `INSERT INTO utterances (id, transcript_id, speaker_id, role, start_ms, end_ms, text, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getTranscriptByRecordingStmt = db.prepare(
    `SELECT * FROM transcripts WHERE recording_id = ?`,
  );
  const getUtterancesStmt = db.prepare(
    `SELECT * FROM utterances WHERE transcript_id = ? ORDER BY start_ms ASC`,
  );
  const deleteStmt = db.prepare(`DELETE FROM transcripts WHERE id = ?`);

  return {
    insert(input) {
      const createdAt = input.transcript.createdAt ?? new Date().toISOString();
      db.transaction(() => {
        insertTranscriptStmt.run(
          input.transcript.id,
          input.transcript.recordingId,
          input.transcript.assemblyAiId,
          input.transcript.rawJson,
          createdAt,
        );
        for (const u of input.utterances) {
          insertUtteranceStmt.run(
            u.id,
            input.transcript.id,
            u.speakerId,
            u.role,
            u.startMs,
            u.endMs,
            u.text,
            u.confidence,
          );
        }
      });
    },
    getByRecordingId(recordingId) {
      const t = getTranscriptByRecordingStmt.get<TranscriptDbRow>(recordingId);
      if (!t) return null;
      const utterances = getUtterancesStmt.all<UtteranceDbRow>(t.id).map(toUtterance);
      return { transcript: toTranscript(t), utterances };
    },
    delete(transcriptId) {
      return deleteStmt.run(transcriptId).changes;
    },
  };
}
```

---

## APPENDIX C: NotesRepo

### notes.test.ts (6 tests)

```ts
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
  let db: ReturnType<typeof openBetterSqliteDatabase>;
  let repo: NotesRepo;
  beforeEach(() => {
    ({ db, repo } = setup());
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
});
```

### notes.ts

```ts
import type { Database } from '../adapter';

export type NoteStatus = 'draft' | 'finalized';

export interface NoteRow {
  id: string;
  recordingId: string;
  templateId: string;
  patternId: string;
  providerUsed: string;
  generatedText: string;
  editedText: string | null;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InsertNote {
  id: string;
  recordingId: string;
  templateId: string;
  patternId: string;
  providerUsed: string;
  generatedText: string;
  editedText: string | null;
  status: NoteStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotesRepo {
  insert(input: InsertNote): NoteRow;
  getById(id: string): NoteRow | null;
  getByRecordingId(recordingId: string): NoteRow[];
  updateGeneratedText(id: string, generatedText: string): number;
  updateEditedText(id: string, editedText: string): number;
  setStatus(id: string, status: NoteStatus): number;
  delete(id: string): number;
}

interface NoteDbRow {
  id: string;
  recording_id: string;
  template_id: string;
  pattern_id: string;
  provider_used: string;
  generated_text: string;
  edited_text: string | null;
  status: NoteStatus;
  created_at: string;
  updated_at: string;
}

function toRow(r: NoteDbRow): NoteRow {
  return {
    id: r.id,
    recordingId: r.recording_id,
    templateId: r.template_id,
    patternId: r.pattern_id,
    providerUsed: r.provider_used,
    generatedText: r.generated_text,
    editedText: r.edited_text,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createNotesRepo(db: Database): NotesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO notes (id, recording_id, template_id, pattern_id, provider_used, generated_text, edited_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getByIdStmt = db.prepare(`SELECT * FROM notes WHERE id = ?`);
  const getByRecordingStmt = db.prepare(
    `SELECT * FROM notes WHERE recording_id = ? ORDER BY created_at ASC`,
  );
  const updateGeneratedStmt = db.prepare(
    `UPDATE notes SET generated_text = ?, updated_at = ? WHERE id = ?`,
  );
  const updateEditedStmt = db.prepare(
    `UPDATE notes SET edited_text = ?, updated_at = ? WHERE id = ?`,
  );
  const setStatusStmt = db.prepare(`UPDATE notes SET status = ?, updated_at = ? WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM notes WHERE id = ?`);

  return {
    insert(input) {
      const now = new Date().toISOString();
      const createdAt = input.createdAt ?? now;
      const updatedAt = input.updatedAt ?? createdAt;
      insertStmt.run(
        input.id,
        input.recordingId,
        input.templateId,
        input.patternId,
        input.providerUsed,
        input.generatedText,
        input.editedText,
        input.status,
        createdAt,
        updatedAt,
      );
      return {
        id: input.id,
        recordingId: input.recordingId,
        templateId: input.templateId,
        patternId: input.patternId,
        providerUsed: input.providerUsed,
        generatedText: input.generatedText,
        editedText: input.editedText,
        status: input.status,
        createdAt,
        updatedAt,
      };
    },
    getById(id) {
      const r = getByIdStmt.get<NoteDbRow>(id);
      return r ? toRow(r) : null;
    },
    getByRecordingId(recordingId) {
      return getByRecordingStmt.all<NoteDbRow>(recordingId).map(toRow);
    },
    updateGeneratedText(id, generatedText) {
      return updateGeneratedStmt.run(generatedText, new Date().toISOString(), id).changes;
    },
    updateEditedText(id, editedText) {
      return updateEditedStmt.run(editedText, new Date().toISOString(), id).changes;
    },
    setStatus(id, status) {
      return setStatusStmt.run(status, new Date().toISOString(), id).changes;
    },
    delete(id) {
      return deleteStmt.run(id).changes;
    },
  };
}
```

---

## APPENDIX D: SpeakerRolesRepo + SettingsRepo

### speaker-roles.test.ts (4 tests)

```ts
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
```

### speaker-roles.ts

```ts
import type { Database } from '../adapter';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface SpeakerRoleAssignment {
  speakerId: string;
  role: SpeakerRole;
}

export interface SpeakerRolesRepo {
  setRole(recordingId: string, speakerId: string, role: SpeakerRole): void;
  getRoles(recordingId: string): SpeakerRoleAssignment[];
  clearRoles(recordingId: string): number;
}

interface Row {
  speaker_id: string;
  role: SpeakerRole;
}

export function createSpeakerRolesRepo(db: Database): SpeakerRolesRepo {
  const upsertStmt = db.prepare(
    `INSERT INTO speaker_role_assignments (recording_id, speaker_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(recording_id, speaker_id) DO UPDATE SET role = excluded.role`,
  );
  const getStmt = db.prepare(
    `SELECT speaker_id, role FROM speaker_role_assignments WHERE recording_id = ? ORDER BY speaker_id ASC`,
  );
  const clearStmt = db.prepare(`DELETE FROM speaker_role_assignments WHERE recording_id = ?`);

  return {
    setRole(recordingId, speakerId, role) {
      upsertStmt.run(recordingId, speakerId, role);
    },
    getRoles(recordingId) {
      return getStmt.all<Row>(recordingId).map((r) => ({
        speakerId: r.speaker_id,
        role: r.role,
      }));
    },
    clearRoles(recordingId) {
      return clearStmt.run(recordingId).changes;
    },
  };
}
```

### settings.test.ts (5 tests)

```ts
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
```

### settings.ts

```ts
import type { Database } from '../adapter';

export interface SettingsRow {
  activeProvider: string | null;
  geminiConfigJson: string | null;
  anthropicConfigJson: string | null;
  openaiCompatibleConfigJson: string | null;
  assemblyAiKeyEncrypted: string | null;
  audioPurgeDays: number;
  defaultTemplateId: string | null;
  defaultPatternId: string | null;
  letterheadHtml: string | null;
  lockPolicy: string;
}

export interface SettingsInit {
  activeProvider?: string | null;
  geminiConfigJson?: string | null;
  anthropicConfigJson?: string | null;
  openaiCompatibleConfigJson?: string | null;
  assemblyAiKeyEncrypted?: string | null;
  audioPurgeDays?: number;
  defaultTemplateId?: string | null;
  defaultPatternId?: string | null;
  letterheadHtml?: string | null;
  lockPolicy?: string;
}

export type SettingsUpdate = SettingsInit;

export interface SettingsRepo {
  get(): SettingsRow | null;
  init(input: SettingsInit): void;
  update(input: SettingsUpdate): number;
}

interface Row {
  id: number;
  active_provider: string | null;
  gemini_config_json: string | null;
  anthropic_config_json: string | null;
  openai_compatible_config_json: string | null;
  assemblyai_key_encrypted: string | null;
  audio_purge_days: number;
  default_template_id: string | null;
  default_pattern_id: string | null;
  letterhead_html: string | null;
  lock_policy: string;
}

function toRow(r: Row): SettingsRow {
  return {
    activeProvider: r.active_provider,
    geminiConfigJson: r.gemini_config_json,
    anthropicConfigJson: r.anthropic_config_json,
    openaiCompatibleConfigJson: r.openai_compatible_config_json,
    assemblyAiKeyEncrypted: r.assemblyai_key_encrypted,
    audioPurgeDays: r.audio_purge_days,
    defaultTemplateId: r.default_template_id,
    defaultPatternId: r.default_pattern_id,
    letterheadHtml: r.letterhead_html,
    lockPolicy: r.lock_policy,
  };
}

const COLUMN_MAP: Record<keyof SettingsInit, string> = {
  activeProvider: 'active_provider',
  geminiConfigJson: 'gemini_config_json',
  anthropicConfigJson: 'anthropic_config_json',
  openaiCompatibleConfigJson: 'openai_compatible_config_json',
  assemblyAiKeyEncrypted: 'assemblyai_key_encrypted',
  audioPurgeDays: 'audio_purge_days',
  defaultTemplateId: 'default_template_id',
  defaultPatternId: 'default_pattern_id',
  letterheadHtml: 'letterhead_html',
  lockPolicy: 'lock_policy',
};

export function createSettingsRepo(db: Database): SettingsRepo {
  const getStmt = db.prepare(`SELECT * FROM settings WHERE id = 1`);

  return {
    get() {
      const r = getStmt.get<Row>();
      return r ? toRow(r) : null;
    },
    init(input) {
      const cols: string[] = ['id'];
      const placeholders: string[] = ['1'];
      const values: Array<string | number | null> = [];
      for (const [key, dbCol] of Object.entries(COLUMN_MAP)) {
        const v = input[key as keyof SettingsInit];
        if (v !== undefined) {
          cols.push(dbCol);
          placeholders.push('?');
          values.push(v as string | number | null);
        }
      }
      const sql = `INSERT OR IGNORE INTO settings (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
      db.prepare(sql).run(...values);
    },
    update(input) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const [key, dbCol] of Object.entries(COLUMN_MAP)) {
        const v = input[key as keyof SettingsInit];
        if (v !== undefined) {
          sets.push(`${dbCol} = ?`);
          values.push(v as string | number | null);
        }
      }
      if (sets.length === 0) return 0;

      const existing = getStmt.get<Row>();
      if (!existing) {
        throw new Error('SettingsRepo.update: settings row not initialized; call init() first');
      }

      const sql = `UPDATE settings SET ${sets.join(', ')} WHERE id = 1`;
      return db.prepare(sql).run(...values).changes;
    },
  };
}
```

---

## APPENDIX E: DataLayer + index.ts

### data-layer.ts

```ts
import type { Database } from './adapter';
import { applyMigrations } from './migrations';
import { createRecordingsRepo, type RecordingsRepo } from './repositories/recordings';
import { createTranscriptsRepo, type TranscriptsRepo } from './repositories/transcripts';
import { createNotesRepo, type NotesRepo } from './repositories/notes';
import { createSpeakerRolesRepo, type SpeakerRolesRepo } from './repositories/speaker-roles';
import { createSettingsRepo, type SettingsRepo } from './repositories/settings';

export interface DataLayer {
  db: Database;
  recordings: RecordingsRepo;
  transcripts: TranscriptsRepo;
  notes: NotesRepo;
  speakerRoles: SpeakerRolesRepo;
  settings: SettingsRepo;
  close(): void;
}

export function createDataLayer(db: Database): DataLayer {
  applyMigrations(db);
  return {
    db,
    recordings: createRecordingsRepo(db),
    transcripts: createTranscriptsRepo(db),
    notes: createNotesRepo(db),
    speakerRoles: createSpeakerRolesRepo(db),
    settings: createSettingsRepo(db),
    close: () => db.close(),
  };
}
```

### data-layer.test.ts (1 integration test)

```ts
import { describe, expect, it } from 'vitest';
import { openBetterSqliteDatabase } from './better-sqlite3-adapter';
import { createDataLayer } from './data-layer';

describe('createDataLayer (integration)', () => {
  it('runs the full record → transcribe → note flow against an in-memory DB', () => {
    const dl = createDataLayer(openBetterSqliteDatabase(':memory:'));
    dl.settings.init({});

    dl.recordings.insert({
      id: 'rec_1',
      durationMs: 0,
      audioPath: '/tmp/r.m4a',
      mode: 'ambient',
      status: 'recording',
      errorMessage: null,
    });
    dl.recordings.updateStatus('rec_1', 'transcribing');

    dl.transcripts.insert({
      transcript: { id: 'tr_1', recordingId: 'rec_1', assemblyAiId: 'aai_1', rawJson: '{}' },
      utterances: [
        {
          id: 'u1',
          speakerId: 'A',
          role: null,
          startMs: 0,
          endMs: 1000,
          text: 'hello',
          confidence: 0.9,
        },
        {
          id: 'u2',
          speakerId: 'B',
          role: null,
          startMs: 1000,
          endMs: 2000,
          text: 'how are you',
          confidence: 0.92,
        },
      ],
    });

    dl.speakerRoles.setRole('rec_1', 'A', 'parent');
    dl.speakerRoles.setRole('rec_1', 'B', 'provider');

    dl.notes.insert({
      id: 'n1',
      recordingId: 'rec_1',
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: 'gemini-vertex',
      generatedText: 'Generated SOAP note.',
      editedText: null,
      status: 'draft',
    });

    dl.recordings.updateStatus('rec_1', 'ready_for_review');

    expect(dl.recordings.getById('rec_1')?.status).toBe('ready_for_review');
    expect(dl.transcripts.getByRecordingId('rec_1')?.utterances).toHaveLength(2);
    expect(dl.speakerRoles.getRoles('rec_1')).toHaveLength(2);
    expect(dl.notes.getByRecordingId('rec_1')).toHaveLength(1);
    expect(dl.settings.get()?.audioPurgeDays).toBe(7);

    dl.close();
  });
});
```

### Updated `packages/db/src/schema.ts`

Add this line at the top of the file (next to existing TableDef + TABLES):

```ts
export const SCHEMA_VERSION = 1;
```

### Updated `packages/db/src/index.ts`

Replace the contents with:

```ts
export * from './schema';
export type { Database, PreparedStatement, RunResult, SqlValue } from './adapter';
export { openBetterSqliteDatabase } from './better-sqlite3-adapter';
export { applyMigrations } from './migrations';
export { createRecordingsRepo } from './repositories/recordings';
export type {
  RecordingsRepo,
  RecordingRow,
  InsertRecording,
  RecordingMode,
} from './repositories/recordings';
export { createTranscriptsRepo } from './repositories/transcripts';
export type {
  TranscriptsRepo,
  TranscriptRow,
  UtteranceRow,
  InsertTranscriptInput,
  SpeakerRole,
} from './repositories/transcripts';
export { createNotesRepo } from './repositories/notes';
export type { NotesRepo, NoteRow, InsertNote, NoteStatus } from './repositories/notes';
export { createSpeakerRolesRepo } from './repositories/speaker-roles';
export type { SpeakerRolesRepo, SpeakerRoleAssignment } from './repositories/speaker-roles';
export { createSettingsRepo } from './repositories/settings';
export type {
  SettingsRepo,
  SettingsRow,
  SettingsInit,
  SettingsUpdate,
} from './repositories/settings';
export { createDataLayer } from './data-layer';
export type { DataLayer } from './data-layer';
```

(The previous `export const SCHEMA_VERSION = 1;` line in index.ts is removed because schema.ts now exports it via `export * from './schema'`.)

---

## Self-Review Notes

- Spec section 16 data model is fully implemented as repositories. Section 9 (encryption) is explicitly deferred and documented in handoff.
- All `id` columns are TEXT. All timestamp columns are ISO-8601 strings.
- `RecordingMode` and `SpeakerRole` types are duplicated in `recordings.ts` and `transcripts.ts` so each repo is self-contained. The alternative — cross-package import from `@brtlb/pipeline` — would create a dependency cycle. They should stay aligned by convention.
- Every repo test creates a fresh `:memory:` database in `beforeEach`. No shared state.
- Phase 4 readiness: `RecordingsRepo.listOlderThan(beforeIso)` is in place for the audio purge job. `SettingsRepo.audioPurgeDays` exposes the user-configurable retention window.

---

## Done Criteria

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm --filter @brtlb/db test` shows 41 passing tests
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check` all green
- [ ] `pnpm --filter @brtlb/web build` still succeeds
- [ ] CI green on the PR
- [ ] Phase 4 (recording UX) can `import { createDataLayer, openBetterSqliteDatabase } from '@brtlb/db'` and use it immediately (the Capacitor SQLCipher swap from Phase 3.5 will be a one-line replacement at the `Database` boundary)
