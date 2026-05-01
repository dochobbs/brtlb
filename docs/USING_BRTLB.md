# Using brtlb

A friendly tour of every feature, in the order you'll discover them
during a real visit.

> **The vibe.** brtlb is a pediatric AI scribe that gets out of your way.
> Two keys, one button to record, plain English to fix anything that's
> off. Everything stays on your device unless you choose to share it.

---

## Recording a visit

The home screen has one giant graphite button: **Record visit**.

Tap it. Mic permission prompts (once). brtlb is recording.

That's the whole flow. No "new visit" form, no patient picker, no
template selection. By default brtlb is in **ambient** mode — capture
the whole room with speaker separation.

### Or dictate instead

If you'd rather narrate the note yourself (think classic dictation, no
diarization needed), tap the small **"or dictate instead"** link below
the Record button. Same flow, simpler pipeline (no speaker labels).

### While you're recording

The recording UI is **deliberately subtle in ambient mode** — designed for
the patient sitting across from you to barely notice it. What you see:

- A small **pulsing red dot** with the status text ("Ambient · Recording")
  — the universal "recording" indicator at calm size.
- A **modest timer** in the center, counting elapsed time. Big enough
  to glance at, small enough not to dominate.
- A **breathing line** below the timer that gently widens with audio
  level. Conveys "mic is alive" without an animated VU-meter feel.
- For the first **4 seconds** after you start, the full bouncy meter
  (24 bars) appears so you can confirm the mic is picking up audio,
  then it auto-collapses. Tap **Mic check** any time to bring the full
  meter back.
- **Dictation mode** (no patient watching) keeps the full meter on by
  default — there's no audience.

Buttons:

- **Pause / Resume** — when the visit hits a pause (parent steps out,
  you go examine an ear). Pauses don't count against transcription time.
- **Mark moment** — tap any time you want brtlb to pay extra attention
  to what's happening *right now*. The button flashes seafoam, and
  later, when the note is generated, brtlb is told "the physician
  marked these moments as important." Useful for nuanced findings, a
  worried-parent moment, the part where the kid said something quotable.
  No pop-up, no label entry — single discrete tap. Mark as many as you
  want.
- **Stop** — when you're done. brtlb saves the audio and immediately
  starts the pipeline.

### After Stop

You land on the **Review** screen. The pipeline runs automatically:

```
uploading → transcribing → generating → ready
```

A small status banner at the top tells you which stage you're in. Total
time is usually under 30 seconds for a 15-minute visit. Long visits take
proportionally longer; brtlb waits up to **90 minutes** for AssemblyAI
to finish transcribing — covers any realistic visit (most 60-min
recordings finish in 3–5 min of processing, 90-min autism evals in 5–8 min).

---

## The Review screen

Two big panels side by side (or stacked on mobile):

**Left: Transcript.**
- Collapsed by default — tap "Show transcript" if you want to read the
  raw output.
- Above the collapse: **speaker chips**. Tap each one to assign a role
  (Parent / Patient / Provider / Sibling / Other). The transcript and
  any future regenerate use those labels.
- If you marked moments during the visit, they show up here with their
  timestamps.

**Right: Note.**
- The auto-generated SOAP-style markdown note. Defaults to a sensible
  template — see "Auto template detection" below.
- Toggle between **Edit** (raw markdown source, you can directly edit
  it) and **Formatted** (rendered prose).
- Below the note: **Tell brtlb what to change** — the magic ✨ box. See
  the next section.

---

## ✨ Tell brtlb what to change

The hero of the note screen. A textarea that takes plain English:

> "Shorten the assessment"
> "Rewrite the plan as a numbered list"
> "Add return precautions for fever"
> "Patient is 8mo, not 8yo — fix throughout"
> "Include that mom is a peds nurse and we discussed home Tylenol dosing"

Type your instruction. ⌘+Enter (Mac) or Ctrl+Enter (Windows) to send,
or click **Revise note**. brtlb returns the COMPLETE revised note —
not a diff. The transcript still gates fabrication, so any changes you
ask for are grounded in what was actually said.

