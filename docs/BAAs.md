# Business Associate Agreements — what to use, by use case

Most pediatric practices already run on Google Workspace, which means
they already have a BAA with Google. The recommended brtlb stack uses
that.

## TL;DR — recommended stack

| Component           | Vendor                                                     | What you need                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transcription**   | AssemblyAI                                                 | Sign the AssemblyAI BAA (DocuSign link below, ~5 min).                                                                                                                                                                        |
| **Note generation** | **Google Gemini** via a key from your Google Cloud project | Have the **Google Cloud HIPAA BAA** accepted on your organization (most Workspace admins have this; check at admin.google.com → HIPAA agreement, or in Cloud Console). Create the API key in a billing-enabled Cloud project. |

This is the path most users want: leverages the Google BAA you almost
certainly already have, doesn't require new vendor relationships, and
brtlb's existing Gemini adapter just works.

Alternative paths covered below.

---

## Recommended setup (default for most users)

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

If your practice has these instead of (or in addition to) Google:

- **OpenAI Enterprise** — BAA included with Enterprise contract.
  Contact https://openai.com/enterprise. Use the resulting `sk-...`
  key in brtlb's "OpenAI-compatible" provider with default Base URL.
- **Azure OpenAI** — covered by your Azure HIPAA BAA automatically.
  Provision an OpenAI deployment in Azure, then in brtlb Settings →
  OpenAI provider, set the Base URL to your Azure endpoint and use
  the Azure key.

Both are unambiguous BAA paths; brtlb adapter is identical for them.

### Vertex AI

`*-aiplatform.googleapis.com` is unambiguously listed in Google's GCP
HIPAA whitepaper. Different endpoint than the Gemini API; uses
service-account JWT auth, not API key. brtlb has a scaffold adapter
but it's not yet wired into the browser pipeline. Use the Gemini API
path above for now.

### Why not Anthropic in the browser?

BAA-org Anthropic keys hit a CORS wall:

> "CORS requests are not allowed for this Organization"

The BAA enables custom data retention on Anthropic's side, which
disables CORS for browser callers. Until brtlb has a native shell or
server-side proxy, Anthropic is not a working PHI path. We've hidden
it from the picker for that reason.

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

| Vendor                                              | brtlb adapter                 | BAA status                                                              |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| AssemblyAI                                          | ✅ Working                    | DocuSign link above; ~5 min                                             |
| Google Gemini API (via Cloud project, BAA accepted) | ✅ Working                    | Recommended default. Practical consensus is covered under GCP HIPAA BAA |
| OpenAI (Enterprise)                                 | ✅ Working                    | BAA via Enterprise contract                                             |
| Azure OpenAI                                        | ✅ Working (set Base URL)     | BAA built into Azure agreement                                          |
| Google Vertex AI                                    | ⚠️ Scaffold only              | Unambiguously covered; adapter not yet wired in                         |
| Anthropic (Enterprise BAA)                          | ❌ Blocked by CORS in browser | Hidden from picker                                                      |

---

## A note on Vercel Analytics

brtlb runs Vercel Analytics on the static site at brtlb.io. It
counts page views (Home / Wizard / Record / Review hits), country, and
browser — cookieless, no fingerprinting, no cross-site tracking.
Vercel never sees your audio, transcripts, notes, API keys, or any
patient identifiers — those don't pass through Vercel at all (audio
goes browser → AssemblyAI direct, transcript goes browser → Gemini
direct).

Page-view counts on a healthcare-information-management product are
aggregate web traffic metadata, not PHI about individual patients.
Vercel's data processing for Analytics is covered by their standard
DPA (no separate BAA required for non-PHI analytics). If you'd rather
brtlb send zero telemetry — or want to audit the code that runs in
your browser — ask Dr. Hobbs for repo access during the beta.

The Settings → Privacy & security panel in the app discloses this in
the same words.
