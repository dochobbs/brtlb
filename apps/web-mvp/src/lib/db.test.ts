import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendAudioChunk,
  clearAll,
  deleteRecording,
  getAudio,
  listRecordings,
  putAudio,
  putRecording,
  recoverOrphanedRecordings,
  resetDbForTests,
  type RecordingMeta,
} from './db';

function rec(overrides: Partial<RecordingMeta> = {}): RecordingMeta {
  return {
    id: overrides.id ?? 'r1',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    durationMs: 0,
    mode: 'ambient',
    stage: 'recorded',
    errorMessage: null,
    transcriptText: null,
    noteMarkdown: null,
    templateId: 'soap',
    patternId: 'narrative',
    providerUsed: null,
    ...overrides,
  };
}

describe('db', () => {
  beforeEach(async () => {
    resetDbForTests();
    const { indexedDB } = await import('fake-indexeddb');
    (globalThis as { indexedDB: typeof indexedDB }).indexedDB = indexedDB;
    await clearAll();
  });

  it('round-trips a recording', async () => {
    await putRecording(rec({ id: 'a', durationMs: 1000 }));
    const all = await listRecordings();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('a');
    expect(all[0]?.durationMs).toBe(1000);
  });

  it('lists recordings newest-first', async () => {
    await putRecording(rec({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }));
    await putRecording(rec({ id: 'new', createdAt: '2026-04-26T00:00:00Z' }));
    const all = await listRecordings();
    expect(all.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('stores and retrieves audio entries', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    await putAudio('a', blob);
    const got = await getAudio('a');
    // fake-indexeddb's structured clone of Blob varies by version; we just
    // assert the entry round-trips at all. Real browser Blob fidelity is
    // covered by the manual smoke test in apps/web-mvp.
    expect(got).not.toBeNull();
  });

  it('deleting a recording also removes its audio', async () => {
    await putRecording(rec({ id: 'a' }));
    await putAudio('a', new Blob([new Uint8Array([1])]));
    await deleteRecording('a');
    expect(await listRecordings()).toEqual([]);
    expect(await getAudio('a')).toBeNull();
  });

  // Dead-battery / force-quit / OS-kill mid-recording: putRecording is only
  // called after stop() resolves, so a tab that dies during recording leaves
  // audio_chunks in IDB with no recordings entry. recoverOrphanedRecordings
  // is the load-bearing recovery path for this case.
  it('recovers a recording that died mid-capture (dead-battery / orphan chunks)', async () => {
    const orphanId = 'orphan-1';
    await appendAudioChunk(orphanId, 0, new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }));
    await appendAudioChunk(orphanId, 1, new Blob([new Uint8Array([3, 4])], { type: 'audio/webm' }));
    await appendAudioChunk(orphanId, 2, new Blob([new Uint8Array([5, 6])], { type: 'audio/webm' }));

    const recovered = await recoverOrphanedRecordings();
    expect(recovered).toEqual([orphanId]);

    const all = await listRecordings();
    expect(all).toHaveLength(1);
    const rec = all[0];
    expect(rec?.id).toBe(orphanId);
    expect(rec?.stage).toBe('recorded');
    // ~1s per chunk × 3 chunks
    expect(rec?.durationMs).toBe(3000);
    // Audio is reassembled and stored under the same id
    expect(await getAudio(orphanId)).not.toBeNull();
  });

  it('does not re-recover an orphan whose chunks are already cleared', async () => {
    // Round 1: orphan recovery runs
    await appendAudioChunk('orphan-2', 0, new Blob([new Uint8Array([1])]));
    await recoverOrphanedRecordings();
    // Round 2: should be a no-op (no chunks left)
    const recovered2 = await recoverOrphanedRecordings();
    expect(recovered2).toEqual([]);
  });
});
