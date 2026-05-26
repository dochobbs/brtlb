import type { GeminiVertexProviderConfig, GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

interface VertexAuthClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

export interface GeminiVertexAdapterDeps {
  authClient?: VertexAuthClient;
  httpClient?: typeof fetch;
}

interface VertexResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function buildAuthClient(serviceAccountJson: string): Promise<VertexAuthClient> {
  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };
  const { JWT } = await import('google-auth-library');
  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  }) as unknown as VertexAuthClient;
}

export function createGeminiVertexProvider(
  config: GeminiVertexProviderConfig,
  deps: GeminiVertexAdapterDeps = {},
): LlmProvider {
  let auth = deps.authClient ?? null;
  const http = deps.httpClient ?? globalThis.fetch;

  async function ensureAuth(): Promise<VertexAuthClient> {
    if (auth) return auth;
    auth = await buildAuthClient(config.serviceAccountJson);
    return auth;
  }

  return {
    name: 'gemini-vertex',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const { system, user } = composeNotePrompt(input);
      const a = await ensureAuth();
      const tokenResponse = await a.getAccessToken();
      const token = tokenResponse.token;
      if (!token) throw new Error('gemini-vertex: failed to obtain access token');

      const url = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;

      const res = await http(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // System+user split, same rationale as gemini-api-key adapter.
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`gemini-vertex: ${res.status} ${body}`);
      }

      const json = (await res.json()) as VertexResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}
