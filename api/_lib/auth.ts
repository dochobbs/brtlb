/**
 * Invite-token validation for the brtlb beta proxy.
 *
 * The server holds the real upstream API keys (OpenAI / Anthropic / Gemini /
 * AssemblyAI) in environment variables. Beta testers authenticate with a
 * short invite token that we list in BRTLB_INVITE_TOKENS (comma-separated).
 *
 * To revoke a tester: remove their token from the env var and redeploy
 * (or use Vercel's UI which triggers a redeploy automatically).
 *
 * For v2, swap this for Vercel KV / Upstash so revocation is instant and
 * you can attach per-token usage caps.
 */

function parseTokens(): Set<string> {
  const raw = process.env.BRTLB_INVITE_TOKENS ?? '';
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

export function isValidInvite(token: string | null | undefined): boolean {
  if (!token) return false;
  const allowed = parseTokens();
  if (allowed.size === 0) return false;
  return allowed.has(token);
}

export function unauthorized(message = 'Invalid or missing invite token'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function serverMisconfigured(missingEnv: string): Response {
  return new Response(
    JSON.stringify({
      error: `brtlb beta proxy is misconfigured: missing ${missingEnv} on the server.`,
    }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Pull the invite token out of common header / query patterns. */
export function extractInvite(req: Request): string | null {
  // Bearer scheme (OpenAI SDK uses Authorization: Bearer ...)
  const auth = req.headers.get('authorization');
  if (auth) {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1] ?? null;
    // AssemblyAI uses bare Authorization: <key>
    return auth;
  }
  // Anthropic SDK uses x-api-key
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) return apiKey;
  // Custom header fallback
  const custom = req.headers.get('x-brtlb-invite');
  if (custom) return custom;
  // Query param (Gemini-style)
  const url = new URL(req.url);
  const q = url.searchParams.get('key') ?? url.searchParams.get('invite');
  return q;
}
