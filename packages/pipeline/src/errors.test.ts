import { describe, expect, it } from 'vitest';
import { classifyFetchError, isRetriableNetworkError } from './errors';

describe('classifyFetchError', () => {
  it('rewrites iOS Safari "Load failed" with actionable copy', () => {
    const err = new TypeError('Load failed');
    const out = classifyFetchError('AssemblyAI', 'upload', err);
    expect(out.message).toContain('AssemblyAI upload');
    expect(out.message).toContain('connection was interrupted');
    expect(out.message).toContain('iOS');
    expect(out.message).toContain('Retry from audio');
  });

  it('rewrites Chrome "Failed to fetch"', () => {
    const err = new TypeError('Failed to fetch');
    const out = classifyFetchError('Gemini', 'generate', err);
    expect(out.message).toContain('Gemini generate');
    expect(out.message).toContain('connection was interrupted');
  });

  it('rewrites Firefox "NetworkError when attempting to fetch resource"', () => {
    const err = new TypeError('NetworkError when attempting to fetch resource');
    const out = classifyFetchError('AssemblyAI', 'poll', err);
    expect(out.message).toContain('connection was interrupted');
  });

  it('rewrites AbortError as a timeout/cancel message', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const out = classifyFetchError('AssemblyAI', 'upload', err);
    expect(out.message).toContain('timed out or was cancelled');
    expect(out.message).toContain('Wi-Fi');
  });

  it('passes through unrelated errors unchanged', () => {
    const err = new Error('AssemblyAI upload: 401 invalid api key');
    const out = classifyFetchError('AssemblyAI', 'upload', err);
    // Same Error object — already actionable, classifier should not double-wrap.
    expect(out).toBe(err);
  });

  it('coerces non-Error throwables into Errors', () => {
    const out = classifyFetchError('AssemblyAI', 'upload', 'something bad');
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toContain('something bad');
  });
});

describe('isRetriableNetworkError', () => {
  it('treats TypeError as retriable (network layer failure)', () => {
    expect(isRetriableNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isRetriableNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats AbortError as retriable (timeout)', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isRetriableNetworkError(err)).toBe(true);
  });

  it('treats 5xx-shaped messages as retriable', () => {
    expect(isRetriableNetworkError(new Error('AssemblyAI upload: 502 bad gateway'))).toBe(true);
    expect(isRetriableNetworkError(new Error('AssemblyAI upload: 503 service unavailable'))).toBe(
      true,
    );
  });

  it('does NOT treat 4xx errors as retriable', () => {
    expect(isRetriableNetworkError(new Error('AssemblyAI upload: 401 invalid'))).toBe(false);
    expect(isRetriableNetworkError(new Error('AssemblyAI upload: 402 out of credit'))).toBe(false);
  });

  it('handles non-Error inputs safely', () => {
    expect(isRetriableNetworkError('something')).toBe(false);
    expect(isRetriableNetworkError(null)).toBe(false);
  });
});
