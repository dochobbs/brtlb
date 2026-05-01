# Personalization Pipeline — design thinking

> Status: design exploration. Not built. Decision: should we ship this?

## The question

Pediatric DPC docs each have idiosyncratic note style — voice ("mom" vs "mother"), boilerplate ("discussed return precautions"), structure (bullets vs prose), abbreviations, signoff. The current brtlb output is good but generic. Should we let users encode their preferences once, then have brtlb apply them to every note?

The risk we have to take seriously: **personalization can quietly degrade clinical quality.** A user who writes "be confident in your assessment" can push the model toward over-narrowing. A user who says "include return precautions in every plan" can push the model toward fabricating precautions that weren't discussed. We can't trade personalization for hallucination.

This doc walks through how the injection pipeline would work, where it would help, where it could hurt, and the safeguards required to make it net positive.

---

## What "preferences" cleanly capture (the safe zone)

These dimensions are pure style — they don't change what the note says, only how:

| Dimension | Example |
|---|---|
| **Person/voice** | First-person ("I assessed...") vs third-person ("Patient was assessed...") |
| **Parent naming** | "Mom/Dad" vs "Mother/Father" |
| **Section labels** | "Subjective" vs "Interval History" — matches EHR field names |
| **Density at fixed information level** | "Concise prose" vs "narrative" — same facts, different word count |
| **List style** | Bullets vs paragraphs in HPI |
| **Boilerplate appended verbatim** | A user-supplied closing line to every Plan |
| **Abbreviations** | "AOM" vs "acute otitis media", "URI" vs "upper respiratory infection" |
| **Signoff** | "Hobbs, MD" appended at end |

These are all safe to vary. None of them affects what facts go in the note.

## What preferences should NOT be allowed to change (the danger zone)

These categories sound like "preferences" but actually compromise clinical quality:

| Dimension | Why it's dangerous |
|---|---|
| **Diagnostic confidence** | "Be more confident" or "commit to a specific diagnosis" → model narrows past what the transcript supports. Direct conflict with our anti-narrowing rule. |
| **Inclusion guarantees** | "Always include return precautions" → if the visit didn't discuss them, model fabricates. |
| **Specificity guarantees** | "Always specify medication dosing" → fabrication when not stated. |
| **Length floors/ceilings** | "Always exactly 200 words" → forces padding or truncation that loses signal. |
| **Diagnostic suggestions** | "If ear pain, write AOM" → bypasses clinical reasoning. |
| **Confidence boilerplate** | "Always end with 'patient reassured'" → the assertion may not be true for a given visit. |

A free-form preferences textarea would let users specify any of these. We need a guardrail that strips them out.

---

## Pipeline stages, end to end

### Stage 1: Authoring (Settings → Your documentation style)

User opens Settings. Sees a single textarea labeled "How you like your notes (optional)" with placeholder examples for safe-zone dimensions only. Types something like:

> "Concise prose, no bullets in HPI. Use 'mom' and 'dad', never 'mother' or 'father'. Section labels: 'Interval History' instead of 'Subjective'. End every Plan with 'Discussed return precautions and access to me 24/7.' Sign as 'Hobbs, MD.'"

Two buttons below:
- **Save** — saves the raw text as-is.
- **✨ Polish with AI** — same pattern as the custom-template polish we already shipped, but with a different meta-prompt focused on style preferences (see Stage 2).

### Stage 2: Polish with AI (the safety filter)

The Polish meta-prompt does three jobs:

1. **Reject danger-zone items.** A pre-coded blocklist of phrases that bypass clinical safety: "be confident", "always include", "always specify", "default to", "be more specific". The polish prompt is told: "If the clinician asks for any of these, drop that line and add a note saying 'Removed: would conflict with brtlb's anti-fabrication rules.'"

2. **Restructure into a clean style guide.** Bullet-list output organized by category (Voice, Parent naming, Section labels, Boilerplate, Abbreviations, Signoff). User reviews, edits, saves.

3. **Add explicit precedence framing** to the polished output. The first line of the polished guide reads: *"These are style preferences. They apply unless they would require fabricating, narrowing, or omitting a clinical detail — in which case the template's rules win."*

The polish output is human-readable. User can hand-edit before saving. They own what gets persisted.

**Concrete example.** User types:

> "Be confident in your assessments. Always include return precautions. Use 'Mom' and 'Dad'. Sign as 'Hobbs MD.'"

Polish meta-prompt rejects the first two items, returns:

