import { extractInvite, isValidInvite, serverMisconfigured, unauthorized } from '../_lib/auth';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.assemblyai.com/v2';

export default async function handler(req: Request): Promise<Response> {
  const invite = extractInvite(req);
  if (!isValidInvite(invite)) return unauthorized();

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return serverMisconfigured('ASSEMBLYAI_API_KEY');

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/assemblyai\//, '');
  const target = `${UPSTREAM}/${path}${url.search}`;

  const headers = new Headers(req.headers);
  // AssemblyAI uses bare Authorization: <key> (no Bearer prefix).
  headers.set('Authorization', apiKey);
  headers.delete('x-brtlb-invite');
  headers.delete('host');

  return fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}
