import { describe, expect, it, vi } from 'vitest';
import { runPipeline } from './orchestrator';
import type { LlmProvider, ProviderConfig, Transcript } from './types';

function fakeTranscript(): Transcript {
  return {
    id: 'tr',
    recordingId: '',
    utterances: [
      {
        speakerId: 'A',
        role: 'parent',
        startMs: 0,
        endMs: 1000,
        text: 'fever',
        confidence: 0.9,
      },
    ],
    createdAt: '2026-04-26T00:00:00Z',
  };
}

const provConfig: ProviderConfig = {
  kind: 'anthropic',
  apiKey: 'k',
  model: 'claude-sonnet-4-6',
};

describe('runPipeline', () => {
  it('runs transcribe then generate, returning both', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('SOAP note text.');
    const provider: LlmProvider = { name: 'anthropic', generateNote };
    const createProvider = vi.fn(() => provider);

    const out = await runPipeline(
      {
        recordingId: 'rec_42',
        audioPath: '/tmp/x.m4a',
        mode: 'ambient',
        template: { id: 'soap', name: 'SOAP', description: '', promptBody: 'Generate.' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Brief.' },
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
      },
      { transcribe, createProvider },
    );

    expect(out.transcript.recordingId).toBe('rec_42');
    expect(out.note).toBe('SOAP note text.');
    expect(out.providerUsed).toBe('anthropic');

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        audioPath: '/tmp/x.m4a',
        mode: 'ambient',
        config: { apiKey: 'aai' },
      }),
    );

    expect(createProvider).toHaveBeenCalledWith(provConfig);

    expect(generateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.objectContaining({ recordingId: 'rec_42' }),
        speakerRoles: [],
      }),
    );
  });

  it('passes through speakerRoles when provided', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('ok');
    const createProvider = vi.fn(() => ({ name: 'anthropic', generateNote }));

    await runPipeline(
      {
        recordingId: 'r',
        audioPath: '/tmp/a.m4a',
        mode: 'ambient',
        template: { id: 't', name: 'T', description: '', promptBody: 'g' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'p' },
        speakerRoles: [{ speakerId: 'A', role: 'parent' }],
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
      },
      { transcribe, createProvider },
    );

    expect(generateNote.mock.calls[0]![0].speakerRoles).toEqual([
      { speakerId: 'A', role: 'parent' },
    ]);
  });

  it('passes wordBoost down to transcribe', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('ok');
    const createProvider = vi.fn(() => ({ name: 'anthropic', generateNote }));

    await runPipeline(
      {
        recordingId: 'r',
        audioPath: '/tmp/a.m4a',
        mode: 'ambient',
        template: { id: 't', name: 'T', description: '', promptBody: 'g' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'p' },
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
        wordBoost: ['amoxicillin'],
      },
      { transcribe, createProvider },
    );

    expect(transcribe.mock.calls[0]![0].wordBoost).toEqual(['amoxicillin']);
  });
});
