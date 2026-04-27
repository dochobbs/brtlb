import type { LlmProvider, ProviderConfig } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { createGeminiVertexProvider } from './gemini-vertex';
import { createGeminiApiKeyProvider } from './gemini-api-key';

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(config);
    case 'gemini-vertex':
      return createGeminiVertexProvider(config);
    case 'gemini-api-key':
      return createGeminiApiKeyProvider(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown provider kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
