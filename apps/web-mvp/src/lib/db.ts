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
  /** Diarization quality hints from the pipeline — drives Review banners
   * for suspected speaker-count collapse / within-count merge. Optional
   * for backward compatibility with recordings made before the hints
   * landed. See diarization-hints.ts. */
  diarizationHints?: StoredDiarizationHints;
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
  /** Long-visit chapter markers — populated only for recordings >30 min ambient.
   * A short list of named segments to make a long transcript navigable. */
  transcriptChapters?: TranscriptChapter[];
  /** Verbatim quotes from the visit worth preserving — generated on demand. */
  quotesMarkdown?: string | null;
  /** When quotes were last generated. */
  quotesAt?: string | null;
  /**
   * Why the recording ended. `user` = physician pressed Stop;
   * `silence_autostop` = 30-min idle + 60-s grace fired; `error` = mic
   * track ended / recorder error. Optional because legacy records
   * pre-date the field.
   */
  stopReason?: 'user' | 'silence_autostop' | 'error' | null;
}

export interface TranscriptChapter {
  /** Short label like "Parent interview", "Child observation", "Discussion of findings". */
  label: string;
  /** Starting timestamp in milliseconds (from start of recording). */
  startMs: number;
  /** One-line summary of what's in this chapter, for at-a-glance scanning. */
  summary: string;
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

/** Persisted form of DiarizationHints (string union narrowed to literals here
 * so this module stays self-contained — kept in sync with diarization-hints.ts). */
export interface StoredDiarizationHints {
  lowSpeakerCount: boolean;
  collapseSuspected: Array<{
    speakerId: string;
    reason: 'low_conf' | 'omitted' | 'other_role_substantive';
  }>;
  /** Tier 2 recovery suggestions — per-speaker keep/split verdicts. */
  recoverySuggestions?: StoredRecoverySuggestion[];
}

export interface StoredRecoverySuggestion {
  speakerId: string;
  decision: 'keepAsIs' | 'split';
  reason?: string;
  splits?: Array<{
    role: 'provider' | 'parent' | 'patient' | 'sibling' | 'other';
    indices: number[];
    confidence: number;
    rationale?: string;
  }>;
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
  /**
   * Compact local audit log for HIPAA technical-safeguard hygiene
   * (45 CFR 164.312(b)). Contains only timestamps + action types — never
   * patient identifiers, transcript snippets, or note content. Capped at
   * AUDIT_LOG_CAP entries with FIFO trimming so the log stays small.
   */
  audit_log: {
    key: number; // auto-increment
    value: AuditLogEntry;
    indexes: { 'by-ts': number };
  };
}

export type AuditAction =
  | 'record_started'
  | 'record_completed'
  | 'transcribe_started'
  | 'transcribe_completed'
  | 'transcribe_failed'
  | 'generate_completed'
  | 'generate_failed'
  | 'note_copied'
  | 'note_shared'
  | 'note_downloaded'
  | 'note_deleted'
  | 'audio_purged'
  | 'wipe_all'
  | 'clipboard_cleared'
  | 'settings_saved';

export interface AuditLogEntry {
  /** Auto-assigned at write time. */
  id?: number;
  /** Epoch ms. Indexed for chronological scan. */
  ts: number;
  action: AuditAction;
  /** Internal recording UUID — not a patient identifier. Only set when
   * the action concerns a specific recording. */
  recordingId?: string;
  /** Optional non-PHI numeric tag (e.g., duration ms, count of items). */
  n?: number;
}

const DB_NAME = 'brtlb-mvp';
const DB_VERSION = 3;
const AUDIT_LOG_CAP = 200;

let dbPromise: Promise<IDBPDatabase<BrtlbSchema>> | null = null;

/**
 * The most insidious failure mode for IDB: if another tab has the DB
 * open at an older version (e.g., a brtlb tab still on v2 when this tab
 * tries to upgrade to v3), the openDB promise hangs forever. listRecordings,
 * putRecording, etc. all stall behind it. Symptoms: home screen stuck on
 * "Loading…", Stop button produces a blank screen because the meta write
 * never resolves.
 *
 * Fix: handle `blocked` and `blocking` callbacks. Show the user a clear
 * error and reload the page when other tabs close. Also surface the
 * `terminated` event so a closed DB connection isn't held forever.
 */
let dbBlockedAlertShown = false;

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
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('audit_log')) {
            const log = db.createObjectStore('audit_log', {
              keyPath: 'id',
              autoIncrement: true,
            });
            log.createIndex('by-ts', 'ts');
          }
        }
      },
      // Fires in OTHER tabs when this tab is trying to upgrade. Close the
      // existing connection so this tab can proceed.
      blocking() {
        try {
          // Force-close this old connection. The new-version tab will then
          // open successfully.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          dbPromise!.then((db) => db.close()).catch(() => {});
          dbPromise = null;
        } catch {
          // ignore
        }
      },
      // Fires in THIS tab when openDB is waiting on other tabs to close.
      blocked() {
        if (dbBlockedAlertShown) return;
        dbBlockedAlertShown = true;
        console.warn('brtlb: IDB upgrade blocked by another tab. Asking user to close it.');
        if (typeof window !== 'undefined') {
          // Use alert so the user can't miss it. The alternative is a stuck
          // page with no explanation.
          window.alert(
            'brtlb is updating to a new version of its local database, but another brtlb tab is still open on the old version. Close any other brtlb tabs / windows and reload this page.',
          );
        }
      },
      terminated() {
        // Connection closed unexpectedly — drop the cached promise so the
        // next call re-opens cleanly.
        dbPromise = null;
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
    db.clear('audit_log'),
  ]);
}

