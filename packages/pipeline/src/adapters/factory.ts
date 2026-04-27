import type { LlmProvider, ProviderConfig } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { createGeminiVertexProvider } from './gemini-vertex';

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(config);
    case 'gemini-vertex':
      return createGeminiVertexProvider(config);
  }
}
