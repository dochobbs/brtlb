import { describe, expect, it } from 'vitest';
import { PIPELINE_VERSION, isLlmProvider, createLlmProvider } from './index';

describe('@brtlb/pipeline', () => {
  it('exports a version constant', () => {
    expect(PIPELINE_VERSION).toBe('0.2.0');
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

describe('createLlmProvider', () => {
  it('returns anthropic provider for anthropic config', () => {
    const p = createLlmProvider({
      kind: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
    });
    expect(p.name).toBe('anthropic');
  });

  it('returns openai-compatible provider for openai-compatible config', () => {
    const p = createLlmProvider({
      kind: 'openai-compatible',
      apiKey: 'k',
      model: 'gpt-4o',
    });
    expect(p.name).toBe('openai-compatible');
  });

  it('returns gemini-vertex provider for gemini-vertex config', () => {
    const p = createLlmProvider({
      kind: 'gemini-vertex',
      serviceAccountJson: JSON.stringify({
        client_email: 'x@y.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
      }),
      projectId: 'p',
      location: 'us-central1',
      model: 'gemini-2.0-pro',
    });
    expect(p.name).toBe('gemini-vertex');
  });
});
