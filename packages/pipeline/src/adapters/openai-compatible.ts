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
      const prompt = composeNotePrompt(input);
      const c = await ensureClient();
      const response = await c.chat.completions.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const first = response.choices[0]?.message?.content;
      return first ?? '';
    },
  };
}
