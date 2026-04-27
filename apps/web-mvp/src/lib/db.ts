import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type RecordingStage =
  | 'recording'
  | 'recorded'
  | 'uploading'
  | 'transcribing'
  | 'generating'
  | 'ready_for_review'
  | 'failed';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface SpeakerRoleAssignment {
  speakerId: string;
  role: SpeakerRole;
}

export interface RecordingBookmark {
  /** Milliseconds from the start of the recording. */
  ms: number;
  /** Optional short label dictated by the physician. */
  label?: string | null;
}

export interface RecordingMeta {
  id: string;
  createdAt: string;
  durationMs: number;
  mode: 'ambient' | 'dictation';
  stage: RecordingStage;
  errorMessage: string | null;
  transcriptText: string | null;
  /** Full structured transcript (Transcript JSON) — needed for regenerate. */
  transcriptJson?: string | null;
  noteMarkdown: string | null;
  templateId: string;
  patternId: string;
  providerUsed: string | null;
  /** Set when the audio blob has been auto-purged but metadata kept. */
  audioPurgedAt?: string | null;
  /** Free-form short label shown on Home list, e.g. "MM age 4 WCV". */
  label?: string | null;
  /** Speaker → role assignments fed into regenerate prompts. */
  speakerRoles?: SpeakerRoleAssignment[];
  /** Markdown output from the Roci-style QA review pass; null if not run. */
  qaReviewMarkdown?: string | null;
  /** When QA review was last run. */
  qaReviewedAt?: string | null;
  /** Markdown output from the Roci-style clinical pearls pass; null if not run. */
  pearlsMarkdown?: string | null;
  /** When pearls were last generated. */
  pearlsAt?: string | null;
  /** Physician-tapped moments during recording, fed to the note prompt as context. */
  bookmarks?: RecordingBookmark[];
}

interface BrtlbSchema extends DBSchema {
  recordings: {
    key: string;
    value: RecordingMeta;
    indexes: { 'by-createdAt': string };
  };
  audio: {
    key: string;
    value: { id: string; blob: Blob; mimeType: string };
  };
}

const DB_NAME = 'brtlb-mvp';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BrtlbSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<BrtlbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<BrtlbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('recordings')) {
          const store = db.createObjectStore('recordings', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function putRecording(rec: RecordingMeta): Promise<void> {
  const db = await getDb();
  await db.put('recordings', rec);
}

export async function getRecording(id: string): Promise<RecordingMeta | undefined> {
  const db = await getDb();
  return db.get('recordings', id);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('recordings', 'by-createdAt');
  return all.reverse();
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  await Promise.all([db.delete('recordings', id), db.delete('audio', id)]);
}

export async function putAudio(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('audio', { id, blob, mimeType: blob.type });
}

export async function getAudio(id: string): Promise<Blob | null> {
  const db = await getDb();
  const entry = await db.get('audio', id);
  return entry?.blob ?? null;
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear('recordings'), db.clear('audio')]);
}

/**
 * Drop audio blobs for any recording older than `cutoffIso` AND whose
 * audio hasn't already been purged. Keeps the metadata + transcript +
 * note so the user can still read past visits — only the heavy PHI
 * (raw audio) is removed. Returns the IDs that were purged.
 */
export async function purgeStaleAudio(cutoffIso: string): Promise<string[]> {
  const db = await getDb();
  const all = await db.getAll('recordings');
  const purged: string[] = [];
  for (const rec of all) {
    if (rec.audioPurgedAt) continue;
    if (rec.createdAt >= cutoffIso) continue;
    await db.delete('audio', rec.id);
    const updated: RecordingMeta = {
      ...rec,
      audioPurgedAt: new Date().toISOString(),
    };
    await db.put('recordings', updated);
    purged.push(rec.id);
  }
  return purged;
}

/**
 * Recover recordings stuck in a transient pipeline stage. If the tab closed
 * mid-pipeline, those recordings will sit in {uploading, transcribing,
 * generating} forever. Anything older than `cutoffMs` and still in a
 * transient stage gets flipped to `failed` with a clear message so the
 * existing Retry path can resume from audio.
 */
const TRANSIENT_STAGES: ReadonlySet<RecordingStage> = new Set([
  'uploading',
  'transcribing',
  'generating',
]);

export async function recoverInterruptedRecordings(cutoffMs = 5 * 60_000): Promise<string[]> {
  const db = await getDb();
  const all = await db.getAll('recordings');
  const now = Date.now();
  const recovered: string[] = [];
  for (const rec of all) {
    if (!TRANSIENT_STAGES.has(rec.stage)) continue;
    const ageMs = now - new Date(rec.createdAt).getTime();
    if (ageMs < cutoffMs) continue;
    const updated: RecordingMeta = {
      ...rec,
      stage: 'failed',
      errorMessage: rec.audioPurgedAt
        ? 'Recording was interrupted before processing completed and audio is no longer available.'
        : 'Recording was interrupted before processing completed. Tap Retry to resume.',
    };
    await db.put('recordings', updated);
    recovered.push(rec.id);
  }
  return recovered;
}

export function resetDbForTests(): void {
  dbPromise = null;
}
