# brtlb — website copy + feature differentiation

Ready-to-use copy for a marketing site. All claims here are technically
accurate as of 2026-05-01 — no embellishment, no aspirational features
listed as live. If anything looks generic or hyped, flag it.

---

## Hero

### Primary headline (pick one)

- **The AI scribe that runs in your browser, not in someone else's cloud.**
- **Pediatric documentation, compressed. No backend. No middleman. Your keys, your data.**
- **brtlb — the only AI scribe built for pediatric direct primary care.**

### Subhead

> Record the visit. Get a SOAP note in 30 seconds. Paste it into your EHR.
> brtlb runs entirely in your browser — your patient audio never touches our
> servers because we don't have any. Two API keys, five minutes of setup,
> ~$0.20 per visit. No subscription, no minimums, no SaaS lock-in.

### Single-CTA section

> **Try it free at brtlb.io.**
> Bring your own AssemblyAI and Google Gemini keys (we'll walk you through
> getting them) and you're documenting visits in five minutes.

---

## Who this is for

> brtlb was built by a pediatric direct primary care physician who got tired
> of generic AI scribes treating every visit like an adult internal medicine
> appointment.
>
> If you run a pediatric DPC practice — solo or small group — you'll
> recognize the friction generic scribes ignore:
>
> - **Sibling visits.** Three kids in one room, one recording. Generic
>   scribes flatten this into one note or get patient names confused.
> - **Long developmental evaluations.** Generic scribes time out at 30
>   minutes. brtlb handles up to 90 minutes (autism evals, behavioral
>   intakes, complex med-management).
> - **Sensitive adolescent disclosures.** Generic scribes don't flag content
>   the parent shouldn't see in a shared chart.
> - **Pediatric vocabulary.** "Atopic dermatitis," not "skin condition."
>   "Acute otitis media," not "ear infection."
> - **Multi-template visits.** Combined well-child + acute concern shouldn't
>   collapse into a sick visit. brtlb preserves both.
>
> If you've been frustrated by Heidi or Abridge or Suki applying enterprise
> internal-medicine assumptions to your peds workflow, brtlb is built for you.

---

## Core differentiators

### 1. Zero-backend privacy architecture

Most AI scribes route your patient audio through their servers, hold it in
their database, run their pipelines, and ask you to trust their BAA.

**brtlb has no servers.** It's a static web app. Your audio uploads
directly from your browser to AssemblyAI (under your AssemblyAI BAA) and
the transcript text goes directly from your browser to Google Gemini
(under your Google Workspace HIPAA BAA). brtlb the company is never in
the data path. Neither is Vercel, the host that serves the static code.

This means:
- **No "trust us with your PHI"** because we never have it.
- **No SaaS data breach** can leak your patients' visits — there's no
  database to breach.
- **No vendor lock-in** — pull your AssemblyAI and Google keys, the data
  goes with you. brtlb stops being part of your stack the moment you
  close the tab.
- **Your existing BAAs cover everything.** Most pediatric practices already
  have Google Workspace HIPAA BAAs. AssemblyAI's BAA takes 5 minutes via
  DocuSign. Done.

You're not buying our security promises. You're using vendors you already
trust, with your existing legal coverage, plus a piece of code in your
browser that orchestrates the workflow.

### 2. Pediatric-tuned templates (9 of them)

brtlb ships nine visit-type templates, all written by a pediatrician with
pediatric-specific fabrication rules:

| Template | What it covers |
|---|---|
| **SOAP** | Default, mixed-visit handling, encounter framing |
| **Well-Child** | Growth, milestones, anticipatory guidance, vaccines, captures every parent concern (typical visit has 4-6 small threads) |
| **Sick Visit** | Acute illness, symptom timeline, return precautions, pediatric red flags |
| **Follow-Up** | Interim status on a known condition |
| **ADHD Med Check** | Response, side effects, vitals on stimulants |
| **Procedure** | Laceration repair, I&D, ear curettage, frenectomy — sterile-technique narrative |
| **Behavioral Health** | Mood, anxiety, suicidality screen, trauma, ADHD diagnostic intake. Captures verbatim patient quotes for medicolegal record. Structures around safety planning. |
| **Developmental Evaluation** | Long-form autism / developmental eval. M-CHAT, ADOS-style observation, parent interview about milestones + social communication + repetitive behaviors. Accepts 1-2 page notes. |
| **Dictation** | Mode-specific for physician-narrated notes |