/**
 * Append a single entry to the local audit log. Best-effort: failures are
 * swallowed (a logging failure should never break the action). Trims to
 * AUDIT_LOG_CAP via FIFO when the log grows past cap.
 */
export async function logAudit(
  action: AuditAction,
  extra?: { recordingId?: string; n?: number },
): Promise<void> {
  try {
    const db = await getDb();
    const entry: AuditLogEntry = { ts: Date.now(), action, ...extra };
    const tx = db.transaction('audit_log', 'readwrite');
    await tx.store.add(entry);
    // Cheap cap-and-trim: only inspect count, only delete if over.
    const count = await tx.store.count();
    if (count > AUDIT_LOG_CAP) {
      const cursor = await tx.store.index('by-ts').openCursor();
      let toDelete = count - AUDIT_LOG_CAP;
      let c = cursor;
      while (c && toDelete > 0) {
        await c.delete();
        toDelete -= 1;
        c = await c.continue();
      }
    }
    await tx.done;
  } catch {
    // ignore — never break the user-visible action because the log failed
  }
}

/**
 * Returns audit log entries newest-first. `limit` defaults to 100; pass
 * Infinity (or a large number) for the full log.
 */
export async function listAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex('audit_log', 'by-ts');
    return all.slice(-limit).reverse();
  } catch {
    return [];
  }
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
      await Promise.all(chunks.map((c) => db.delete('audio_chunks', [c.recordingId, c.seq])));
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
    await Promise.all(chunks.map((c) => db.delete('audio_chunks', [c.recordingId, c.seq])));
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
    void logAudit('audio_purged', { recordingId: rec.id });
  }
  return purged;
}

/**
 * Recover recordings stuck in a transient pipeline stage. If the tab closed
 * mid-pipeline, those recordings will sit in {uploading, transcribing,
 * generating} forever. Anything older than `cutoffMs` and still in a
 * transient stage gets flipped to `failed` with a clear message so the
 * existing Retry path can resume from audio.
 *
 * Note: the dead-battery case (tab died mid-capture before stop()) is
 * covered by `recoverOrphanedRecordings`, not here. `putRecording` only
 * runs after stop() resolves, so a tab that dies during recording leaves
 * audio_chunks with no recordings entry — exactly the orphan case.
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