```
PHYSICIAN STYLE PREFERENCES
These are style preferences. They apply unless they would require
fabricating, narrowing, or omitting a clinical detail — in which case
the template's rules win.

Voice
- Use "Mom" and "Dad" (not "Mother" or "Father").

Signoff
- Sign as "Hobbs, MD" at the end of the Plan.

Removed (would conflict with brtlb's anti-fabrication rules):
- "Be confident in your assessments" — could push the model to narrow
  diagnoses past what the transcript supports.
- "Always include return precautions" — could fabricate return
  precautions not discussed in the visit.
```

User reads, sees the rejections, understands why, saves.

### Stage 3: Storage

Saved to `settings.styleGuide: string` in localStorage. Same isolation as keys and templates — never leaves the device, exists only on this browser. Empty string by default; users opt in.

### Stage 4: Injection at note-generation time

Inside `composeNotePrompt`, after the template body but **before the transcript**, the style guide is wrapped in a clearly-bounded block:

```
{template body — including DOCUMENTATION PRINCIPLES, FABRICATION RULES,
 ENCOUNTER FRAMING, MULTI-PATIENT SAFETY, FORMAT RULES, CONSISTENCY CHECK}

PHYSICIAN STYLE PREFERENCES
The following describe how this physician personally writes notes.
Apply them as long as they do not conflict with the FABRICATION RULES
or CONSISTENCY CHECK above. If a preference would require fabricating,
narrowing, or breaking a documented safety rule, ignore that
preference for this note.

---
{styleGuide content}
---

{transcript}

{output instruction}
```

Position matters. The template's safety rules come **first** so they're seen as the foundational instructions. The style preferences come second, bounded by the explicit precedence statement. The transcript follows last, so the model has full context. The output instruction at the end says "return as markdown."

If `styleGuide` is empty, the entire block is omitted — no leftover sentinel text in the prompt.

### Stage 5: QA review (the independent safety net)

