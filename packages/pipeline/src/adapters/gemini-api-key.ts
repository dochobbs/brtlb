import type { GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

/**
 * Gemini AI Studio adapter — uses a simple API key (AIzaSy...) and the
 * Generative Language REST endpoint. Browser-safe, no SDK, no service
 * account JSON.
 *
 * NOTE: AI Studio keys are NOT BAA-eligible. For PHI workloads, use the
 * Vertex AI adapter (createGeminiVertexProvider) which goes through Google
 * Cloud's HIPAA-compliant offering.
 */

export interface GeminiApiKeyProviderConfig {
  kind: 'gemini-api-key';
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
}

export interface GeminiApiKeyAdapterDeps {
  httpClient?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export function createGeminiApiKeyProvider(
  config: GeminiApiKeyProviderConfig,
  deps: GeminiApiKeyAdapterDeps = {},
): LlmProvider {
  const http = deps.httpClient ?? globalThis.fetch;

  return {
    name: 'gemini-api-key',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent` +
        `?key=${encodeURIComponent(config.apiKey)}`;

      const res = await http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: config.maxOutputTokens ?? 4096 },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`gemini-api-key: ${res.status} ${body}`);
      }

      const json = (await res.json()) as GeminiResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}
