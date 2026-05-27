# Advanced providers — Anthropic Claude via Vertex AI or AWS Bedrock

The brtlb defaults (OpenAI GPT-5-mini or Google Gemini) cover ~95% of
clinical use cases at lower cost and friction than the advanced paths
below. This page is for the small subset of practices where one of these
is true:

- You're already on AWS or GCP with infrastructure expertise and want
  to keep your BAA chain within a single cloud vendor
- You've personally evaluated Claude Sonnet and found its handling of a
  specific failure mode (behavioral-health safety screens, deliberation
  rationale on med changes, sibling-visit splitting) materially better
  for your visit mix than the defaults
- Your practice compliance officer requires a specific cloud-vendor BAA

If none of those apply, [`SETUP.md`](SETUP.md) is the right read.

## TL;DR

| Path | BAA covered by | Adapter status | Quota friction | Browser-direct? |
|---|---|---|---|---|
| Anthropic via Google Vertex AI | Existing Google Workspace / GCP HIPAA BAA | 🚧 Planned | Real — default quota = 0, requires quota-increase request | ✅ Yes (CORS confirmed) |
| Anthropic via AWS Bedrock | Existing AWS BAA | 🚧 Planned | Low — usually pre-allocated | ⚠️ Yes but auth is complex (SigV4 in browser) |

Both adapters are not yet built. The pages below describe what the
setup will look like and the known gotchas so you can plan.

---

## Path A — Anthropic Claude via Google Vertex AI

**Status: planned, adapter not yet shipped.**

Sonnet/Opus quality through the same Google Cloud project + HIPAA BAA
that already covers your Gemini key. No second vendor account, no
extra BAA to sign, browser-direct calls confirmed working (CORS is
permissive on `*-aiplatform.googleapis.com`).

### Why the adapter isn't shipped yet

A 2026-05-26 dry run against `claude-sonnet-4-6` on Vertex confirmed:

- ✅ CORS permits browser-direct calls — confirmed by preflight test
- ✅ Bearer-token auth via service-account JWT works
- ✅ The model is enabled and recognized in the test project
- ❌ Default per-minute quota is **zero** — every request returns
  HTTP 429 with `RESOURCE_EXHAUSTED` until you file a quota-increase
  ticket through the Cloud Console
- ❌ Vertex Anthropic is region-specific (us-east5 yes, us-central1 no)
  and lags api.anthropic.com by 2–6 weeks on new model versions

The quota wall makes "Settings → paste key → record a visit" not work
out of the box. The adapter is planned to ship together with a Settings
flow that detects the 429 and surfaces a specific actionable error
("file a quota increase here") instead of a generic provider failure.

### What setup will look like when the adapter lands

1. Enable Vertex AI API in your Google Cloud project
2. Enable Claude Sonnet 4.6 (or whichever) in Vertex Model Garden and
   accept Anthropic's terms (~30 seconds)
3. File a quota-increase request for
   `online_prediction_input_tokens_per_minute_per_base_model` on
   `anthropic-claude-sonnet-4-6` — Google usually approves within hours
4. Create a service account with role `roles/aiplatform.user`
5. Download a service-account JSON key
6. Paste the JSON into brtlb Settings → Provider → Anthropic on Vertex

### Honest gotchas

- **Service-account JSON in localStorage is a stronger secret than an
  API key.** Scoped to the entire Cloud project, long-lived, not
  trivially rotatable. Scope the SA tightly to `roles/aiplatform.user`
  on a single project.
- **Cloud Console access ≠ Workspace admin access.** Most clinicians
  have Workspace admin (admin.google.com) but not Cloud Console roles.
  Service-account creation typically requires IT.
- **Regional availability quirks** (this list moves; verify before you
  set up):
  - `us-east5` — full Anthropic lineup
  - `europe-west1` — partial
  - `us-central1` — Gemini yes, Anthropic no
- **Model-release lag.** Anthropic ships new versions to
  api.anthropic.com first, Bedrock second, Vertex third. Plan for being
  a model-generation behind for ~4 weeks after each Anthropic release.

### Want this prioritized?

Email michael@hobbs.md. If multiple practices ask, the adapter moves up.

---

## Path B — Anthropic Claude via AWS Bedrock

**Status: planned, adapter not yet shipped.**

Same Anthropic models, AWS-native auth and BAA. Most appropriate for
practices that already operate AWS infrastructure and want the BAA
chain to stay within one cloud vendor.

