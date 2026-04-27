import OpenAI from 'openai';
import type { GenerateNoteInput, LlmProvider, OpenAiCompatibleProviderConfig } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface OpenAiAdapterDeps {
  client?: Pick<OpenAI, 'chat'>;
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
  deps: OpenAiAdapterDeps = {},
): LlmProvider {
  const client =
    deps.client ??
    new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });

  return {
    name: 'openai-compatible',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const first = response.choices[0]?.message.content;
      return first ?? '';
    },
  };
}
