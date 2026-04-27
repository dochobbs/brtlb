import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic';
import type { GenerateNoteInput } from '../types';

function input(): GenerateNoteInput {
  return {
    transcript: {
      id: 't',
      recordingId: 'r',
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
    },
    template: { id: 'soap', name: 'SOAP', description: '', promptBody: 'Generate a SOAP note.' },
    pattern: {
      id: 'narrative',
      name: 'Narrative',
      description: '',
      promptModifier: 'Use prose.',
    },
    mode: 'ambient',
    speakerRoles: [],
  };
}

describe('createAnthropicProvider', () => {
  it('exposes name "anthropic"', () => {
    const provider = createAnthropicProvider({
      kind: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
    });
    expect(provider.name).toBe('anthropic');
  });

  it('calls messages.create with the composed prompt and returns the text response', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Generated SOAP note here.' }],
    });
    const provider = createAnthropicProvider(
      {
        kind: 'anthropic',
        apiKey: 'k',
        model: 'claude-sonnet-4-6',
        maxTokens: 2048,
      },
      { client: { messages: { create } } as never },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('Generated SOAP note here.');
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]![0];
    expect(args.model).toBe('claude-sonnet-4-6');
    expect(args.max_tokens).toBe(2048);
    expect(args.messages).toEqual([
      { role: 'user', content: expect.stringContaining('Generate a SOAP note.') },
    ]);
    expect(args.messages[0].content).toContain('[Parent] fever');
  });

  it('concatenates multiple text blocks in the response', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' },
      ],
    });
    const provider = createAnthropicProvider(
      { kind: 'anthropic', apiKey: 'k', model: 'm' },
      { client: { messages: { create } } as never },
    );
    const note = await provider.generateNote(input());
    expect(note).toBe('Part one. Part two.');
  });

  it('uses default maxTokens of 4096 when not specified', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const provider = createAnthropicProvider(
      { kind: 'anthropic', apiKey: 'k', model: 'm' },
      { client: { messages: { create } } as never },
    );
    await provider.generateNote(input());
    expect(create.mock.calls[0]![0].max_tokens).toBe(4096);
  });
});
