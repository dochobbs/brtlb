# brtlb beta proxy — operator notes

Beta testers authenticate with a single short invite token. The Vercel deploy
forwards their LLM + transcription requests to the upstream APIs using brtlb's
keys, so testers never see the real keys.

## What you set up once on Vercel

In **Vercel project → Settings → Environment Variables**, add the following
for both Production and Preview environments:

| Name | Value | Notes |
|---|---|---|
| `BRTLB_INVITE_TOKENS` | `alice-Q7m2,bob-K9pn,carol-X3rL` | Comma-separated list of invite tokens. Each tester gets one. To revoke, remove and redeploy. |
| `OPENAI_API_KEY` | `sk-...` | Your OpenAI key (Enterprise / Azure with BAA) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Your Anthropic key (BAA org) |
| `GEMINI_API_KEY` | `AIzaSy...` | Optional — Vertex BAA path; AI Studio is not BAA |
| `ASSEMBLYAI_API_KEY` | `...` | Your AssemblyAI key (BAA enabled) |

You don't need all four LLM keys — set whichever providers you want testers to
have access to. The proxy returns a clean 500 with a clear error if a tester
picks a provider whose server-side key is missing.

After saving env vars, redeploy (Deployments → ⋯ → Redeploy) so the new
values take effect.

## Issuing tokens

1. Pick a string per tester. Keep it short and easy to type but not guessable.
   Format suggestion: `<name>-<6 random alphanum>` (e.g., `alice-Q7m2nP`).
2. Add it to `BRTLB_INVITE_TOKENS` in Vercel and redeploy.
3. Send the tester their token + the URL (`brtlb.vercel.app`).
4. Tester opens the URL → Settings → pastes token in the "Beta access" field
   under "brtlb invite token" → Save → records.

The seafoam panel up top in Settings is the only thing they need to fill in.
The "Bring your own keys" section is ignored when an invite is set.

## Revoking access

1. Remove the token from `BRTLB_INVITE_TOKENS` in Vercel.
2. Redeploy. Within ~90 seconds the proxy starts rejecting that token with 401.

The tester's browser still has the token in localStorage, but every API call
will return 401 until they paste a new one or you re-add their token.

## Rate limiting

v1 has no rate limiting — testers can run as many visits as they want. Watch
your AssemblyAI / OpenAI billing dashboards manually during the beta. If any
single tester goes wild, just remove their token.

For v2, plan a small Vercel KV-backed counter that caps `requests / token /
day` and returns 429 when exceeded.

## Body size limits

Vercel Edge Functions cap request body at 4 MB. At 32 kbps audio that's
roughly **16 minutes of recording** per upload. For longer ambient visits,
testers should pause and start a new recording, or we move to Vercel Blob
upload in v2.

## What the proxy does NOT do

- It does not log audio, transcripts, or notes. (Vercel logs the URL and HTTP
  status of each request — no body.)
- It does not store anything. Stateless forwarding.
- It does not modify request or response bodies.
- It does not add analytics or tracking.

## Endpoints

- `/api/openai/v1/chat/completions` — proxies to `api.openai.com/v1/chat/completions`
- `/api/anthropic/v1/messages` — proxies to `api.anthropic.com/v1/messages`
- `/api/gemini/v1beta/models/<model>:generateContent` — proxies to Google
- `/api/assemblyai/upload` — proxies to AssemblyAI upload
- `/api/assemblyai/transcript` — POST creates, GET `/api/assemblyai/transcript/<id>` polls

The frontend automatically points at these when the user has an invite token
saved. No changes needed in the client.
