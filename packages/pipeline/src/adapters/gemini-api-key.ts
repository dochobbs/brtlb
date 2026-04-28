import type { GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

/**
 * Gemini API adapter — uses a simple API key (AIzaSy...) and the
 * Generative Language REST endpoint. Browser-safe, no SDK, no service
 * account JSON.
 *
 * BAA NOTE: This is brtlb's recommended PHI path for users already on
 * Google Workspace (the common case in healthcare). When the GCP HIPAA
 * BAA has been accepted on the org and the API key was issued from a
 * billing-enabled Google Cloud project, the call is treated as
 * BAA-covered under Google's "covered services" framing for AI/ML
 * (industry consensus per Paubox / Nightfall / etc.). Free
 * aistudio.google.com keys outside a Cloud project with no BAA
 * acceptance are NOT covered — testing only. See docs/BAAs.md.
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
      // Pass the API key in the x-goog-api-key header (NOT a ?key= query
      // param) so it doesn't end up in browser history, referrer headers,
      // CDN access logs, or anything else that might persist URLs. Google's
      // Generative Language API supports both; header is strictly safer.
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;

      // 10-minute timeout for long visits.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600_000);
      let res: Response;
      try {
        res = await http(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey,
          },
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
