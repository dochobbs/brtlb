import { describe, expect, it, vi } from 'vitest';
import { createGeminiApiKeyProvider } from './gemini-api-key';
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
          endMs: 500,
          text: 'rash',
          confidence: 0.9,
        },
      ],
      createdAt: '2026-04-26T00:00:00Z',
    },
    template: { id: 't', name: 'T', description: '', promptBody: 'SOAP.' },
    pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Brief.' },
    mode: 'ambient',
    speakerRoles: [],
  };
}

describe('createGeminiApiKeyProvider', () => {
  it('name is "gemini-api-key"', () => {
    const p = createGeminiApiKeyProvider({
      kind: 'gemini-api-key',
      apiKey: 'AIza-fake',
      model: 'gemini-2.0-flash',
    });
    expect(p.name).toBe('gemini-api-key');
  });

  it('POSTs to v1beta generateContent with the api key in x-goog-api-key header (NOT in URL)', async () => {
    let receivedUrl = '';
    let receivedBody: Record<string, unknown> = {};
    let receivedHeaders: Record<string, string> = {};
    const httpClient = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = url.toString();
      receivedBody = JSON.parse(init?.body as string);
      const h = init?.headers as Record<string, string> | undefined;
      receivedHeaders = h ?? {};
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const p = createGeminiApiKeyProvider(
      { kind: 'gemini-api-key', apiKey: 'AIza-fake', model: 'gemini-2.0-flash' },
      { httpClient },
    );
    const note = await p.generateNote(input());
    expect(note).toBe('OK');
    // URL must NOT contain the api key — that was a leak vector via browser
    // history / referrer headers / CDN logs.
    expect(receivedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    );
    expect(receivedUrl).not.toContain('AIza-fake');
    expect(receivedUrl).not.toContain('?key=');
    // Key travels in the x-goog-api-key header instead.
    expect(receivedHeaders['x-goog-api-key']).toBe('AIza-fake');
    // Instructions live in systemInstruction; transcript in contents[user].
    // Cross-check the split actually happened: instructions must NOT appear
    // in the user message, transcript must NOT appear in the system slot.
    expect(receivedBody).toEqual({
      systemInstruction: { parts: [{ text: expect.stringContaining('SOAP.') }] },
      contents: [{ role: 'user', parts: [{ text: expect.stringContaining('rash') }] }],
      generationConfig: { maxOutputTokens: 16384 },
    });
    const sys = (
      receivedBody.systemInstruction as { parts: Array<{ text: string }> }
    ).parts[0]!.text;
    const usr = (
      receivedBody.contents as Array<{ parts: Array<{ text: string }> }>
    )[0]!.parts[0]!.text;
    expect(sys).toContain('DOCUMENTATION DISCIPLINE');
    expect(sys).not.toContain('rash');
    expect(usr).not.toContain('SOAP.');
    expect(usr).not.toContain('DOCUMENTATION DISCIPLINE');
  });

  it('throws on non-2xx response', async () => {
    const httpClient = vi.fn(
      async () => new Response('forbidden', { status: 403 }),
    ) as unknown as typeof fetch;
    const p = createGeminiApiKeyProvider(
      { kind: 'gemini-api-key', apiKey: 'k', model: 'm' },
      { httpClient },
    );
    await expect(p.generateNote(input())).rejects.toThrow(/gemini-api-key: authentication failed.*HTTP 403/);
  });

  it('concatenates multiple text parts of the first candidate', async () => {
    const httpClient = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'A.' }, { text: ' B.' }] } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const p = createGeminiApiKeyProvider(
      { kind: 'gemini-api-key', apiKey: 'k', model: 'm' },
      { httpClient },
    );
    expect(await p.generateNote(input())).toBe('A. B.');
  });
});
