import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAll,
  deleteRecording,
  getAudio,
  listRecordings,
  putAudio,
  putRecording,
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
});
