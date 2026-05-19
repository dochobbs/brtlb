import type { GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';
import { classifyFetchError } from '../errors';

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
            // Default raised from 4096 to 16384 (2026-05-18). Gemini 2.5
            // Pro uses extended-thinking tokens that count toward this
            // cap; on long sibling-visit splitter prompts the model can
            // burn ~8K tokens on hidden reasoning before producing any
            // output text. 4096 left zero room and the response came
            // back empty (finishReason: MAX_TOKENS, parts: []), which
            // the splitter logged as a JSON parse error and fell back
            // to single-patient — silently losing siblings. 16384
            // leaves headroom for thinking + a long structured-output
            // response. Callers can override per-request.
            generationConfig: { maxOutputTokens: config.maxOutputTokens ?? 16384 },
          }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        // Network-layer rejection. iOS Safari's "Load failed" is the
        // most painful case to surface to physicians without context.
        clearTimeout(timer);
        throw classifyFetchError('Gemini', 'generate', fetchErr);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw classifyGeminiError(res.status, body);
      }

      const json = (await res.json()) as GeminiResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}

/**
 * Turn a Gemini API HTTP error into an actionable Error. Distinguishes:
 * - billing not linked / API not enabled (403 + billing/CONSUMER_INVALID)
 * - quota exceeded (429)
 * - Workspace org-policy block (API_KEYS_DISALLOWED)
 * - bad/invalid key (400 INVALID_ARGUMENT)
 * - model not available (404)
 *
 * Error subclassing isn't worth it; substring detection on the message is
 * sufficient for retry classification and UI routing.
 */
function classifyGeminiError(status: number, body: string): Error {
  const lc = body.toLowerCase();

  // 403 + billing keywords → Cloud project doesn't have billing linked
  if (
    status === 403 &&
    (/billing/i.test(body) || /CONSUMER_INVALID/i.test(body) || /SERVICE_DISABLED/i.test(body))
  ) {
    return new Error(
      'gemini-api-key: your Gemini Cloud project either has no billing linked or the Generative Language API is disabled. Link billing at https://console.cloud.google.com/billing/linkedaccount and confirm the API is enabled at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com — same key will work once both are set.',
    );
  }

  // 403 with API key disallowed → org policy block
  if (
    status === 403 &&
    (/API[_ ]Keys?[_ ](are[_ ])?Disallowed/i.test(body) ||
      /iam\.managed\.disableServiceAccountApiKeyCreation/i.test(body))
  ) {
    return new Error(
      "gemini-api-key: your Workspace org policy blocks API key creation for this project. As a Workspace admin, override at https://console.cloud.google.com/iam-admin/orgpolicies/list (filter by 'api'). See the wizard's admin path for full steps.",
    );
  }

  // 429 → quota / rate limit
  if (status === 429 || lc.includes('quota') || lc.includes('rate limit')) {
    return new Error(
      'gemini-api-key: quota exceeded or rate limit hit. Wait a minute and try again, or upgrade your Cloud project quota at https://console.cloud.google.com/iam-admin/quotas (filter by Generative Language API).',
    );
  }

  // 401 / generic 403 → bad key
  if (status === 401 || status === 403) {
    return new Error(
      `gemini-api-key: authentication failed. Verify your Gemini API key in Settings is correct and active. (HTTP ${status})`,
    );
  }

  // 400 with INVALID_ARGUMENT → malformed request, often bad model name or
  // unrecognized parameter
  if (status === 400) {
    return new Error(
      `gemini-api-key: request rejected. ${body.slice(0, 200)} (HTTP 400) — try "List my models" in Settings to pick a valid model.`,
    );
  }

  // 404 → model name not available to this key/project
  if (status === 404) {
    return new Error(
      `gemini-api-key: model not found for this key. The model name may have been retired or your project doesn't have access. Use "List my models" in Settings to pick one. (HTTP 404)`,
    );
  }

  // Generic fallback
  return new Error(`gemini-api-key: ${status} ${body.slice(0, 300)}`);
}
