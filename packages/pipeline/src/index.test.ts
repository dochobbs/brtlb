import { describe, expect, it } from 'vitest';
import { PIPELINE_VERSION, isLlmProvider } from './index';

describe('@brtlb/pipeline', () => {
  it('exports a version constant', () => {
    expect(PIPELINE_VERSION).toBe('0.1.0');
  });

  it('isLlmProvider type guard accepts a minimal provider', () => {
    const provider = {
      name: 'mock',
      generateNote: async () => 'note text',
    };
    expect(isLlmProvider(provider)).toBe(true);
  });

  it('isLlmProvider type guard rejects junk', () => {
    expect(isLlmProvider(null)).toBe(false);
    expect(isLlmProvider({})).toBe(false);
    expect(isLlmProvider({ name: 'x' })).toBe(false);
  });
});
