import { describe, expect, it, vi } from 'vitest';
import { createGeminiVertexProvider } from './gemini-vertex';
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

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'test-proj',
  private_key_id: 'k',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-proj.iam.gserviceaccount.com',
  client_id: '0',
  token_uri: 'https://oauth2.googleapis.com/token',
});

describe('createGeminiVertexProvider', () => {
  it('name is "gemini-vertex"', () => {
    const provider = createGeminiVertexProvider({
      kind: 'gemini-vertex',
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      projectId: 'test-proj',
      location: 'us-central1',
      model: 'gemini-2.0-pro',
    });
    expect(provider.name).toBe('gemini-vertex');
  });

  it('calls Vertex generateContent with composed prompt and bearer token', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'ya29.fake' });
    let receivedUrl = '';
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const httpClient = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = url.toString();
      receivedHeaders = (init?.headers ?? {}) as Record<string, string>;
      receivedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Vertex SOAP output.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'test-proj',
        location: 'us-central1',
        model: 'gemini-2.0-pro',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('Vertex SOAP output.');
    expect(receivedUrl).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-proj/locations/us-central1/publishers/google/models/gemini-2.0-pro:generateContent',
    );
    expect(receivedHeaders.Authorization).toBe('Bearer ya29.fake');
    // Instructions go in systemInstruction (Gemini's dedicated rule slot);
    // transcript stays in contents[user].
    expect(receivedBody).toEqual({
      systemInstruction: { parts: [{ text: expect.stringContaining('SOAP.') }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: expect.stringContaining('rash') }],
        },
      ],
    });
  });

  it('throws on non-2xx vertex response', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 't' });
    const httpClient = vi.fn(
      async () =>
        new Response('quota exceeded', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        }),
    ) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'p',
        location: 'us-central1',
        model: 'm',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    await expect(provider.generateNote(input())).rejects.toThrow(/429/);
  });

  it('concatenates multiple text parts of the first candidate', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 't' });
    const httpClient = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'A. ' }, { text: 'B.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'p',
        location: 'us-central1',
        model: 'm',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    expect(await provider.generateNote(input())).toBe('A. B.');
  });
});
