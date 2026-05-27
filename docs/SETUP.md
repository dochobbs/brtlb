# Setting up brtlb

brtlb runs entirely in your browser. You bring two keys: one for
**transcription** (AssemblyAI) and one for **note generation** (OpenAI
GPT-5-mini is the recommended default; Google Gemini works equally
well). Keys live only in your browser's localStorage — they never
leave your device.

## In-app wizard (Gemini path only, today)

Open https://brtlb.io — if you don't have keys saved yet, the
**onboarding wizard** opens automatically with the Gemini setup walk.
It live-verifies both keys before your first visit and handles the
Workspace org-policy edge case inline.

> **Re-recommendation as of 2026-05-27:** OpenAI GPT-5-mini is now
> the recommended default for new installs (matches the heavier models
> on note quality at ~1/6 the cost). The wizard's OpenAI walkthrough
> is in progress — until it ships, OpenAI users should skip the wizard
> and use the manual walkthrough below to paste an OpenAI key via
> Settings.

Re-run the wizard any time: Settings → **Run setup wizard**.

## Manual walkthrough

Two equally-supported stacks:

**Stack A — OpenAI (recommended default).** Lowest-friction for solo
and small-group DPC. Browser-native, individual API BAA via email.

| Component | Vendor |
|---|---|
| Transcription | AssemblyAI (sign their BAA, ~5 min) |
| Note generation | OpenAI GPT-5-mini via an API key from platform.openai.com — BAA via baa@openai.com |

**Stack B — Google Gemini.** Shortest path if your practice is already
on Workspace with the GCP HIPAA BAA accepted.

| Component | Vendor |
|---|---|
| Transcription | AssemblyAI (same as Stack A) |
| Note generation | Google Gemini, key from your Google Cloud project |

For Claude Sonnet on Vertex AI or AWS Bedrock, see
[`ADVANCED_PROVIDERS.md`](ADVANCED_PROVIDERS.md). For the full BAA
decision tree, see [`BAAs.md`](BAAs.md).

You'll need:
- A computer or phone with a modern browser
- About **15 minutes** for first-time setup
- Billing linked on whichever provider account you choose
- brtlb costs roughly **$0.13 to $0.20 per 30-minute visit end-to-end**
  depending on provider (~$0.12 STT + $0.01 to $0.08 LLM)

---

## 1. Get your AssemblyAI key (transcription)

AssemblyAI converts the recorded audio into a transcript with speaker
labels. Without a BAA, do not record real patient encounters with it.

### Steps

1. Go to **https://www.assemblyai.com** → **Sign Up** (free)
2. After you sign in, your dashboard shows an **API Key** at the top
   right. Click the copy icon. Format: a 32-character hex string.
3. **If you'll record real patient visits**, sign the BAA before
   recording anything. AssemblyAI's BAA DocuSign PowerForm:
   **https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2**
   The BAA is associated with whichever AssemblyAI account email you
   provide on the form.
4. Hold onto the key — you'll paste it into brtlb in a moment.

### Cost

AssemblyAI charges per minute of audio. Pricing as of mid-2025 was
roughly **$0.65/hour** of audio (about $0.16 for a 15-min visit). Check
their current pricing page for exact numbers.

---

## 2A. Get your OpenAI key — *recommended default*

OpenAI GPT-5-mini turns the transcript into a structured SOAP note.
Lowest-friction setup for solo / small DPC practices.

### Steps

1. **Request the BAA first** (only for real PHI). Email `baa@openai.com`
   from the email that will own the OpenAI account. A two-sentence
   note works:

   > "Requesting an API-customer Business Associate Agreement for my
   > pediatric direct primary care practice. We'll use the OpenAI API
   > with GPT-5-mini for clinical-note generation. No Enterprise tier
   > required."

   Turnaround is typically 1–3 business days. You don't have to wait
   for the BAA to test with non-PHI synthetic transcripts; just don't
   record real patients until it's countersigned.

2. **Create your account + key.** Go to **https://platform.openai.com**,
   sign in (or sign up). Add billing details if you haven't already.
   Then **API keys → Create new secret key**. Copy the `sk-...` key.

3. **Paste into brtlb Settings → Provider → OpenAI-compatible.** Leave
   Base URL blank (defaults to api.openai.com). Pick `gpt-5-mini` from
   the model dropdown — the recommended default.

### Cost

GPT-5-mini runs ~**$0.01 per visit** (15-min ambient encounter). One of
the cheapest provider options. GPT-5 (the full model) is ~$0.04 per
visit — pick from the same dropdown if you want maximum quality.

---

## 2B. Get your Google Gemini key — alternate path

The shortest path for users already on Google Workspace.

**Before getting the API key, confirm your Google HIPAA BAA is accepted:**
- admin.google.com → Account → Legal & compliance → HIPAA agreement
  should be marked accepted, OR
- Cloud Console → org-level admin → confirm Cloud HIPAA BAA acceptance

If you're a Workspace admin and haven't accepted yet, do so before
recording real patient visits.

**Then get the API key (Workspace admin path — requires Org Policy
Administrator role to bypass any default API-key block; see
"Workspace admin path" below):**

1. Go to **https://console.cloud.google.com/apis/credentials** with
   your work account
