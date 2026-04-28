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
  /** When the ambient recording contained multiple patients, the per-patient segments
   * surfaced by the splitByPatient pass. Length 1 (or undefined) = single-patient. */
  patientSegments?: StoredPatientSegment[];
}

export interface StoredPatientSegment {
  id: string;
  patientLabel: string;
  visitType: string;
  includesPreventiveCare: boolean;
  acuteConcerns: string[];
  chiefComplaint: string;
  relevantUtteranceIndices: number[];
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
  /**
   * Chunked audio that's persisted while a recording is in progress so a
   * tab crash mid-visit doesn't lose the audio. Each chunk is a single
   * `ondataavailable` callback's data (typically ~1s). On successful
   * stop+save the chunks for that recording are cleared. On app load,
   * any chunks whose recordingId has no matching `recordings` entry are
   * treated as orphans from a crashed session and reconstructed.
   */
  audio_chunks: {
    key: [string, number];
    value: { recordingId: string; seq: number; blob: Blob; mimeType: string };
    indexes: { 'by-recordingId': string };
  };
}

const DB_NAME = 'brtlb-mvp';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<BrtlbSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<BrtlbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<BrtlbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('recordings')) {
            const store = db.createObjectStore('recordings', { keyPath: 'id' });
            store.createIndex('by-createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('audio')) {
            db.createObjectStore('audio', { keyPath: 'id' });
          }
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('audio_chunks')) {
            const chunks = db.createObjectStore('audio_chunks', {
              keyPath: ['recordingId', 'seq'],
            });
            chunks.createIndex('by-recordingId', 'recordingId');
          }
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
  await Promise.all([
    db.clear('recordings'),
    db.clear('audio'),
    db.clear('audio_chunks'),
  ]);
}

export async function appendAudioChunk(
  recordingId: string,
  seq: number,
  blob: Blob,
): Promise<void> {
  const db = await getDb();
  await db.put('audio_chunks', {
    recordingId,
    seq,
    blob,
    mimeType: blob.type,
  });
}

export async function getAudioChunks(
  recordingId: string,
): Promise<Array<{ seq: number; blob: Blob; mimeType: string }>> {
  const db = await getDb();
  const all = await db.getAllFromIndex('audio_chunks', 'by-recordingId', recordingId);
  return all
    .sort((a, b) => a.seq - b.seq)
    .map((c) => ({ seq: c.seq, blob: c.blob, mimeType: c.mimeType }));
}

export async function clearAudioChunks(recordingId: string): Promise<void> {
  const db = await getDb();
  const all = await db.getAllFromIndex('audio_chunks', 'by-recordingId', recordingId);
  await Promise.all(all.map((c) => db.delete('audio_chunks', [c.recordingId, c.seq])));
}

/**
 * Find chunks whose recordingId has no matching `recordings` entry — these
 * are orphans from a crashed session. Reconstruct each as a "recovered"
 * recording so the user can still process the audio.
 */
export async function recoverOrphanedRecordings(): Promise<string[]> {
  const db = await getDb();
  const allChunks = await db.getAll('audio_chunks');
  if (allChunks.length === 0) return [];

  const byRecording = new Map<string, typeof allChunks>();
  for (const c of allChunks) {
    const list = byRecording.get(c.recordingId);
    if (list) list.push(c);
    else byRecording.set(c.recordingId, [c]);
  }

  const recovered: string[] = [];
  for (const [recordingId, chunks] of byRecording) {
    const existing = await db.get('recordings', recordingId);
    if (existing) continue; // not orphaned — chunks just haven't been cleared yet
    chunks.sort((a, b) => a.seq - b.seq);
    const mimeType = chunks[0]?.mimeType || 'audio/webm';
    const blob = new Blob(
      chunks.map((c) => c.blob),
      { type: mimeType },
    );
    if (blob.size === 0) {
      // empty / corrupted — drop the chunks and move on
      await Promise.all(
        chunks.map((c) => db.delete('audio_chunks', [c.recordingId, c.seq])),
      );
      continue;
    }
    // Approximate duration from chunk count — recorder fires every 1s
    const approxDurationMs = chunks.length * 1000;
    const meta: RecordingMeta = {
      id: recordingId,
      createdAt: new Date().toISOString(),
      durationMs: approxDurationMs,
      mode: 'ambient',
      stage: 'recorded',
      errorMessage:
        'Recovered from a crashed session. Tap to process — the pipeline will run automatically.',
      transcriptText: null,
      noteMarkdown: null,
      templateId: 'soap',
      patternId: 'narrative',
      providerUsed: null,
      label: `Recovered ${Math.max(1, Math.round(approxDurationMs / 60_000))} min recording`,
    };
    await db.put('audio', { id: recordingId, blob, mimeType });
    await db.put('recordings', meta);
    await Promise.all(
      chunks.map((c) => db.delete('audio_chunks', [c.recordingId, c.seq])),
    );
    recovered.push(recordingId);
  }
  return recovered;
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
