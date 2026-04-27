# @brtlb/db — Data Layer

SQLite-backed data persistence layer for brtlb. Provides a `Database` adapter interface with implementations for testing (better-sqlite3) and production (Capacitor SQLite + SQLCipher from Phase 3.5).

## Public Surface

### Core Factory

```ts
import { openBetterSqliteDatabase, createDataLayer } from '@brtlb/db';

// Open a database
const db = openBetterSqliteDatabase(':memory:'); // or '/path/to/db.db'

// Apply schema migrations & create all repos
const dl = createDataLayer(db);

// Use the data layer
dl.settings.init({});
dl.recordings.insert({ id: '...', audioPath: '/...', ... });
```

### Repositories

The `DataLayer` bundles five repositories:

1. **RecordingsRepo** — Audio recordings and their metadata
   - `insert(input)` → `RecordingRow`
   - `getById(id)` → `RecordingRow | null`
   - `list({ limit, offset })` → `RecordingRow[]`
   - `updateStatus(id, status, errorMessage?)` → `number` (changes)
   - `updateDuration(id, durationMs)` → `number`
   - `listOlderThan(beforeIso)` → `RecordingRow[]` (for purge jobs)
   - `delete(id)` → `number`

2. **TranscriptsRepo** — Transcripts + utterances (atomic insert)
   - `insert({ transcript, utterances })` → `void`
   - `getByRecordingId(recordingId)` → `{ transcript: TranscriptRow; utterances: UtteranceRow[] } | null`
   - `delete(transcriptId)` → `number`

3. **NotesRepo** — Generated and edited SOAP notes
   - `insert(input)` → `NoteRow`
   - `getById(id)` → `NoteRow | null`
   - `getByRecordingId(recordingId)` → `NoteRow[]`
   - `updateGeneratedText(id, text)` → `number` (bumps `updated_at`)
   - `updateEditedText(id, text)` → `number`
   - `setStatus(id, status)` → `number`
   - `delete(id)` → `number`

4. **SpeakerRolesRepo** — Speaker role assignments (parent, patient, provider, etc.)
   - `setRole(recordingId, speakerId, role)` → `void` (upsert via `ON CONFLICT`)
   - `getRoles(recordingId)` → `SpeakerRoleAssignment[]`
   - `clearRoles(recordingId)` → `number`

5. **SettingsRepo** — Singleton application settings
   - `get()` → `SettingsRow | null`
   - `init(input)` → `void` (idempotent: `INSERT OR IGNORE`)
   - `update(input)` → `number` (throws if not initialized; only writes provided fields)

### Adapter Interface

For Phase 3.5 (encrypted storage), implement the `Database` interface:

```ts
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  pragma<T = unknown>(directive: string): T;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface PreparedStatement {
  run(...params: SqlValue[]): RunResult;
  get<T = unknown>(...params: SqlValue[]): T | undefined;
  all<T = unknown>(...params: SqlValue[]): T[];
}
```

## Usage Example

```ts
import { openBetterSqliteDatabase, createDataLayer } from '@brtlb/db';

const dl = createDataLayer(openBetterSqliteDatabase(':memory:'));

// Initialize settings with defaults
dl.settings.init({ audioPurgeDays: 7 });

// Record a session
const rec = dl.recordings.insert({
  id: crypto.randomUUID(),
  durationMs: 0,
  audioPath: '/path/to/audio.m4a',
  mode: 'ambient',
  status: 'recording',
  errorMessage: null,
});

// Update status as processing progresses
dl.recordings.updateStatus(rec.id, 'transcribing');

// Store transcript + utterances atomically
dl.transcripts.insert({
  transcript: {
    id: crypto.randomUUID(),
    recordingId: rec.id,
    assemblyAiId: 'aai_xyz',
    rawJson: '{"...": "..."}',
  },
  utterances: [
    {
      id: crypto.randomUUID(),
      speakerId: 'A',
      role: null, // to be set later
      startMs: 0,
      endMs: 1000,
      text: 'Hello',
      confidence: 0.95,
    },
  ],
});

// Assign speaker roles
dl.speakerRoles.setRole(rec.id, 'A', 'parent');

// Generate and store notes
dl.notes.insert({
  id: crypto.randomUUID(),
  recordingId: rec.id,
  templateId: 'soap',
  patternId: 'narrative',
  providerUsed: 'gemini-vertex',
  generatedText: 'Generated SOAP note...',
  editedText: null,
  status: 'draft',
});

// Finalize the session
dl.recordings.updateStatus(rec.id, 'ready_for_review');

dl.close();
```

## Phase 3.5 Handoff: Encrypted Storage

Phase 3 provides the data layer interface and a test implementation via `better-sqlite3`. Phase 3.5 (deferred) will add encrypted storage by:

1. **SQLCipher integration** — Swap the database implementation to use `@capacitor-community/sqlite` with SQLCipher encryption.
2. **Key derivation** — Argon2id to derive an encryption key from a user password or biometric token.
3. **Keychain bridges** — Platform-specific secure key storage (iOS Keychain, Android Keystore, Windows Credential Manager, libsecret).

The `Database` adapter interface defined here is the seam: Phase 3.5 will implement the interface with Capacitor SQLCipher and wire keychain bridges without any changes to repositories or app code.

## Phase 3.5 — sync/async architecture decision

The current `Database` interface is synchronous (`prepare(sql).run(...)` returns immediately). `@capacitor-community/sqlite` is async — every method returns a Promise. Phase 3.5 must pick one of:

- **Option A:** Use Capacitor SQLite's synchronous mode (available via `executeSet` and similar; documented as experimental on some Android versions). Lets the current interface stand.
- **Option B:** Make the `Database` interface async. Touches every repo and every call site, but is the cleanest long-term shape.
- **Option C:** Keep `better-sqlite3` for Electron desktop and add a separate async Capacitor adapter only for mobile. Two interface variants.

This is a design decision for the Phase 3.5 plan, not a one-line code change.

## Test Coverage

41 tests covering the full data layer:

- 5 adapter tests (Database interface + better-sqlite3)
- 3 migration tests
- 9 RecordingsRepo tests
- 5 TranscriptsRepo tests
- 6 NotesRepo tests
- 4 SpeakerRolesRepo tests
- 5 SettingsRepo tests
- 1 integration test (full record → transcribe → role → note flow)

Run tests:

```bash
pnpm --filter @brtlb/db test
```

## Conventions

- All `id` columns are **TEXT** (UUID v4, minted by callers).
- All timestamps are **ISO-8601 strings** (`new Date().toISOString()`).
- Repos return `null` when not found, never `undefined`.
- Repos throw on constraint violations (foreign key, CHECK).
- Bulk inserts use a single transaction for atomicity.
- Camel-cased API (e.g., `createdAt`, `recordingId`); snake-cased database columns.

## Dependencies

- **better-sqlite3** (^11.3.0) — Node-side synchronous SQLite for testing. Production builds will use Capacitor SQLite.
- **TypeScript** — All repositories export types for type-safe usage.

---

**Phase 3 Status:** Data layer complete, test coverage full.  
**Phase 3.5 Next:** SQLCipher encryption, key derivation, platform keychain bridges.
