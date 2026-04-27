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
