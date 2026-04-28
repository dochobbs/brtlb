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
  /** Override the upstream base URL (e.g., to route through a proxy). */
  baseUrl?: string;
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
      const base = config.baseUrl ?? 'https://generativelanguage.googleapis.com';
      const url =
        `${base}/v1beta/models/${config.model}:generateContent` +
        `?key=${encodeURIComponent(config.apiKey)}`;

      // 10-minute timeout for long visits.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600_000);
      let res: Response;
      try {
        res = await http(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: config.maxOutputTokens ?? 4096 },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

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
