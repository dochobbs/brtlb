# Business Associate Agreements — what to use, by use case

brtlb's recommended default is **OpenAI GPT-5-mini** for note generation,
with an individual API BAA from OpenAI. Practices already on Google
Workspace can use **Gemini** with their existing GCP HIPAA BAA — fully
supported alternate path. Both are equally valid; pick the one with less
friction for your setup.

## TL;DR — two recommended stacks

**Path A — OpenAI (recommended default).** Lowest-friction for solo and
small-group DPC practices. The bake-off that drove this recommendation
showed GPT-5-mini matched the heavier models on note quality at ~1/6
the cost.

| Component           | Vendor                                                  | What you need                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transcription**   | AssemblyAI                                              | Sign the AssemblyAI BAA (DocuSign link below, ~5 min).                                                                                                                                                                                         |
| **Note generation** | **OpenAI GPT-5-mini** via an API key from platform.openai.com | Email `baa@openai.com` to request an individual API customer BAA — no Enterprise tier required. Usually countersigned in 1–3 business days. Once it's back, create the key at platform.openai.com → API keys and paste into Settings. |

**Path B — Google Gemini.** The shortest path if your practice is
already on Workspace with the GCP HIPAA BAA accepted.

| Component           | Vendor                                                     | What you need                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transcription**   | AssemblyAI                                                 | Same as Path A.                                                                                                                                                                                                                |
| **Note generation** | **Google Gemini** via a key from your Google Cloud project | Have the **Google Cloud HIPAA BAA** accepted on your organization (most Workspace admins have this; check at admin.google.com → HIPAA agreement, or in Cloud Console). Create the API key in a billing-enabled Cloud project. |

Either is a clean default. If you want Claude Sonnet (marginally higher
quality on hardest cases at higher cost and setup friction), see
[`docs/ADVANCED_PROVIDERS.md`](ADVANCED_PROVIDERS.md) for Vertex AI and
AWS Bedrock setup. Alternative non-default paths covered below.

---

## Path A setup — OpenAI (recommended default)

### 1. AssemblyAI BAA

Sign here, takes 5 minutes:
https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2

The BAA is associated with whichever AssemblyAI account email you put
on the form. That account's API key becomes PHI-eligible after the BAA
is countersigned.

**Vendor retention.** AssemblyAI's default retention policy keeps
transcripts and uploaded audio on their side for several days unless
deleted via API. brtlb defaults to **auto-delete on completion** —
right after pulling the transcript result, it fires `DELETE /v2/transcript/{id}`
which removes both records from AssemblyAI's side. This cuts retention
from days to seconds. Toggle in Settings → Privacy & Security if your
practice's policy requires longer vendor-side retention for any reason.

### 2. Request an individual API customer BAA from OpenAI

Email `baa@openai.com` from the address that will own the OpenAI
account. A short note works:

> "Requesting an API-customer Business Associate Agreement for my
> pediatric direct primary care practice. We'll use the OpenAI API
> with GPT-5-mini for clinical-note generation. No Enterprise tier
> required."

OpenAI signs individual API-customer BAAs without forcing you onto the
Enterprise tier. Turnaround is typically 1–3 business days. After
countersignature, the BAA covers PHI sent to the API on that account's
keys.

### 3. Create your OpenAI API key

After your BAA is countersigned:

- platform.openai.com → API keys → Create new secret key
- Copy it (starts with `sk-`)

Paste into brtlb Settings → Provider → OpenAI-compatible. Leave Base
URL blank (default targets api.openai.com). Pick `gpt-5-mini` from the
model dropdown — the default.

### 4. Document the BAA decision

For your own audit trail, save:

- AssemblyAI BAA countersignature (PDF from DocuSign)
- OpenAI BAA countersignature (PDF from baa@openai.com correspondence)

---

## Path B setup — Google Gemini

### 1. AssemblyAI BAA

Same as Path A above.

### 2. Confirm your Google HIPAA BAA is in place

Most healthcare practices already have this through Google Workspace.
To verify:

- **Google Workspace admin console** → Account → Legal & compliance →
  HIPAA agreement. Should be marked accepted.
- **Google Cloud Console** (with your organization selected) → Cloud
  Settings or admin → confirm Cloud HIPAA BAA is accepted.

If accepted, your organization's Google Cloud projects fall under the
covered-services BAA — including AI/ML products consumed via API in
those projects.

If your Workspace admin hasn't accepted it yet, the toggle is at
admin.google.com → Account → Legal & compliance.

### 3. Get a Gemini API key in a billing-enabled Cloud project

Per the **Workspace admin path** in `docs/SETUP.md`:

- Cloud Console → APIs & Services → Credentials → Create Credentials →
  API key
- Restrict to "Generative Language API"
- Make sure billing is linked on the project (Free tier keys outside
  any Cloud project are NOT under your BAA)

Paste into brtlb Settings. Done.

