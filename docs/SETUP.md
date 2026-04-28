# Setting up brtlb

brtlb runs entirely in your browser. You bring two keys: one for
**transcription** (AssemblyAI) and one for **note generation** (your
choice of Google Gemini or OpenAI). Keys live only in your browser's
localStorage — they never leave your device.

You'll need:
- A computer or phone with a modern browser
- About **15 minutes** for first-time setup
- A credit card for the AI vendors (both have free tiers; brtlb is cheap to run — typically a few cents per visit)

---

## 1. Get your AssemblyAI key (transcription)

AssemblyAI converts the recorded audio into a transcript with speaker
labels. Without a BAA, do not record real patient encounters with it.

### Steps

1. Go to **https://www.assemblyai.com** → **Sign Up** (free)
2. After you sign in, your dashboard shows an **API Key** at the top
   right. Click the copy icon. Format: a 32-character hex string.
3. **If you'll record real patient visits**, sign the BAA before recording
   anything: see `docs/BAAs.md` for the DocuSign link. The BAA is
   associated with whichever AssemblyAI account email you provide.
4. Hold onto the key — you'll paste it into brtlb in a moment.

### Cost

AssemblyAI charges per minute of audio. Pricing as of mid-2025 was
roughly **$0.65/hour** of audio (about $0.16 for a 15-min visit). Check
their current pricing page for exact numbers.

---

## 2. Get your Google Gemini key (note generation)

Gemini is a fast, capable model from Google. Note: AI Studio keys are
NOT BAA-eligible — for real PHI workloads use Vertex AI (separate path).
For testing or non-PHI use, AI Studio is fine.

### Easiest path: personal Google account at AI Studio

1. Go to **https://aistudio.google.com**
2. Sign in with a **personal** Google account (Gmail). If you sign in
   with a Workspace account (e.g., your @yourpractice.com) and the
   organization has restricted AI Studio, you'll get an error — use a
   personal account or follow the Google Workspace path below.
3. Click **Get API Key** in the top-left, then **Create API Key**.
4. Pick or create a project. Copy the `AIzaSy...` key.

### Google Workspace path (if your org allows it)

If you want to use your work account or your organization is GCP-managed:

1. Make sure your Workspace org allows API key creation. As an admin,
   check **GCP Console → IAM & Admin → Organization Policies** for any
   active policy named **"Block service account API key bindings"** or
   similar — you may need to override it. (See `docs/BAAs.md` for the
   broader Vertex AI path which IS BAA-eligible.)
2. Visit **https://console.cloud.google.com/apis/credentials**
3. **Create Credentials** → **API key**
4. Restrict to **Generative Language API** for safety
5. Copy the `AIzaSy...` key

### Cost

Gemini Flash models are cheap — typically less than a cent per visit.
Google offers a generous free tier; you may not see any charges for
the beta.

---

## 3. (Optional) Get your OpenAI key (alternative note generator)

If you'd rather use OpenAI's GPT-4o instead of Gemini:

1. Go to **https://platform.openai.com**, sign up
2. Add billing on the **Settings → Billing** page (the API requires it)
3. Visit **https://platform.openai.com/api-keys** → **Create new secret
   key**. Format: `sk-proj-...` or `sk-...`. Copy it immediately — you
   can't view it again.
4. **For real PHI**: you need an **Enterprise** or **Azure OpenAI** plan
   with a signed BAA. Standard pay-as-you-go isn't BAA-eligible.

### Cost

GPT-4o is a few cents per visit. Slightly more expensive than Gemini
Flash but very stable.

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
