export * from './types';
import type { LlmProvider } from './types';

export const PIPELINE_VERSION = '0.2.0';

export function isLlmProvider(value: unknown): value is LlmProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    'generateNote' in value &&
    typeof (value as { generateNote: unknown }).generateNote === 'function'
  );
}

// Uncommented as each Phase 2 task lands:
export { composeNotePrompt } from './prompts/compose';
export { transcribeWithAssemblyAi } from './transcription/assemblyai';
// export { createAnthropicProvider } from './adapters/anthropic';
// export { createOpenAiCompatibleProvider } from './adapters/openai-compatible';
// export { createGeminiVertexProvider } from './adapters/gemini-vertex';
// export { createLlmProvider } from './adapters/factory';
// export { runPipeline } from './orchestrator';
