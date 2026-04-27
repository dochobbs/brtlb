/**
 * Redact common API key shapes from arbitrary text. Used before rendering
 * upstream error messages so a 401/403/429 body that echoes the request
 * Authorization header (or a key in a URL) doesn't leak credentials into
 * the DOM.
 */

const KEY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Anthropic
  { name: 'anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI
  { name: 'openai', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  // AssemblyAI (UUID-ish, usually 32 hex)
  { name: 'assemblyai', re: /\b[a-f0-9]{32}\b/gi },
  // Google AI Studio + Vertex bearer tokens that start with AIza
  { name: 'google', re: /AIza[A-Za-z0-9_-]{20,}/g },
  // Generic OAuth bearer access tokens
  { name: 'bearer', re: /ya29\.[A-Za-z0-9_-]{20,}/g },
];

export function redactKeysInText(text: string): string {
  let out = text;
  for (const { re } of KEY_PATTERNS) {
    out = out.replace(re, (match) => {
      const tail = match.slice(-4);
      return match.slice(0, 4) + '…REDACTED…' + tail;
    });
  }
  return out;
}

/**
 * Show a saved API key as `sk-•••••last4` so a screen recording or
 * screenshot of the settings form doesn't leak the full key. The user
 * can still edit (typing replaces the masked display).
 */
export function maskKeyForDisplay(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  const head = key.slice(0, 3);
  const tail = key.slice(-4);
  return `${head}${'•'.repeat(Math.max(8, key.length - 7))}${tail}`;
}