This is how most physicians will edit. Faster than direct markdown
editing, and you don't need to remember any conventions. Just tell it
what's off.

---

## Multiple patients in one recording

brtlb handles back-to-back encounters in a single ambient recording. If
you record two well-checks in a row, or a sick visit then a sibling's
quick check, brtlb does the work to keep them separate.

After transcription, brtlb runs a **split-by-patient** pass that reads
the diarized transcript and identifies which utterances belong to which
child. Patient labels come from names actually mentioned in the visit
("Tommy", "Lily") with an ordinal fallback ("Patient 1", "Patient 2")
if names don't surface.

For each patient, brtlb generates a **separate** note with the visit
type the splitter detected (well-child, sick, follow-up, etc.) and only
that patient's relevant utterances. The notes are concatenated in the
output, separated by a horizontal rule, with a header like:

```
## Tommy · Well Child — left ear pain

[Tommy's full SOAP note]

---

## Lily · Well Child

[Lily's full SOAP note]
```

A banner near the top of the Review screen shows you which patients
were detected and what each one's visit type + acute concerns were —
quick sanity check before copying anything.

The split is purely transcript-based — brtlb has no schedule access, no
EHR connection, no list of who's coming today. It just listens to who's
being talked to and about. If only one child is discussed, you get one
note as before.

**Mixed visits** (well-child + acute complaint on the same kid) are
preserved correctly — the splitter keeps it as a single segment with
`visit_type: well_child`, `includes_preventive_care: true`, and the
acute concern in the segment metadata.

---

## Auto template detection

brtlb watches the transcript and picks the best template without you
having to. The nine templates are:

- **soap** — generic, default fallback, handles mixed visits
- **well-child** — preventive visit (vaccines, milestones, anticipatory
  guidance dominate)
- **sick-visit** — acute illness or injury (URI, ear pain, rash, fever,
  GI, asthma)
- **follow-up** — interim check on a known problem
- **adhd-med-check** — ADHD medication visit (response, side effects,
  vitals on stimulant)
- **procedure** — in-office procedure (laceration, I&D, ear curettage)
- **behavioral-health** — pediatric mental-health visit (mood, anxiety,
  suicidality screen, trauma, ADHD diagnostic intake, family conflict,
  substance use, eating disorders). Captures verbatim quotes for the
  medicolegal record and structures around safety planning when
  appropriate.
- **developmental-eval** — long-form autism / developmental evaluation
  (M-CHAT, ADOS-style observation, parent interview about milestones +
  social communication + repetitive behaviors, diagnostic feedback).
  Long visits accept 1-2 page notes.
- **dictation** — physician-narrated, mode-specific

If you record in ambient mode, brtlb auto-routes after transcription.
If you record in dictation mode, the dictation template is always used.

The picked template shows up in the **Template** dropdown on the right
panel. Don't like the pick? Change the dropdown and click **Regenerate**
— brtlb re-runs the LLM (no re-transcription) with your chosen template.

---

## Custom templates

If you have a personal note format ("Dr. Smith's well-child layout"),
go to **Settings → Custom Templates**. Two ways to author one:

1. **Clone a built-in.** Pick any built-in template (Well-Child, Sick
   Visit, etc.) from the dropdown and start editing — you inherit all
   the fabrication rules, anatomic-laterality discipline, diagnostic
   specificity guardrails, and consistency check from the built-in by
   construction. Just rename and tweak the parts that are specific to
   your use case.

