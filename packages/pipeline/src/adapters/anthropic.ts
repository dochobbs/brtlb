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
    client = new AnthropicCtor({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
      // Long ambient visits + Opus can take 5+ min to draft; explicit
      // 10-minute timeout so the SDK waits long enough.
      timeout: 600_000,
    });
    return client;
  }

  return {
    name: 'anthropic',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const c = await ensureClient();
      const response = await c.messages.create({
        model: config.model,
        // Default raised from 4096 to 16384 (2026-05-18) for parity with
        // the Gemini adapter. The splitter's stage-2 emits a long JSON
        // response when there are 3+ patients, and long visits produce
        // long notes; 4096 was occasionally clipping output on Sonnet
        // and Opus too. Callers can override per-request.
        max_tokens: config.maxTokens ?? 16384,
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
