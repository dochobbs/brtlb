export * from './types';
import type { LlmProvider } from './types';

export const PIPELINE_VERSION = '0.1.0';

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