2. **✨ Polish with AI.** Type a rough description in plain English
   ("ortho follow-up note, focused PE on the joint, concise A/P with
   numbered items, always include 'patient ambulating without limp'").
   Click **Polish with AI** — brtlb uses your existing key to rewrite
   the rough text into a structured brtlb-style template with the
   full safety scaffolding (5 documentation principles, fabrication
   rules, format rules, consistency check, attribution). Costs about
   a tenth of a cent. Edit the polished result before saving if you
   want to adjust anything.

Saved templates appear in the Template dropdown alongside the built-ins,
ready to use on any visit.

---

## Adaptive note length

brtlb sizes the note to the visit. A 5-minute URI gets a focused note;
a 60-minute mental-health follow-up or 90-minute autism eval gets a
longer, richer one. No template "default length" override — length is
a function of clinical content density.

You can always steer it manually with **Tell brtlb what to change**:
"shorten the assessment", "expand the plan with return precautions",
etc.

---

## Visit chapters (long visits)

For ambient recordings ≥30 min, brtlb generates a small chapter map
above the transcript: 3-7 named segments with timestamps and a
one-sentence summary. Examples:

- `0:00 Parent interview — 6-month history of social withdrawal`
- `12:35 Child observation — play, communication, response to name`
- `32:10 Discussion of findings`

Lets you scan a 90-minute autism eval transcript at a glance instead of
scrolling. The chapter detector runs automatically when the recording
qualifies; short visits skip it.

---

## Sensitive-content flag

The Review warnings panel runs an extra check: if the transcript
touches suicidality, self-harm, abuse, substance use, sexual activity,
eating-disorder behaviors, custody conflicts, or intimate partner
violence — brtlb adds a 🟡 *(sensitive content)* line naming the topic.

Doesn't redact, doesn't block sharing. Just a heads-up to **review
before pasting to a shared chart** so adolescent or sensitive
disclosures don't accidentally end up in a parent-visible note.

---

## Review warnings (the safety net)

Below the note, the **Review warnings** panel runs an independent LLM
pass that hunts for two failure modes:

- **Hallucination** — note says something the transcript doesn't
  support
- **Omission** — transcript discusses something the note misses

Plus three secondary checks: mixed-visit collapse (well-child + acute
reduced to one), assessment/plan mismatch, and wrong-patient risk
(sibling contamination, name drift).

The reviewer is told the transcript may have STT errors and to
interpret charitably — the goal is flagging real safety issues, not
nitpicking phonetic transcription mistakes.

Output is a small markdown bullet list with:
- 🔴 Critical — safety-relevant
- 🟡 Warning — clinically meaningful but not unsafe
- ⚪ Info — minor

Click **Check for warnings** when you want a second look. Re-run after
edits to see if you've cleaned up the issues.

---

## Quotes captured

Below the note, the **Quotes captured** panel pulls up to 5 verbatim
parent / patient quotes from the transcript on demand. Useful for:

- HPI ("My son has been saying 'I don't want to be alive' for two
  weeks")
- Safety screens — verbatim language matters medicolegally
- Pediatric phrasing that's clinically meaningful in its specificity
- Cases where what was said exactly is the documentation

Strict guardrails: no paraphrase, attribution required (Parent /
Patient / Sibling), STT-garbled quotes are dropped rather than guessed.
Returns "No quotes captured." when nothing qualifies.

Click **Capture quotes** when you want them. Stored on the recording
and re-runnable if you tweak the note.

---

## Clinical pearls (the collegial layer)

A separate on-demand pass that surfaces 0–3 short clinical observations
about THIS visit — patterns, subtle differentials, family dynamics
worth noting. Like a senior colleague leaning over after you wrap up.

Examples of what brtlb might surface:
- "Mother is a physician — easy to default to her framing; worth
  confirming the child's symptoms in your own words to avoid co-option"
- "5-day amox for AOM in a 2yo with recurrent OM may be undertreatment;
  current AAP guidance favors 10 days under age 2"
- "Episodes cluster between Concerta peak and unstructured school time
  — worth distinguishing pharmacologic activation from environmental
  triggers"

Pearls are NOT generic safety advice and NOT restatements of your
plan. If brtlb doesn't have anything genuinely useful to add, it
returns "No pearls."

Click **Generate pearls** when you want them. Pearls are stored on the
recording — if you regenerate or tweak the note, they're cleared so you
can re-run on the new draft.

---

## Sharing the note

Above the export buttons, a **section paste** panel with three modes:

- **All-in-one** (default) — single button copies the whole note. Bold
  section headings keep the structure visible when pasted into a single
  notes field. Best for EHRs with one big "visit note" textarea.
- **Pick** — one chip per section (HPI, Exam, Plan, etc.). Tap any to
  copy just that section into the matching field on your EHR. Sections
  you've copied this session stay marked with ✓ so you can see your
  progress at a glance.
- **Walk through** — guided one-at-a-time mode. Big primary button:
  "Copy HPI →". Tap, paste, come back, button advances to "Copy ROS →".
  Linear, low cognitive load, ends when all sections are done. Includes
  word counts so you know how big each section is.

Below the section paste panel, four buttons:

- **Share** — native share sheet (AirDrop on Apple, Android Share, etc.).
  Falls back to copy on desktop.
- **Copy** — copies the whole note with **bold formatting preserved**
  when the destination accepts rich text (Elation, Word, most rich-text
  fields). Plain-text fallback for everything else.
- **Email…** — opens your mail app with the subject (visit label) and
  body (note) pre-filled. Useful for moving the note to another device.
  Only safe if your email provider is HIPAA-BAA-covered.
- **Download** — saves a `.txt` file with the visit label as the
  filename.

There's no "post to EHR" button. brtlb is BYO-EHR — you copy or
share the note into wherever your charts live.

### Move this note to another device

Below the export buttons, a small disclosure: **Move this note to
another device** with the specific recipes ranked by HIPAA risk:

- **AirDrop** (lowest risk) — peer-to-peer, never traverses cloud
- **Universal Clipboard** (Apple to Apple) — convenient but transits
  Apple, who doesn't sign BAAs for iCloud
- **Email yourself** — safe only with Workspace Gmail / Office 365 BAA;
  personal Gmail and iCloud Mail are NOT covered
- **iOS Save to Files** — pick "On My iPhone" (local, safe) over
  "iCloud Drive" (not BAA-covered)
- **iOS Notes** — same iCloud caveat; prefer "On My iPhone" Notes

---

## Split-screen workflow (recommended on a desktop)

The fastest desktop workflow: brtlb on the left, your EHR on the right.
Record while you chart, copy/paste the finished note into the visit
when it's ready.

### Chrome split tab (cleanest, single window)

Chrome desktop now supports splitting one window between two tabs
natively. Right-click brtlb's tab → **Split tab with…** → pick your
EHR tab. Both panels live in one Chrome window, no taskbar dance.

### macOS window snap (fallback)

- Click and hold the green window button on Chrome → "Tile Window to
  Left of Screen" → pick the EHR window for the right half.
- macOS Sequoia: drag a window to the screen edge or use the **Tile**
  shortcuts.
- With [Rectangle](https://rectangleapp.com) (free): `⌃⌥←` and `⌃⌥→`.

### Windows snap

- Snap brtlb to the left: `Win + ←`. Snap the EHR to the right:
  `Win + →`.

### Two-tab pattern (single window)

If you don't want split panes, two tabs in the same Chrome window works
fine. brtlb keeps recording state across tabs — switch to the EHR tab
to look up vitals or last visit, tab back, and your timer is still going.

### Install brtlb as a desktop app

Chrome / Edge / Arc all support installing brtlb as a standalone window
(no tabs, no address bar — looks native):

1. Open `brtlb.vercel.app`
2. Click the **install** icon in the address bar (looks like a small
   monitor with a down arrow), or **⋮ → Install brtlb…**
3. brtlb opens in its own window with the dot-mark icon. You can
   command-tab to it just like any app.

This makes split-screen nicer because brtlb doesn't share window real
estate with other Chrome tabs.

### The workflow itself

1. Patient walks in. Click **Record visit** in the brtlb window.
2. Examine, talk, do your normal thing. Mark moments as you go if
   anything's noteworthy.
3. When done, click **Stop**. Don't move the window — brtlb runs the
   pipeline (~30s for a 15-min visit).
4. Note appears. Skim it, **Tell brtlb what to change** if anything's
   off, click **Check for warnings** for safety.
5. Click **Copy text**. Tab to the EHR. Click into the note field.
   `⌘V` / `Ctrl+V`. Done.
6. Optional: **Generate pearls** to surface anything you might want
   to add to the assessment / plan before pasting.

For a full clinic, a typical loop is record-stop-edit-copy-paste in
under 90 seconds per patient — most of which is the LLM work running
in the background while you're already moving on to the next chart task.

---

## Visit labels

Top of the Review screen there's a free-form **label** field. Type
anything: "MM age 4 WCV", "Tommy ear pain f/u", "Lac repair 3yo".

**Auto-label.** If you don't type one, brtlb generates a short label
from the transcript automatically when the pipeline finishes — uses
the patient's first name if mentioned, or initials + age + visit type,
in the same style ("Lily ADHD med check", "Sick visit + WCV combined",
"Autism eval — James"). The label is editable: type over it any time.

The label is used as:
- The download filename (`brtlb-tommy-ear-pain-fu.txt`)
- The first line on the home screen list, so you can find this visit
  later

---

## The home screen — your visits

Recordings are grouped by recency:

- **Today**
- **Yesterday**
- **Earlier this week**
- **Earlier**

Each card shows the label, the stage (Recording / Transcribing /
Generating / Ready / Failed), how long the visit was, and which mode.
Tap any card to jump back into Review. Tap the small **×** on the
right of a card to delete it directly — confirmation modal opens, no
need to enter Review just to clean up.

### Search + filter

Once you have 4 or more recordings, a **search bar** appears above
the list. Search matches against the visit label, transcript text,
and note content — all local, never leaves the device. Below the
search, **filter chips** with live counts: All / Ready / In progress
/ Failed. Hit "Clear filters" if you over-filter into nothing.

If a recording's audio has been auto-purged (see Privacy below), it
shows an "Audio purged" badge — you can still read the transcript and
note, but you can't re-run the pipeline from audio.

---

## Privacy & safety

brtlb is paranoid by default. Settings → **Privacy & Security** has
the full panel; the headline pieces:

- **Keys masked.** Once saved, your AssemblyAI / Gemini / OpenAI keys
  show as `sk-•••••last4` with a Replace button. Never sit visible in
  the DOM.
- **Errors redacted.** Any error display runs through a regex masker
  that removes API keys before showing.
- **Audio auto-purge.** Audio blobs older than your retention setting
  (default 7 days) are dropped automatically on app load. Metadata,
  transcript, and note are kept — only the heavy PHI (raw audio) is
  removed. Bump retention to 30 days or 0 (never) in Settings.
- **AssemblyAI auto-delete after pulling** *(default ON)*. After we
  pull the transcript, brtlb tells AssemblyAI to delete the transcript
  and audio from their side. Cuts vendor retention from days to
  seconds. Toggle in Privacy & Security if you ever need to keep them.
- **Idle auto-lock.** brtlb locks the UI after N minutes of inactivity
  (default 5). Tap to unlock. Set 0 to disable.
- **Clear clipboard** button. After you copy a note and paste it into
  your EHR, the clipboard still holds the PHI until you copy something
  else. The button overwrites it on demand.
- **Local audit log** (last 200 actions). Timestamps + action types
  only — never patient identifiers, transcript text, or note content.
  Visible inside the Privacy & Security section. Cleared by Wipe All.
- **No cross-device sync.** brtlb has no backend. Recordings on your
  iPhone PWA aren't on your laptop or even in Safari-tab on the same
  iPhone (different storage containers). Use Copy / AirDrop / Email
  to move a note manually.
- **Wipe all data.** Settings → Danger Zone → big red button. Drops
  every recording, transcript, note, key, audit log entry, and setting.
  No undo.
- **CSP allowlist.** Outbound network is restricted to AssemblyAI,
  OpenAI, Google, Anthropic. brtlb literally can't send your data
  anywhere else.
- **No analytics, no tracking.** brtlb has zero third-party scripts.
  The Vercel host serves static files and never sees your audio,
  transcript, or note.

For the lost-device runbook (which key to revoke first, in what order),
see the **"If you lose this device"** subsection inside Settings →
Privacy & Security.

---

## Recovery & resilience

- **Tab crashed *during* recording?** brtlb persists every audio chunk
  to local storage as it captures. On next app load, any audio chunks
  that don't have a matching recording entry get reassembled
  automatically and surface as a "Recovered N min recording" on Home —
  ready to process. **You don't lose audio from a crash mid-visit.**
- **Tab closed *during* the pipeline?** Any recording stuck in
  transcribing/generating for >5 min auto-marks as failed with retry
  options visible.
- **Pipeline failed?** Two retry options on the Review screen:
  - **Retry note only** — uses the existing transcript, re-runs just
    the LLM. No re-transcription cost. Use this when only generation
    failed.
  - **Retry from audio** — re-uploads the audio and re-runs the whole
    pipeline. Use when transcription itself failed.
  brtlb suggests the cheaper path when a transcript already exists.
  Failed recordings remember their state — if you navigate away and
  come back, the retry options are still there.
- **Generation produced something weird?** Click Regenerate (with the
  same template or a different one) — re-runs the LLM only, no
  re-transcription. Cheap and fast.
- **Long visits.** brtlb waits up to 90 min for AssemblyAI to finish
  transcribing — covers any realistic visit length (most 60-min
  recordings finish in 3-5 min of processing).

---

## Quick reference (one-liners)

| What you want | How |
|---|---|
| First-time setup | Run the **wizard** on first launch (auto-opens) or Settings → **Run setup wizard** |
| Start a visit | Tap **Record visit** on Home |
| Switch to dictation | Tap **"or dictate instead"** below the record button |
| Confirm the mic is hot | **Mic check** link below the recording controls (also auto-shows for 4s at start) |
| Pause for a moment | **Pause** during recording |
| Mark something important | **Mark moment** — single tap, no pop-up |
| Stop and process | **Stop** — Review screen runs the pipeline |
| Edit the note in plain English | The big seafoam box on the Review screen |
| Edit raw markdown | Toggle **Edit** on the Note panel |
| See the transcript | "Show transcript" toggle on the Transcript panel |
| Try a different template | Change dropdown → **Regenerate** |
| Check for hallucinations / omissions / sensitive content | **Check for warnings** |
| Pull verbatim parent/patient quotes | **Capture quotes** |
| Get clinical pearls | **Generate pearls** |
| Retry just the note (keep transcript) | **Retry note only** in the error panel |
| Retry from audio | **Retry from audio** in the error panel |
| Copy whole note | **Copy** (rich text + plain) |
| Copy section by section | Switch section paste mode to **Pick** or **Walk through** |
| Email this note to yourself | **Email…** (warning: only safe with BAA-covered mail) |
| Save a file | **Download** (`.txt`, plain text) |
| Add a custom note format | Settings → Custom Templates → "+ New template" or "Clone a built-in" → edit and **Polish with AI** |
| See past visits | Home screen — grouped by recency |
| Search past visits | Search bar on Home (appears at 4+ recordings) |
| Delete a recording | × button on Home row, or Delete in Review |
| See activity log | Settings → Privacy & Security → Activity log |
| Clear the clipboard | Settings → Privacy & Security → Clear clipboard |
| Tighten vendor retention | Settings → Privacy & Security → Delete AssemblyAI transcripts after pulling (default ON) |
| What changed recently | Settings → What's new |
| Wipe everything | Settings → Danger Zone |

---

## Tips from real use

- **Let brtlb auto-label.** It's usually correct; just edit when it's
  not. Saves typing on every visit.
- **Mark moments liberally.** It's free and improves note specificity.
  Especially for visits with a worry, a quotable parent moment, or a
  subtle exam finding.
- **Trust auto template detection.** If brtlb picked the wrong one,
  change it and Regenerate — but most of the time it's right.
- **Use Tweak before direct edits.** It's faster, more grounded, and
  less likely to drift into hallucination than asking the LLM "improve
  this."
- **Run Review warnings on every visit.** It's cheap and catches
  surprising fabrications you'd miss while reading your own draft.
- **Pearls are optional.** Sometimes there's nothing to add. That's
  fine. Don't pearl-pad.
