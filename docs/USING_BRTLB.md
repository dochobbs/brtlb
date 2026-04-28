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

- **Big timer** counts elapsed seconds — easy to glance at.
- **Live waveform** — 24 vertical bars that pulse with the room's audio
  level. Great for confirming the mic is hot.
- **Pause / Resume** — the visit hits a pause (parent steps out, you go
  examine an ear), tap Pause. Tap Resume to keep going. Pauses don't
  count against transcription time.
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
proportionally longer; the longest brtlb will wait for transcription is
30 minutes (the cap exists so a stuck job doesn't trap the UI forever).

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
having to. The seven templates are:

- **soap** — generic, default fallback, handles mixed visits
- **well-child** — preventive visit (vaccines, milestones, anticipatory
  guidance dominate)
- **sick-visit** — acute illness or injury (URI, ear pain, rash, fever,
  GI, asthma)
- **follow-up** — interim check on a known problem
- **adhd-med-check** — ADHD medication visit (response, side effects,
  vitals on stimulant)
- **procedure** — in-office procedure (laceration, I&D, ear curettage)
- **dictation** — physician-narrated, mode-specific

If you record in ambient mode, brtlb auto-routes after transcription.
If you record in dictation mode, the dictation template is always used.

The picked template shows up in the **Template** dropdown on the right
panel. Don't like the pick? Change the dropdown and click **Regenerate**
— brtlb re-runs the LLM (no re-transcription) with your chosen template.

---

## Custom templates

If you have a personal note format ("Dr. Smith's well-child layout"),
go to **Settings → Custom Templates** and write it in plain English.
Save. It appears in the Template dropdown alongside the built-ins, ready
to use on any visit.

The custom prompt body is sent to the LLM verbatim, so you can be as
specific as you want about section order, abbreviations, what to bold,
how to phrase the plan, etc.

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

Three buttons below the note:

- **Share** — opens your phone's native share sheet (AirDrop, Messages,
  Mail, Slack, Spruce, your EHR). On desktop falls back to copying the
  text. Cleanest mobile workflow.
- **Copy text** — copies the note to clipboard as plain text.
- **Download** — saves a `.txt` file with the visit label as the
  filename. Plain text, no markdown formatting.

Note: there's no "post to EHR" button. brtlb is BYO-EHR — you copy or
share the note into wherever your charts live.

---

## Split-screen workflow (recommended on a desktop)

The fastest desktop workflow: brtlb on the left, your EHR on the right.
Record while you chart, copy/paste the finished note into the visit
when it's ready.

### macOS

- **Native:** click and hold the green window button on a Chrome window
  → "Tile Window to Left of Screen" → pick the EHR window for the right
  half. Done.
- **Even faster** (with [Rectangle](https://rectangleapp.com), free):
  open brtlb in Chrome → press `⌃⌥←` → opens EHR in another Chrome
  window → press `⌃⌥→`.

### Windows

- Snap brtlb to the left: `Win + ←`. Snap the EHR to the right:
  `Win + →`.

### Two-tab pattern (single window)

If you don't want split panes, two tabs in the same Chrome window works
fine. brtlb keeps recording state across tabs — switch to the EHR tab
to look up vitals or last visit, tab back, and your timer/waveform are
still going.

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
Tap any card to jump back into Review.

If a recording's audio has been auto-purged (see Privacy below), it
shows an "Audio purged" badge — you can still read the transcript and
note, but you can't re-run the pipeline from audio.

---

## Privacy & safety

brtlb is paranoid by default.

- **Keys masked.** Once saved, your AssemblyAI / Gemini / OpenAI keys
  show as `sk-•••••last4` with a Replace button. Never sit visible in
  the DOM.
- **Errors redacted.** Any error display runs through a regex masker
  that removes API keys before showing.
- **Audio auto-purge.** Audio blobs older than your retention setting
  (default 7 days) are dropped automatically on app load. Metadata,
  transcript, and note are kept — only the heavy PHI (raw audio) is
  removed. Bump retention to 30 days or 0 (never) in Settings.
- **Idle auto-lock.** brtlb locks the UI after N minutes of inactivity
  (default 5). Tap to unlock. Set 0 to disable.
- **Wipe all data.** Settings → Danger Zone → big red button. Drops
  every recording, transcript, note, key, and setting. No undo.
- **CSP allowlist.** Outbound network is restricted to AssemblyAI,
  OpenAI, Google, Anthropic. brtlb literally can't send your data
  anywhere else.
- **No analytics, no tracking.** brtlb has zero third-party scripts.
  The Vercel host serves static files and never sees your audio,
  transcript, or note.

---

## Recovery & resilience

- **Tab closed mid-pipeline?** Next time you open brtlb, any recording
  stuck in transcribing/generating for >5 min auto-marks as failed
  with a Retry button. The audio is still there — tap Retry to resume.
- **AssemblyAI flaked?** A Retry button on the Review screen re-runs
  the full pipeline from the saved audio. No need to start over.
- **Generation produced something weird?** Click Regenerate (with the
  same template or a different one) — re-runs the LLM only, no
  re-transcription. Cheap and fast.

---

## Quick reference (one-liners)

| What you want | How |
|---|---|
| Start a visit | Tap **Record visit** on Home |
| Switch to dictation | Tap **"or dictate instead"** below the record button |
| Pause for a moment | **Pause** during recording |
| Mark something important | **Mark moment** — single tap, no pop-up |
| Stop and process | **Stop** — Review screen runs the pipeline |
| Edit the note in plain English | The big seafoam box on the Review screen |
| Edit raw markdown | Toggle **Edit** on the Note panel |
| See the transcript | "Show transcript" toggle on the Transcript panel |
| Try a different template | Change dropdown → **Regenerate** |
| Check for hallucinations / omissions | **Check for warnings** |
| Get clinical pearls | **Generate pearls** |
| Share to EHR / Messages / Mail | **Share** (mobile) or **Copy text** (desktop) |
| Save a file | **Download** (`.txt`, plain text) |
| Add a custom note format | Settings → Custom Templates |
| See past visits | Home screen — grouped by recency |
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
