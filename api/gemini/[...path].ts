import { extractInvite, isValidInvite, serverMisconfigured, unauthorized } from '../_lib/auth';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://generativelanguage.googleapis.com';

export default async function handler(req: Request): Promise<Response> {
  const invite = extractInvite(req);
  if (!isValidInvite(invite)) return unauthorized();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return serverMisconfigured('GEMINI_API_KEY');

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/gemini\//, '');
  // Gemini puts auth in the `?key=` query string. Strip any incoming key
  // (the invite token) and replace with the real one. Preserve the rest
  // of the query.
  const params = new URLSearchParams(url.search);
  params.delete('key');
  params.delete('invite');
  params.set('key', apiKey);
  const target = `${UPSTREAM}/${path}?${params.toString()}`;

  const headers = new Headers(req.headers);
  headers.delete('authorization');
  headers.delete('x-api-key');
  headers.delete('x-brtlb-invite');
  headers.delete('host');

  return fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}
