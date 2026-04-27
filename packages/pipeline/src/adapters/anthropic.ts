import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicProviderConfig, GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface AnthropicAdapterDeps {
  client?: Pick<Anthropic, 'messages'>;
}

export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  deps: AnthropicAdapterDeps = {},
): LlmProvider {
  const client = deps.client ?? new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const parts: string[] = [];
      for (const block of response.content) {
        if (block.type === 'text') parts.push(block.text);
      }
      return parts.join('');
    },
  };
}