### 4. Document the BAA decision

For your own audit trail, save:

- AssemblyAI BAA countersignature (PDF from DocuSign)
- Screenshot of the Google HIPAA agreement acceptance in admin console
- A note that Gemini API consumed via your Cloud project is being
  treated as covered under the GCP HIPAA BAA per Google's "covered
  services" framing for AI/ML

---

## Alternative paths

### OpenAI Enterprise / Azure OpenAI

If your practice already has these instead of (or in addition to) the
individual API BAA path:

- **OpenAI Enterprise** — BAA included with Enterprise contract.
  Contact https://openai.com/enterprise. Use the resulting `sk-...`
  key in brtlb's "OpenAI-compatible" provider with default Base URL.
- **Azure OpenAI** — covered by your Azure HIPAA BAA automatically.
  Provision an OpenAI deployment in Azure, then in brtlb Settings →
  OpenAI provider, set the Base URL to your Azure endpoint and use
  the Azure key.

Both are unambiguous BAA paths; brtlb adapter is identical for them.

### Anthropic Claude via Vertex AI or AWS Bedrock

Sonnet/Opus quality with browser-direct calls is possible via Google
Vertex AI or AWS Bedrock — both covered under their respective cloud
BAAs. See [`docs/ADVANCED_PROVIDERS.md`](ADVANCED_PROVIDERS.md) for
setup, gotchas, and current adapter status.

### Why not Anthropic direct in the browser?

BAA-org Anthropic keys hit a CORS wall:

> "CORS requests are not allowed for this Organization"

The BAA enables custom data retention on Anthropic's side, which
disables CORS for browser callers. Until brtlb has a native shell, the
direct path isn't available. Vertex and Bedrock both work as
alternatives.

---

## A word about the Gemini API and Google's BAA

Google's published HIPAA documents I've been able to read directly
list **Vertex AI** by name and **Gemini-in-Workspace** by name, but
they don't list `generativelanguage.googleapis.com` (the standalone
Gemini API endpoint) by name as of the latest covered-services tables
I could access (April 2026).

What I have read (Google's GCP HIPAA whitepaper, the September 2025
Workspace HIPAA Implementation Guide, Google's BAA terms page) says
that customers with the BAA accepted may use the covered Google
products in connection with PHI; that the BAA covers "Included
Functionality"; and that AI/ML products including API-driven workloads
in a Cloud project are part of that envelope. Industry-standard
HIPAA tooling vendors (Paubox, Nightfall, etc.) treat the Gemini API
under a Cloud project + accepted BAA as covered.

If you want absolute belt-and-suspenders certainty before recording
real visits, get written confirmation from Google for your specific
Cloud account. Otherwise, the practical industry consensus is that
this path is covered when the GCP HIPAA BAA is accepted.

---

## Quick reference

| Vendor                                              | brtlb adapter                 | BAA status                                                                       |
| --------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| AssemblyAI                                          | ✅ Working                    | DocuSign link above; ~5 min                                                      |
| **OpenAI API (individual BAA via `baa@openai.com`)** | ✅ Working                    | **Recommended default.** Email request, 1–3 day turnaround, no Enterprise required |
| Google Gemini API (via Cloud project, BAA accepted) | ✅ Working                    | Recommended alternate. Practical consensus is covered under GCP HIPAA BAA        |
| OpenAI Enterprise                                   | ✅ Working                    | BAA via Enterprise contract                                                      |
| Azure OpenAI                                        | ✅ Working (set Base URL)     | BAA built into Azure agreement                                                   |
| Anthropic via Google Vertex AI                      | 🚧 Planned                    | Covered under your Google Cloud HIPAA BAA; see ADVANCED_PROVIDERS.md             |
| Anthropic via AWS Bedrock                           | 🚧 Planned                    | Covered under your AWS BAA; see ADVANCED_PROVIDERS.md                            |
| Anthropic (direct, Enterprise BAA)                  | ❌ Blocked by CORS in browser | Hidden from picker; opens when iOS native shell ships                            |

---

## A note on Vercel Analytics

brtlb runs Vercel Analytics on the static site at brtlb.io. It
counts page views (Home / Wizard / Record / Review hits), country, and
browser — cookieless, no fingerprinting, no cross-site tracking.
Vercel never sees your audio, transcripts, notes, API keys, or any
patient identifiers — those don't pass through Vercel at all (audio
goes browser → AssemblyAI direct, transcript goes browser → your LLM
provider direct).

Page-view counts on a healthcare-information-management product are
aggregate web traffic metadata, not PHI about individual patients.
Vercel's data processing for Analytics is covered by their standard
DPA (no separate BAA required for non-PHI analytics). If you'd rather
brtlb send zero telemetry — or want to audit the code that runs in
your browser — ask Dr. Hobbs for repo access during the beta.

The Settings → Privacy & security panel in the app discloses this in
the same words.