### Setup walkthrough

This is documented in full because the AWS-side setup is reusable
knowledge for healthcare folks even before our adapter ships. You can
also use it today by routing Bedrock through a separate proxy.

1. **Confirm your AWS HIPAA BAA.** AWS includes BAAs in the standard
   AWS Customer Agreement for accounts that have requested them — go
   to AWS Artifact (https://console.aws.amazon.com/artifact/) → AWS
   Business Associate Addendum → accept if not already done.

2. **Enable Bedrock in your region.** Bedrock is region-scoped. The
   regions with the widest Anthropic model availability are
   `us-east-1` (N. Virginia) and `us-west-2` (Oregon). Open
   https://console.aws.amazon.com/bedrock/ and select one of these.

3. **Request access to the Anthropic models.** In the Bedrock console
   sidebar → **Model access** → find Claude (Anthropic) entries → click
   **Request model access** → submit. Access for established Anthropic
   models is typically granted within an hour; brand-new model
   releases can take longer.

4. **Create an IAM user (or role) with Bedrock invocation permissions.**

   IAM Console → Users → Create user → name it something like
   `brtlb-bedrock-user`. Skip the AWS Management Console access option
   (this is an API-only identity). Click through to permissions.

   Create a new inline policy or managed policy attaching this
   minimum-scope document:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["bedrock:InvokeModel"],
         "Resource": [
           "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6-v1:0"
         ]
       }
     ]
   }
   ```

   Replace the model ARN with whichever Anthropic model(s) you'll use.
   The narrow ARN scope means the key can only invoke specific
   Anthropic models — not other Bedrock models, not other AWS services.

5. **Generate access keys for this user.** IAM Console → your new user
   → Security credentials → Create access key → "Application running
   outside AWS" → Create. Copy the **Access key ID** and **Secret
   access key**. (You'll only see the secret once.)

6. **When the brtlb adapter ships,** paste these credentials plus the
   region into Settings → Provider → Anthropic on Bedrock. Today, you
   can use them with a Bedrock-aware proxy of your own (or wait for
   the adapter).

### Honest gotchas

- **SigV4 request signing is non-trivial from a browser.** AWS Bedrock
  requires every request to be signed with the user's access keys
  using SigV4. The brtlb adapter will use the `aws4` library or
  AWS SDK signing helpers — bundle weight is ~30KB minified+gzipped.
- **Long-lived access keys in localStorage are weaker than the OpenAI
  API key pattern.** They never rotate by default. For higher security,
  practices can stand up an AWS Cognito Identity Pool that mints
  short-lived temp credentials in the browser — adds setup
  complexity but eliminates the long-lived secret. Cognito setup is
  out of scope for this doc.
- **Anthropic models on Bedrock lag api.anthropic.com by 2–6 weeks**
  on new releases. Same lag situation as Vertex.
- **Bedrock CORS behavior is not yet tested by brtlb** — to be confirmed
  before the adapter ships.

### Want this prioritized?

Email michael@hobbs.md. Bedrock adapter work is bigger than the Vertex
Anthropic one (SigV4 plus bundle-size impact), so concrete demand from
AWS-native practices materially changes the priority.

---

## Why not just add a brtlb-hosted Anthropic proxy?

It was considered and rejected. A brtlb-hosted thin proxy (one Vercel
Edge Function that forwards transcripts to Anthropic) would be the
easiest UX, but:

1. It would put brtlb the entity in the data path for the first time,
   which would make brtlb a business associate of every user
2. Every user would need a brtlb-issued BAA in addition to their
   provider BAAs
3. It would void the "no backend in your data path" pitch that's the
   core architectural argument for brtlb

The Vertex and Bedrock paths preserve the no-backend story by routing
calls browser-direct to cloud-vendor endpoints the user already has a
BAA with. That's the right trade.

---

## Other less-relevant options

- **Anthropic direct API** — blocked by CORS on BAA-enabled
  organizations. Works only after the native iOS shell ships (planned;
  Capacitor-wrapped) since native shells don't enforce CORS.
- **User-hosted proxy** (deploy your own Cloudflare Worker or Vercel
  Function pointing at api.anthropic.com) — works today, but
  Cloudflare/Vercel BAAs are Enterprise-tier-only, so this is only a
  legitimate path if you have one of those. Some practices' compliance
  officers accept pure-passthrough proxies as not subject to
  PHI-at-rest rules, but that's not legal advice.