2. **Create Credentials** → **API key**
3. Restrict it to **Generative Language API** for safety
4. Make sure billing is linked on the project
   (https://console.cloud.google.com/billing/linkedaccount)
5. Copy the `AIzaSy...` key

### Easiest path: AI Studio

1. Go to **https://aistudio.google.com**
2. Sign in with either a **personal Gmail** OR your **Workspace** account
   — both work for most users. If your Workspace org has restricted AI
   Studio specifically, you'll get an error and need to either use a
   personal account or follow the Workspace admin path below.
3. Click **Get API Key** in the top-left, then **Create API Key**.
4. Pick or create a project. Copy the `AIzaSy...` key.

### Workspace admin path (if AI Studio is blocked for your account)

If your work account hits an "API Keys are Disallowed" message, your
Google Cloud organization policy needs adjusting. As an admin:

1. **Grant yourself the role.** GCP Console → **IAM & Admin → IAM**.
   At the top of the page, switch the project picker to your
   **organization** (the building icon). Find your account → pencil →
   **+ ADD ANOTHER ROLE** → search "Organization Policy Administrator"
   → Save. Wait ~30 seconds for IAM to propagate.
2. **Override the policy.** GCP Console → **IAM & Admin → Organization
   Policies**. Filter by "api". Look for any active policy like
   `iam.managed.disableServiceAccountApiKeyCreation`. Click ⋮ → **Edit
   policy** → set **Override parent's policy** → **Off** → Save.
3. **Create the key.** GCP Console → **APIs & Services → Credentials →
   Create Credentials → API key**. Restrict to "Generative Language
   API". Copy the `AIzaSy...` key.

For the BAA decision tree, see `docs/BAAs.md`. Short version: if your
Workspace HIPAA BAA is accepted and the key comes from a billing-enabled
Cloud project, the practical industry consensus is that the Gemini API
is covered. For Claude Sonnet on Vertex AI, see `ADVANCED_PROVIDERS.md`.

### Cost

Gemini 3.1 Pro runs ~**$0.02 per visit** — cheap. Google offers a
generous free tier; you may not see any charges while you're testing.

---

## 3. Alternative — OpenAI Enterprise / Azure OpenAI

If your practice already runs on OpenAI Enterprise or Azure OpenAI (and
you don't want to set up a second account for the individual API BAA
path in 2A), both work with brtlb's existing OpenAI-compatible adapter.

### Option A — OpenAI Enterprise

1. Contact OpenAI sales: **https://openai.com/enterprise**
2. They provision an Enterprise account and provide the BAA as part of
   the agreement.
3. Generate an API key at platform.openai.com/api-keys. Format
   `sk-proj-...` or `sk-...`.
4. In brtlb Settings → "OpenAI-compatible" provider → paste key. Leave
   Base URL blank (defaults to `api.openai.com`). Save.

### Option B — Azure OpenAI

1. In your Azure portal, create an "Azure OpenAI" resource.
2. Provision a model deployment (e.g., `gpt-5-mini`).
3. Copy the **endpoint URL** and the **API key** from the resource's
   "Keys and Endpoint" pane.
4. The Microsoft Azure Online Services agreement already includes the
   HIPAA BAA — no separate signature needed.
5. In brtlb Settings → "OpenAI-compatible" provider:
   - **Base URL:** your Azure endpoint, e.g.
     `https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT`
   - **API key:** the Azure key
   - Save.

### Option C — Anthropic Claude (Vertex or Bedrock)

See [`ADVANCED_PROVIDERS.md`](ADVANCED_PROVIDERS.md).

### Cost

GPT-5-mini ~$0.01/visit; GPT-5 ~$0.04/visit; Azure GPT-4o ~$0.02-0.05.


---

## 4. Open brtlb and paste your keys

1. Go to **https://brtlb.io** (or whatever URL the brtlb operator
   gave you)
2. Tap **Settings** in the top right
3. Pick a provider — **OpenAI-compatible** (recommended) or **Gemini**
4. Paste your keys into the right fields:
   - AssemblyAI API key
   - OpenAI API key (or Gemini API key)
5. Click **Test connection** — should return "OK". If it fails, copy
   the error message — usually points at a wrong model name or a
   restricted key.
6. Click **Save**

---

## 5. Add brtlb to your phone's home screen (optional)

For a smoother experience, install brtlb as a Progressive Web App:

- **iPhone**: Open `brtlb.io` in Safari → tap **Share** → **Add
  to Home Screen**. The app icon will appear like a native app.
- **Android**: Open `brtlb.io` in Chrome → menu → **Install
  app**.

Granting microphone permission once on first record is normal.

---

## Common stumbling blocks

**"API Keys are Disallowed"** when creating a Gemini key — your Google
Workspace organization has a policy blocking API key creation. As an
admin, override it (see Workspace path above) OR use a personal Google
account.

**"This model … is no longer available to new users"** — Google retired
your model. Click **List my models** in Settings, then pick a current
one (or type `gemini-3-flash-preview` directly).

**"CORS requests are not allowed for this Organization"** (Anthropic
only) — BAA-org Anthropic keys block browser calls. We removed Anthropic
from the brtlb picker for now; use Gemini or OpenAI.

**Test connection hangs** — your visit was likely too long. brtlb's
total transcription budget is 90 minutes, so an unusually long recording
might appear to hang while AssemblyAI processes. For initial smoke
testing, try a 30-second test recording.

**"Reached gemini-3-flash-preview but got an unexpected reply: (empty)"** —
older symptom of Gemini 3 thinking-model behavior consuming the entire
output budget on internal reasoning. The current build raises the probe
budget to 256 tokens and treats 200-with-empty-text as success. If you
hit this on an older deployment, refresh to pull the latest.

**Generation works but actual recordings fail with billing errors** —
your Cloud project doesn't have billing linked. Open
console.cloud.google.com/billing/linkedaccount, pick the project, and
attach a billing account. The free tier still applies; you just need
the card on file.
