import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { GenerateNoteInput } from '../types';

function input(): GenerateNoteInput {
  return {
    transcript: {
      id: 't',
      recordingId: 'r',
      utterances: [
        {
          speakerId: 'A',
          role: 'patient',
          startMs: 0,
          endMs: 1000,
          text: 'cough',
          confidence: 0.9,
        },
      ],
      createdAt: '2026-04-26T00:00:00Z',
    },
    template: { id: 't', name: 'T', description: '', promptBody: 'Generate.' },
    pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Bullet points.' },
    mode: 'ambient',
    speakerRoles: [],
  };
}

describe('createOpenAiCompatibleProvider', () => {
  it('name is "openai-compatible"', () => {
    const provider = createOpenAiCompatibleProvider({
      kind: 'openai-compatible',
      apiKey: 'k',
      model: 'gpt-4o',
    });
    expect(provider.name).toBe('openai-compatible');
  });

  it('calls chat.completions.create with composed prompt as a user message', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK note' } }],
    });
    const provider = createOpenAiCompatibleProvider(
      {
        kind: 'openai-compatible',
        apiKey: 'k',
        model: 'gpt-4o',
        maxTokens: 1000,
      },
      { client: { chat: { completions: { create } } } as never },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('OK note');
    const args = create.mock.calls[0]![0];
    expect(args.model).toBe('gpt-4o');
    expect(args.max_tokens).toBe(1000);
    expect(args.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('cough'),
    });
  });

  it('returns empty string when message content is null', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const provider = createOpenAiCompatibleProvider(
      { kind: 'openai-compatible', apiKey: 'k', model: 'm' },
      { client: { chat: { completions: { create } } } as never },
    );
    expect(await provider.generateNote(input())).toBe('');
  });

  it('returns empty string when choices[0] has no message field', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{}] });
    const provider = createOpenAiCompatibleProvider(
      { kind: 'openai-compatible', apiKey: 'k', model: 'm' },
      { client: { chat: { completions: { create } } } as never },
    );
    expect(await provider.generateNote(input())).toBe('');
  });
});
