import type OpenAI from 'openai';
import type { GenerateNoteInput, LlmProvider, OpenAiCompatibleProviderConfig } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface OpenAiAdapterDeps {
  client?: Pick<OpenAI, 'chat'>;
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
  deps: OpenAiAdapterDeps = {},
): LlmProvider {
  let client = deps.client ?? null;

  async function ensureClient(): Promise<Pick<OpenAI, 'chat'>> {
    if (client) return client;
    const { default: OpenAICtor } = await import('openai');
    client = new OpenAICtor({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
      // Long visits + gpt-4o can take 5+ min to draft; 10-minute timeout.
      timeout: 600_000,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    return client;
  }

  return {
    name: 'openai-compatible',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const { system, user } = composeNotePrompt(input);
      const c = await ensureClient();
      const response = await c.chat.completions.create({
        model: config.model,
        // Default raised from 4096 to 16384 (2026-05-18) for parity
        // with the other adapters — splitter stage-2 + long visits
        // benefit from headroom; over-allocation is free since the
        // OpenAI-style APIs bill on actual usage, not the cap.
        max_tokens: config.maxTokens ?? 16384,
        // System+user split: template body + discipline rules go in the
        // system message (OpenAI weights system-role content more heavily
        // for instruction-following); the transcript stays in user.
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const first = response.choices[0]?.message?.content;
      return first ?? '';
    },
  };
}