**Auto-detection.** brtlb listens to the transcript and picks the right
template automatically. You can override with a dropdown and click
Regenerate.

**Custom templates.** Need a format the built-ins don't cover? Type a
plain-English description and click "Polish with AI" — brtlb rewrites it
in the brtlb house style with the full safety scaffolding (anti-fabrication
rules, anatomic-laterality discipline, diagnostic-specificity guards,
consistency check) baked in.

### 3. Multi-patient sibling visits — handled correctly

When two or three kids come in together (a common DPC reality), brtlb:
1. Diarizes the audio (speaker labels per voice)
2. Identifies which utterances belong to which child by names mentioned
3. Generates a separate SOAP note per child with the right template per
   visit type (Tommy → Sick, Lily → Well-Child, Max → Well-Child)
4. Concatenates them with patient headers and `---` separators
5. The Review screen tabs through each kid; section paste, regenerate,
   and edits are scoped to the active patient

Generic scribes either flatten siblings into one note (clinical risk) or
require you to record each child separately (workflow friction). brtlb
handles the actual workflow.

### 4. Long-visit ready

Built for the visits other scribes time out on:

- **90-minute transcription budget** — autism evaluations finish cleanly
- **Chunk-save resilience** — every second of audio persists to local
  storage as it's recorded; tab crash mid-visit recovers automatically
- **Adaptive upload timeout** — scales with file size (~30 sec/MB) so
  slow clinic WiFi doesn't kill long-recording uploads
- **Chapter markers for ≥30 min recordings** — auto-generated 3-7 named
  segments with timestamps so a 90-min eval transcript is scannable
- **Verbatim quote capture** — pulls up to 5 direct parent/patient
  quotes verbatim, useful for medicolegal documentation and adolescent
  disclosure tracking

### 5. Real-time interruption detection (deterministic)

Browser-based recording has a real failure mode: iOS suspends the tab
when you lock the screen, and during phone calls the OS takes the mic.

brtlb detects every interruption deterministically — no false positives,
no missed real losses:

- **Wake Lock** acquired at recording start prevents accidental auto-lock
- **`track.onmute`** detects incoming calls and other apps stealing the mic
- **Chunk-count comparison** distinguishes "screen covered but recording
  continued" from "recording actually paused" — banner only fires when
  audio was actually lost, with definitive copy: *"Recording was
  interrupted — Xs of audio lost"*
- **`track.onended`** catches mic disconnects (AirPods, USB) and revoked
  permissions

When something interrupts your recording, you find out immediately and
exactly. No silent failures, no "wait, did that save?"

### 6. Built-in compliance tooling

- **Local audit log** — every meaningful action logged with timestamp +
  type only (no PHI). Last 200 actions visible in Settings → Privacy &
  Security. Wipe All clears it. HIPAA technical-safeguard-friendly.
- **Auto-delete from AssemblyAI** — by default brtlb tells AssemblyAI to
  delete each transcript and the audio from their side immediately after
  the result is pulled. Cuts vendor retention from days to seconds.
- **Audio auto-purge** — local audio blobs purge on a configurable
  schedule (default 7 days). Transcript and note kept; raw audio gone.
- **Idle auto-lock** — UI hides PHI behind a tap-to-continue screen
  after configurable inactivity (default 5 min).
- **Wipe All Data** — single button drops every recording, transcript,
  note, key, audit log entry, and setting. No undo.
- **Clear clipboard** button — wipes PHI from the OS clipboard after
  pasting into your EHR.

### 7. Costs ~$0.20 per visit, no markup

brtlb itself is free. You pay your vendors directly:

- AssemblyAI transcription: ~$0.16 per 15-min visit
- Google Gemini note generation: <$0.01 per visit
- **Total per visit: ~$0.17–0.20**

For comparison: Heidi at $99/month is roughly $0.50/visit if you do
200/month. Abridge enterprise is $300+/month. brtlb is the cost of
the underlying compute, with no SaaS layer added.

### 8. Open source (AGPL-3.0)

The entire codebase is public under AGPL-3.0. You can audit every line
of code that touches your patient data. You can fork it. You can
self-host it on your own infrastructure. You're not depending on a
vendor's continued existence to keep documenting visits.

---

## Feature catalog (deeper dive section)

### Recording

- One-tap **Record visit** on the home screen
- **Ambient mode** captures the full room with speaker diarization
- **Dictation mode** for physician-narrated notes
- **Pause / Resume** during the visit
- **Mark moment** — single tap during a recording to flag a clinically
  important moment; brtlb pays extra attention to those passages when
  generating the note
