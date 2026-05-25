# Design — LLM-based speaker recovery (Tier 2)

**Status:** Proposed. 2026-05-25.
**Why:** The diarization-banner work (`design-diarization-banners.md`,
commit `49d99d1`) makes silent diarization failures *visible* but
doesn't *recover* them. On same-gender / same-age-tier visits AAI still
merges voices into single clusters — the clinician sees the warning,
but the note has already been generated against a mis-attributed
transcript. The fix has to come **post-STT, at the LLM layer**, where
register cues (adult clinical vocabulary vs. child first-person
answers) can re-split a merged cluster.

**Goal:** When a diarization banner fires, propose a structured
re-attribution. The clinician sees a one-click "Apply split" button.
Note quality recovers without manual chip-tagging or re-recording.

## When the sub-stage runs

Recovery runs only when the existing hints layer fires — same triggers,
no new ML to decide "should we look at this?" Specifically:

- `lowSpeakerCount` fires (hint-gap or patients-floor) → look at
  every substantive speaker (≥3 utts) as a split candidate.
- `collapseSuspected` is non-empty → look at exactly the flagged
  speakers (`low_conf`, `omitted`, `other_role_substantive`).

For each candidate, the recovery LLM is asked one question per
candidate: *does this cluster contain one voice or two?* Each call
sees only that candidate's utterances plus a tight window of
surrounding context — keeps the prompt focused and the cost bounded.

Crucially, **recovery doesn't run on the clean visits.** If banners
correctly stay quiet, recovery never executes — and so cannot
over-fire on them. The over-fire concern collapses to: *given that a
banner fired, does recovery propose a wrong split on a cluster that's
actually one voice?* The eval below probes exactly that.

## The recovery prompt

Output JSON, one of two shapes:

```json
{"keepAsIs": true, "reason": "consistent register and register"}
```
or
```json
{
  "splits": [
    {"role": "parent", "indices": [0,2,5,7,...], "confidence": 0.85},
    {"role": "patient", "indices": [1,3,4,6,...], "confidence": 0.85}
  ]
}
```

Prompt instructions, in order:

1. **Default is `keepAsIs`.** Only split when the register evidence is
   strong (clinical vocabulary on some utterances + first-person
   symptom answers / one-word kid responses on others; or two
   distinctly adult speakers asking different kinds of questions).
2. **Cite the cues.** The `reason` / per-split rationale field forces
   the model to ground the decision in observable text patterns,
   reducing fabricated splits.
3. **Confidence floor.** Split confidence < 0.8 → treat as
   `keepAsIs`. Better to miss a split than apply a wrong one.
4. **Max 2 sub-speakers per cluster.** No triple splits — the model
   is being asked to find evidence of *more than one*, not to
   over-partition a noisy stream.

## Applying the split

**User-confirmed, not auto-applied.** The banner becomes interactive:

> *Speaker B may contain 2 voices. **Suggested split: B → B1 (parent,
> 18 utts), B2 (patient, 7 utts).** Apply / Dismiss.*

Applying:
- Rewrites those utterances' `speakerId` (B → B1 / B2) in the stored
  `transcriptJson`.
- Seeds `speakerRoles` from the split's role hints (B1 → parent,
  B2 → patient).
- Triggers note regeneration with the new transcript.

The "Apply" path is just a chip-edit + regenerate — both already exist
in the codebase. The new work is the LLM call + the JSON parsing +
the wiring from suggestion → applied state.

## Files to touch

| File | Change |
|---|---|
| `apps/web-mvp/src/lib/diarization-hints.ts` | Add `RecoverySuggestion` types. |
| `apps/web-mvp/src/lib/pipeline-browser.ts` | New `recoverMergedSpeakers(transcript, hints, settings)` → `RecoverySuggestion[]`. Called after `computeDiarizationHints` when banners would fire. |
| `apps/web-mvp/src/lib/db.ts` | Persist suggestions on `RecordingMeta.diarizationHints.recoverySuggestions`. |
| `apps/web-mvp/src/screens/Review.tsx` | Banner gains "Apply split" button; on click, rewrites speakerIds + speakerRoles + regenerates note. |

No prompt changes to existing stages. No pipeline order changes. The
recovery sub-stage is gated on the banner state, so it adds latency
*only* on the visits where AAI already failed — clean visits are
unaffected.

## Validation plan

**Recall (must catch real merges):**
- `behavioral-anxiety` → recovery on speaker B (the merged mom+child
  cluster) should propose a split into ~2 sub-speakers with adult /
  patient roles. Pass: split proposed with confidence ≥ 0.8.
- `stress-sibling-same-gender-girls` → recovery on speaker D (the
  "other"-role mash) should either split it or correctly identify
  one of the participants as a patient. Pass: meaningful re-attribution.

**Precision / over-fire (per the user's explicit ask):**

The honest precision test is: *if a banner spuriously fired on a clean
visit, would recovery wrongly split a single-voice cluster?* To probe
this we force-invoke recovery on the 3 clean fixtures' substantive
speakers (A and B in each, regardless of banner state) and the 2
additional variants below. Pass: 100% return `keepAsIs` (zero false
splits).

Two additional clean variants for the precision sample, generated by
re-voicing existing scripts:

- `clean-wcv-femaledoc-malekid` — wcv-multi-concern script with
  female-1 doctor + male-1 dad + child-boy patient (mirrored gender
  to widen the test).
- `clean-adhd-allmale` — adhd-med-check script with male-1 doctor +
  male-2 dad + male-2 teen, same male-voice family. Confirms recovery
  doesn't hallucinate a split just because voices are similar in
  acoustic features it can't actually see (it only sees text).

**Pass criteria for shipping:**
- 100% recall on the 2 known-failing fixtures.
- 100% `keepAsIs` (zero wrong splits) on all 3 clean fixtures + 2
  variants = 5 clean precision tests.
- Manual smoke: regenerate one banner-firing case after applying the
  split; confirm the resulting note attributes the merged content
  correctly (e.g., behavioral-anxiety mom's history-taking lines no
  longer appear in the child's voice).

The eval lives at `eval-fixtures/diarization-validation/eval_recovery.py`
and re-runs in ~3 min for ~$0.50 in API calls.

## Failure modes / safeguards

- **Confabulated splits.** Mitigation: confidence floor 0.8, max 2
  sub-speakers, user must click Apply.
- **Recovery mis-routes within a real split.** Mitigation: split is
  reversible (clinician can undo via existing speaker chips); the
  proposal is presented as "suggested," not final.
- **Recovery cost / latency on every banner-firing visit.** Worst
  case = N candidates × one LLM call each. Bounded at ~4 calls per
  visit (4 candidates max in pediatric scope). Acceptable on the
  cases where it actually adds value; clean visits unaffected.
- **Provider variability.** Cleanest to pin to the same provider the
  user picked for note generation. Tested first on Gemini (default);
  Anthropic + OpenAI paths verified later by smoke test.

## Rollback

The recovery sub-stage is purely additive and gated behind banner
state. Three rollback options:
- Hide the "Apply split" button (UI-only revert).
- Skip the recovery LLM call (set suggestions to `[]`).
- Full revert of this commit; the diarization banner alone still ships.

No backward-compat impact — `recoverySuggestions` is optional on
`RecordingMeta`.

## Out of scope

- Per-visit speaker pre-config (the other Tier 2 mitigation). Lower
  value than recovery for the actual failure modes — most failures
  are voices AAI *can't* separate regardless of hint.
- Personalization-driven feedback (v2 — captured in the broader
  personalization design).
- Multi-vendor STT fallback / pre-processing audio. Out of scope per
  the original Tier 2 brainstorm.
