import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type RecordingStage =
  | 'recording'
  | 'recorded'
  | 'uploading'
  | 'transcribing'
  | 'generating'
  | 'ready_for_review'
  | 'failed';

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

export function resetDbForTests(): void {
  dbPromise = null;
}
