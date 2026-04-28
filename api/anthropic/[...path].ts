import { extractInvite, isValidInvite, serverMisconfigured, unauthorized } from '../_lib/auth';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.anthropic.com';

export default async function handler(req: Request): Promise<Response> {
  const invite = extractInvite(req);
  if (!isValidInvite(invite)) return unauthorized();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return serverMisconfigured('ANTHROPIC_API_KEY');

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/anthropic\//, '');
  const target = `${UPSTREAM}/${path}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('x-api-key', apiKey);
  // Anthropic requires an explicit version header.
  if (!headers.has('anthropic-version')) {
    headers.set('anthropic-version', '2023-06-01');
  }
  headers.delete('authorization');
  headers.delete('host');
  headers.delete('x-brtlb-invite');

  return fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}
