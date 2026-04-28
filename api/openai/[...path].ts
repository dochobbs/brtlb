import { extractInvite, isValidInvite, serverMisconfigured, unauthorized } from '../_lib/auth';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.openai.com';

export default async function handler(req: Request): Promise<Response> {
  const invite = extractInvite(req);
  if (!isValidInvite(invite)) return unauthorized();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return serverMisconfigured('OPENAI_API_KEY');

  // Strip "/api/openai/" → keep the rest as the upstream path.
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/openai\//, '');
  const target = `${UPSTREAM}/${path}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.delete('host');
  headers.delete('x-brtlb-invite');

  return fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    // Required by Edge fetch for streamed bodies.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}