The existing QA review pass already runs independently after note generation. It inspects the final note against the original transcript for:
- Hallucination (note says something the transcript doesn't support)
- Omission (transcript discusses something the note misses)
- Wrong-patient contamination
- Mixed-visit collapse
- Sensitive-content flagging

The QA reviewer is **not given the style guide.** It only sees note + transcript. If the style guide somehow caused the model to fabricate, omit, or narrow, the QA review catches it as it would catch any other failure. This is the load-bearing safeguard.

### Stage 6: User feedback loop (manual, no auto-learning)

If the user's notes are coming out wrong, they edit the style guide. Same loop as today's "Tell brtlb what to change" — except the change is durable, applies to every future note, and is reviewable in Settings. We do **not** auto-learn from edits in v1; that's a v3+ consideration with bigger privacy implications.

---

## Where it works well

- **Voice and tone**: easy. "Concise" vs "narrative" — model handles density adjustments cleanly within the same factual content.
- **Verbatim boilerplate appending**: the model can include a user-supplied closing line literally without affecting body content.
- **Naming preferences**: "Mom" vs "Mother" — pure substitution, no clinical impact.
- **Section labels**: trivial relabel, model copies whatever the user requested.
- **Signoff**: append-at-end, zero risk.

For these, the personalization signal aligns with style choices the model can vary independently of clinical content. The safety rails barely have to do anything.

## Where it could hurt — the honest assessment

**1. Subtle voice-style spillover into confidence.**
A user who writes "Be confident in your tone" hopes for crisper prose. The model might internalize this as "be more decisive in assessments" — leading to subtle over-narrowing. We can blocklist the literal phrase in the polish meta-prompt, but creative phrasings ("write like a senior clinician", "no hedging") could slip through.

**Mitigation:** the polish meta-prompt is a safety filter, but the QA review pass is the load-bearing one. If style spillover causes a fabrication or narrowing, QA review flags it. We need to validate this empirically before shipping.

**2. Boilerplate insertion in cases where it doesn't fit.**
User says "always end the Plan with 'discussed return precautions.'" In a well-child visit where return precautions weren't discussed, the model would still append the line. Technically a fabrication.

**Mitigation:** distinguish "user wants this present in the note format" from "this was discussed during the visit." The polish meta-prompt should rephrase boilerplate requests as: "Append this exact text at the end of every Plan section, as the physician's standard practice." That framing tells the model the line is a stylistic signature, not a claim about today's visit. If the line implies content (e.g., "discussed return precautions"), the meta-prompt rephrases or rejects.

**3. Length-pref-driven content compression.**
"Always concise" + a 90-minute autism eval → the model may trim clinically meaningful detail to hit a perceived word count. Adaptive length already addresses this, but a user pref could fight it.

**Mitigation:** adaptive length wins over user style. The polish meta-prompt translates "concise" / "brief" preferences into voice-density choices, not absolute length floors. "Use efficient prose" yes; "always under 300 words" no.

**4. Conflict between style guide and template.**
Template says "narrative HPI" but user style says "bullets in HPI." The model picks one. Output may be inconsistent across runs.

**Mitigation:** the precedence framing explicitly says template wins. If the user really wants bullets, they should clone the template (Custom Templates, already shipped) and edit the format rules — that's the proper place to override structure. Style guide is for voice, not structure.

**5. Cumulative prompt complexity.**
Already we have: template body (~3-5K chars), bookmarks, speaker roles, multi-patient context, transcript, output instructions. Adding 500-char style guide is a 5-10% prompt increase. LLMs in long contexts sometimes lose focus on early instructions in favor of later ones. We need to verify the template's safety rules still dominate.

**Mitigation:** validate empirically (see below). Keep the polished style guide tight — meta-prompt enforces a 500-character cap.

**6. Custom templates already exist.**
Users who want deep control can clone a built-in template and edit the prompt body directly. That's a heavier hammer than a style guide but already shipped. Some "preferences" should route there, not into a global style guide.

**Mitigation:** the Settings UI for the style guide should explicitly say: "For sweeping changes like 'I want a totally different SOAP structure,' use Custom Templates. Style guide is for voice, naming, boilerplate, signoff."

---

## Required validation before shipping

Before turning this on for any user other than Hobbs:

1. **Author 3 distinct style guides** spanning the personalization spectrum:
   - "Concise, third-person, no boilerplate"
   - "Narrative, first-person, custom return-precautions line, sign with credentials"
   - "Mixed — section labels match Athena, abbreviations preferred, formal voice"

2. **Pick 5 fixed transcripts** of varying complexity:
   - Quick well-child (< 5 min)
   - Sick visit (10-15 min)
   - Mixed well-child + acute (15-20 min)
   - Behavioral health (30 min)
   - Autism eval (60+ min)

3. **For each pairing (3 × 5 = 15 cases),** run note generation:
   - Without style guide (baseline)
   - With style guide

4. **Score each output on five axes:**
   - Style fidelity (does the note actually reflect the user's stated preferences?)
   - Clinical accuracy (is the medical content right?)
   - Fabrication count (any invented vitals, durations, doses, findings?)
   - Diagnostic specificity drift (did style cause over-narrowing?)
   - QA review pass output (does the existing reviewer catch any new issues?)

5. **Decide based on results:**
   - Style fidelity > 80% AND fabrication doesn't increase → ship as-is
   - Style fidelity adequate but specific failure modes → tighten the polish meta-prompt for those modes, retest
   - Fabrication increases noticeably → back off and reconsider design

This is roughly 4 hours of validation work. Worth doing before public release; necessary before promoting it as a feature.

---

## What I'd recommend

**Proceed with the design above, but only after the validation above passes.**

The design has the right shape:
- Single textarea (low UX cost)
- Polish-with-AI for safety filtering
- Explicit precedence in the injected block
- Independent QA review as the load-bearing safety net
- Empty by default, opt-in

The risks are real but well-bounded by:
- The polish meta-prompt rejecting danger-zone items
- The injected precedence statement
- The QA review pass running blind to the style guide
- The 500-char cap keeping prompt complexity manageable
- A documented routing of "structural changes go to Custom Templates, not the style guide"

The validation work is the gating step. If empirical results show style fidelity goes up without fabrication going up, this is a clean win. If fabrication creeps up even slightly, we either retighten the polish or scrap the feature.

**What I'd NOT do:**
- Ship without validation
- Auto-learn from user edits (v1 — too much black-box behavior)
- Allow per-template style overrides (added complexity, weak demand signal)
- Allow style guides to dictate length floors/ceilings (fights adaptive length)
- Make this a paid feature (the entire UX of brtlb is "type once, get a personal scribe" — gating personalization behind a paywall undermines the magic)

**Open question to resolve before building:**
- Do we ship a starter style guide, or empty by default?
  - Argument for starter: shows the user what's possible, faster onboarding
  - Argument for empty: zero implicit recommendation, no chance of accidentally adopting unwanted defaults
  - My lean: empty by default. Add a one-click "Use a starter style guide" button that fills in a generic peds DPC starter that the user then edits.

---

## Decision needed

Greenlight the design + the 4-hour validation? If yes, I'll scope a concrete build (settings field, Polish meta-prompt, injection in `composeNotePrompt`, validation harness) into a plan. If no, this doc captures the thinking for revisiting later.
