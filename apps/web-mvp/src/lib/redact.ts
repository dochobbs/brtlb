/**
 * Redact common API key shapes from arbitrary text. Used before rendering
 * upstream error messages so a 401/403/429 body that echoes the request
 * Authorization header (or a key in a URL) doesn't leak credentials into
 * the DOM.
 */

const KEY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Anthropic
  { name: 'anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI (sk-, sk-proj-, sk-svcacct-)
  { name: 'openai', re: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  // AssemblyAI (UUID-ish, usually 32 hex)
  { name: 'assemblyai', re: /\b[a-f0-9]{32}\b/gi },
  // Google AI Studio + Vertex API keys that start with AIza
  { name: 'google-aiza', re: /AIza[A-Za-z0-9_-]{20,}/g },
  // Google OAuth bearer access tokens (ya29.xxx for short-lived, 1//xxx for refresh)
  { name: 'google-oauth', re: /(?:ya29\.|1\/\/)[A-Za-z0-9_-]{20,}/g },
  // GCP service account private key blocks (PEM)
  { name: 'pem-key', re: /-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g },
  // GCP service account JSON private_key field (escaped \\n inside)
  { name: 'sa-private-key', re: /"private_key"\s*:\s*"[^"]+"/g },
  // Generic Bearer tokens in Authorization-style strings
  { name: 'bearer-header', re: /Bearer\s+[A-Za-z0-9_\-.~+/=]{20,}/g },
  // Catch-all for high-entropy tokens that LOOK like keys (40+ char base64-ish).
  // Runs LAST so the more-specific patterns above land first. Conservative:
  // only triggers when surrounded by non-word chars or string ends, so it
  // doesn't shred ordinary long medical words / sentences.
  { name: 'high-entropy-fallback', re: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g },
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
