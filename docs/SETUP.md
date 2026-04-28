# Setting up brtlb

brtlb runs entirely in your browser. You bring two keys: one for
**transcription** (AssemblyAI) and one for **note generation** (Google
Gemini is the default; OpenAI also supported). Keys live only in your
browser's localStorage — they never leave your device.

**The default stack** for most pediatric practices, who already run on
Google Workspace and have a Google HIPAA BAA:

| Component | Vendor |
|---|---|
| Transcription | AssemblyAI (sign their BAA, ~5 min) |
| Note generation | Google Gemini, key from your Google Cloud project |

If your practice instead has OpenAI Enterprise or Azure OpenAI, those
are equally good — see step 3.

You'll need:
- A computer or phone with a modern browser
- About **15 minutes** for first-time setup
- Billing on your Google Cloud project (or OpenAI account)
- brtlb costs ~$0.20 per 30-minute visit end-to-end

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

## 2. Get your Google Gemini key — *the recommended path*

The default for users already on Google Workspace.

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

For BAA-covered Gemini use, see `docs/BAAs.md` — Vertex AI is the only
unambiguously BAA-covered path. The standalone Gemini API on
`generativelanguage.googleapis.com` is ambiguous in Google's public
docs; confirm directly with Google for your specific Cloud account
before using it with PHI.

### Cost

Gemini Flash models are cheap — typically less than a cent per visit.
Google offers a generous free tier; you may not see any charges for
the beta.

---

## 3. Alternative — OpenAI key

If your practice has OpenAI Enterprise or Azure OpenAI instead of (or
alongside) Google, this works too. Pick whichever you have a BAA on.

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
2. Provision a model deployment (e.g., `gpt-4o`).
3. Copy the **endpoint URL** and the **API key** from the resource's
   "Keys and Endpoint" pane.
4. The Microsoft Azure Online Services agreement already includes the
   HIPAA BAA — no separate signature needed.
5. In brtlb Settings → "OpenAI-compatible" provider:
   - **Base URL:** your Azure endpoint, e.g.
     `https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT`
   - **API key:** the Azure key
   - Save.

### Cost

GPT-4o on either runs roughly 2-5 cents per visit depending on length.


---

## 4. Open brtlb and paste your keys

1. Go to **https://brtlb.vercel.app** (or whatever URL the brtlb operator
   gave you)
2. Tap **Settings** in the top right
3. Pick a provider — **Gemini** or **OpenAI-compatible**
4. Paste your keys into the right fields:
   - AssemblyAI API key
   - Gemini API key (or OpenAI API key)
5. Click **Test connection** — should return "OK". If it fails, copy
   the error message — usually points at a wrong model name or a
   restricted key.
6. Click **Save**

---

## 5. Add brtlb to your phone's home screen (optional)

For a smoother experience, install brtlb as a Progressive Web App:

- **iPhone**: Open `brtlb.vercel.app` in Safari → tap **Share** → **Add
  to Home Screen**. The app icon will appear like a native app.
- **Android**: Open `brtlb.vercel.app` in Chrome → menu → **Install
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

**Test connection hangs** — your visit was likely too long (over 30
minutes). Try a shorter recording first to confirm the keys work.
