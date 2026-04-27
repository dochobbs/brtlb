import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicProviderConfig, GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface AnthropicAdapterDeps {
  client?: Pick<Anthropic, 'messages'>;
}

export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  deps: AnthropicAdapterDeps = {},
): LlmProvider {
  let client = deps.client ?? null;

  async function ensureClient(): Promise<Pick<Anthropic, 'messages'>> {
    if (client) return client;
    const { default: AnthropicCtor } = await import('@anthropic-ai/sdk');
    client = new AnthropicCtor({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });
    return client;
  }

  return {
    name: 'anthropic',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const c = await ensureClient();
      const response = await c.messages.create({
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