- **Subtle visual** — small pulsing red dot, modest timer, calm breathing
  line. Patient barely notices the screen.
- **Mic check** toggle reveals a full bouncy meter on demand
- **Wake Lock** keeps the screen from auto-locking during recording

### Note generation

- **9 built-in templates** + custom templates with AI polish
- **Auto-template detection** based on transcript content
- **Adaptive note length** — sized to the visit (5-min URI gets a focused
  note; 90-min autism eval gets a richer one)
- **Multi-patient splitting** with patient-aware tabs
- **Edit / Formatted toggle** on the note
- **"Tell brtlb what to change"** — plain-English revision in a textarea
  ("shorten the assessment", "fix the dose to mg/kg", "add return
  precautions")

### Quality assurance

- **Review warnings** — independent LLM pass that flags hallucination
  (note says something the transcript doesn't support) and omission
  (transcript discusses something the note misses). Plus mixed-visit
  collapse, assessment/plan mismatch, wrong-patient risk, and a
  **sensitive-content flag** for adolescent disclosures.
- **Capture quotes** — pulls verbatim parent/patient quotes from the
  transcript on demand. Strict guardrails: no paraphrase, attribution
  required, STT-garbled quotes dropped rather than guessed.
- **Generate pearls** — collegial-tone clinical observations a senior
  partner might surface. Subtle differentials, family dynamics worth
  noting, undertreatment flags.

### Export

- **Per-section copy** with three modes:
  - **All-in-one** (default) — single button, whole note
  - **Pick** — tap chips for HPI, Exam, A/P, etc. for field-by-field paste
  - **Walk through** — guided one-section-at-a-time mode for EHRs with
    discrete fields per SOAP section
- **Rich-text copy** — bold formatting (abnormal exam findings, sensitive
  flags) preserved when pasted into Elation, Word, or any rich-text
  destination
- **Email** — pre-filled mailto with subject + body, useful for moving
  notes between devices when no Universal Clipboard available
- **Share** — native share sheet (AirDrop, Messages, Mail)
- **Download** — `.txt` file with the visit label as filename

### Search + organization

- **Auto-label** — brtlb generates a 3-6 word label from the transcript
  ("Tommy ear pain f/u")
- **Search** across labels, transcripts, and note content (local only)
- **Filter chips** — All / Ready / In progress / Failed
- **Per-row delete** with confirmation modal
- **Group by recency** — Today / Yesterday / Earlier this week / Earlier

### Setup + onboarding

- **Guided wizard** — first-run flow walks through getting an AssemblyAI
  key and a Google Gemini key, with live verification of each before
  letting you advance
- **Auto-detection of Workspace org-policy blocks** — when iOS Studio
  shows "API Keys are Disallowed," the wizard surfaces the admin
  override path inline with deep links to GCP IAM and Org Policies
- **Billing-not-set-up warning** — explicit callout before recording
  that the Cloud project must have billing linked
- **Theme**: Light, Dark, or Auto (follows OS preference)

### Privacy + security

- Full architecture and BAA decisions documented at `docs/BAAs.md` and
  `docs/SETUP.md` in the repo
- "What's new" changelog panel in Settings
- Privacy & Security panel covers: what stays on this device, what
  leaves and to where, your responsibilities, lost-device runbook,
  clipboard hygiene, vendor retention controls

---

## Comparison: brtlb vs. the major AI scribes

| Capability | brtlb | Heidi | Abridge | Suki | DAX (Nuance) |
|---|---|---|---|---|---|
| **Pricing** | Free / ~$0.20 per visit | $99-149/mo | Enterprise only | $99-200/mo | $300+/mo |
| **Data architecture** | Browser-only, no backend | SaaS (their cloud) | SaaS | SaaS | SaaS |
| **Pediatric tuning** | Built-in (peds DPC) | Generic | Multi-specialty | Multi-specialty | Multi-specialty |
| **Multi-patient sibling visits** | ✅ Native | ❌ | ❌ | ❌ | ❌ |
| **Behavioral health template** | ✅ Built-in | Generic | Generic | Generic | Generic |
| **Developmental evaluation template** | ✅ Built-in | ❌ | ❌ | ❌ | ❌ |
| **Long visits (60+ min)** | ✅ 90 min | Variable | ✅ | ✅ | ✅ |
| **Custom templates** | ✅ AI-polished | Limited | Enterprise | ✅ | ✅ |
| **EHR direct integration** | ❌ Copy/paste | Some | ✅ | ✅ | ✅ |
| **Open source** | ✅ AGPL-3.0 | ❌ | ❌ | ❌ | ❌ |
| **BYO API keys** | ✅ Default | ❌ | ❌ | ❌ | ❌ |
| **Built by a clinician for clinicians** | ✅ Pediatrician | Founders are clinicians | Mixed | Mixed | Enterprise software co. |

The bigger AI scribes are excellent products for what they target. They
target large enterprise health systems and multi-specialty practices.
**brtlb explicitly doesn't compete in that market.** brtlb is for the
~250 independent pediatric DPC practices that fall through the gap
between "too small for enterprise" and "doesn't fit generic mid-market."

---

## FAQ

### Is brtlb HIPAA compliant?

brtlb is software that helps you generate HIPAA-compliant documentation,
not a HIPAA-covered entity itself. Compliance comes from the vendors in
your data path having BAAs:

- **AssemblyAI**: free 5-minute DocuSign BAA
- **Google Gemini**: covered by your Google Workspace HIPAA BAA when the
  key comes from a billing-enabled Cloud project

brtlb itself never holds your PHI — there's no brtlb cloud — so there's
no brtlb BAA to sign. The legal architecture is: your existing BAAs cover
the data flow, brtlb is just code running in your browser.

Full BAA decision tree at `docs/BAAs.md`.

### What if I don't use Google Workspace?

Use OpenAI Enterprise or Azure OpenAI. Both have HIPAA BAAs. The Settings
panel has an "OpenAI-compatible" provider — paste your key, set the base
URL if you're on Azure, done.

### Can I use brtlb with Anthropic / Claude?

Currently no. Anthropic Enterprise/BAA accounts block browser CORS
requests as part of their custom-retention security model, which makes
direct browser-to-Claude calls impossible. We've kept the Anthropic
adapter in the codebase for when this changes (or for a future native
shell that could relay), but it's hidden from the picker today.

### What happens if my AssemblyAI account expires?

brtlb's classified errors will show: *"AssemblyAI: account out of credit
or payment failed. Top up at https://www.assemblyai.com/dashboard/account
to continue."* Top up, refresh brtlb, you're recording again. Existing
recordings on your device are unaffected.

### Does brtlb work on my phone?

Yes. brtlb is a Progressive Web App. On iPhone, open brtlb.io in
Safari and tap **Share → Add to Home Screen**. On Android, open in Chrome
and tap **Install app**. Same code, native-feeling app icon.

**Important caveat for iOS:** browser-based recording stops when the
phone screen locks. brtlb shows a clear *"Heads up: keep the screen on
for the whole visit"* advisory and detects screen-lock interruptions
deterministically. A native iOS app (Capacitor wrap) is on the roadmap
to remove this limitation — until then, keep the screen on.

### Can I sync recordings across devices?

No, deliberately. Each device + browser context is its own data island.
There's no brtlb cloud to sync through. Use Copy / AirDrop / Email /
Save-to-Files to move a note manually.

### Why is the repo public?

So you can audit every line of code that touches your patient data. AI
scribes are an opaque part of clinical workflow; we wanted brtlb to be
the opposite of opaque. AGPL-3.0 — fork it, modify it, host it yourself
if you want.

### What's coming next?

- **Capacitor native iOS app** (resumes the screen-lock case)
- **Personalization layer** (your "voice / boilerplate / signoff" applied
  to every note)
- **Multi-vendor STT failover** (Google Cloud STT as automatic backup)
- **Practice analytics** (visit type breakdown, time saved, cost analysis)
- **Premium templates library** for paid Pro tier

Roadmap details and trade-offs documented in `CHECKPOINT.md` in the repo.

---

## Tone notes (for whoever writes the actual site)

- **Confidence without hype.** No "revolutionary" or "AI-powered" filler.
- **Specifics over abstractions.** "Captures every parent concern,
  typical well-child has 4-6 small threads" beats "thorough notes."
- **Honest about limitations.** The iOS screen-lock thing, the
  no-cross-device-sync thing, the no-direct-EHR-integration thing — call
  these out, don't hide them. Trust comes from honest specifics.
- **Avoid medical condescension.** Pediatric DPC docs are sophisticated
  about both medicine and software. Speak to them as peers.
- **Don't oversell open source.** The AGPL is a real differentiator but
  most clinicians don't care about license. The "you can audit the code"
  framing matters more than "AGPL-3.0."
