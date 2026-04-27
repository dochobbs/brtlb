import { describe, expect, it } from 'vitest';
import { maskKeyForDisplay, redactKeysInText } from './redact';

describe('redactKeysInText', () => {
  it('masks an Anthropic key in error text', () => {
    const out = redactKeysInText(
      'authentication_error: invalid key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABcDeFGH',
    );
    expect(out).toMatch(/sk-a…REDACTED…[A-Za-z0-9]{4}/);
    expect(out).not.toContain('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABcDeFGH');
  });

  it('masks an OpenAI key', () => {
    const out = redactKeysInText('Bearer sk-proj-aaaaaaaaaaaaaaaaaaaa1234');
    expect(out).toContain('REDACTED');
    expect(out).not.toContain('sk-proj-aaaaaaaaaaaaaaaaaaaa1234');
  });

  it('masks a Google AI Studio key', () => {
    const out = redactKeysInText('?key=AIzaSy0123456789AbCdEfGhIjKlMnOpQrStUvW');
    expect(out).toContain('REDACTED');
    expect(out).not.toContain('AIzaSy0123456789AbCdEfGhIjKlMnOpQrStUvW');
  });

  it('leaves text without keys unchanged', () => {
    const text = 'AssemblyAI upload: 403 forbidden — your plan does not allow it.';
    expect(redactKeysInText(text)).toBe(text);
  });

  it('redacts multiple keys in one string', () => {
    const out = redactKeysInText(
      'sk-ant-api03-firsttokenherelongenough12345 and AIzaSyxxxxxxxxxxxxxxxxxxxxxxxx',
    );
    expect(out.match(/REDACTED/g)).toHaveLength(2);
  });
});

describe('maskKeyForDisplay', () => {
  it('returns empty string for empty input', () => {
    expect(maskKeyForDisplay('')).toBe('');
  });

  it('preserves the first 3 and last 4 chars and bullets the middle', () => {
    const masked = maskKeyForDisplay('sk-ant-secretvaluehere1234');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).toContain('•');
  });

  it('hides short keys entirely', () => {
    expect(maskKeyForDisplay('abc')).toBe('•••');
  });
});
