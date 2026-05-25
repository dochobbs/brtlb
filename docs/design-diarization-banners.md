# Design — Diarization confidence banners (Tier 1)

**Status:** Proposed. 2026-05-24.
**Why:** Synthetic validation (see `eval-fixtures/diarization-validation/`)
confirmed the AssemblyAI fix works for mixed-gender adult/child trios but
silently fails on same-gender / same-age-tier combinations: 2 of 5 tested
fixtures returned merged speakers, with mom's lines getting attributed to
the child (behavioral-anxiety, 0/6 mom recall). The fix shipped in
`f1e648f` reduces the failure rate but does not eliminate it — and when
it fails, the user has no signal that something went wrong.

**Goal:** Turn silent diarization failures into visible banners on the
Review screen, before the user generates or trusts a note. No new ML.

## The two failure signatures we can detect

1. **Count anomaly.** AssemblyAI returns fewer unique speakers than the
   visit required. Today: silently produces a 2-cluster transcript when
   4 speakers actually talked. Symptom: kids' utterances vanish into the
   doctor or parent label.
2. **Within-count merge.** AssemblyAI returns the expected count but one
   cluster contains utterances from two different people. The identify
   prompt at `pipeline-browser.ts:771` already detects this — it lowers
   confidence to ≤0.5 and drops the entry. Today: dropped entries are
   silently discarded.

## Banner 1 — speaker-count anomaly

**Two OR'd triggers** (eval at `eval-fixtures/diarization-validation/eval_banners.py`
proved a single trigger misses real failures):

1. **Hint-gap.** AssemblyAI returned ≥2 fewer unique speakers than we
   requested via `speakers_expected` (production hardcodes 4 at
   `pipeline-browser.ts:207`). Catches behavioral-anxiety, where AAI
   returned 2 clusters when 3 voices were present — the identify stage
   sees only 2 speakers in the transcript and cleanly assigns provider
   + parent, so no within-count signal exists. The hint-vs-detected gap
   is the only signal available.
2. **Patients-floor.** Identify resolved ≥2 patients but the transcript
   has fewer than `patients + 1` unique speakers. Catches the "we
   confirmed 3 kids in the visit but only got 2 speaker labels" case.

The patients-floor trigger never fires on solo-patient visits (where 2
speakers can be normal). The hint-gap trigger doesn't fire on 3-speaker
visits given production's hint=4 (4-3=1, below threshold) — verified on
wcv, adhd-med-check, behavioral-anxiety negatives. Bumping production
to `speakers_expected: 5` would tighten the trigger further; not in
scope for this change.

**Plumbing:**
- `RunMvpPipelineOutput` already carries `speakerRoles`. Add
  `diarizationHints: { lowSpeakerCount: boolean; collapseSuspected: { speakerId: string }[] }`.
- Persist on `RecordingMeta` so it survives reload.

**UI:** Amber banner above the note, same visual treatment as the
existing coverage banner at `Review.tsx:1113`. Copy:
> *Heads up — AssemblyAI returned 2 speakers but this looked like a
> 3-speaker visit. Some utterances may be attributed to the wrong
> person. Review the transcript (raw json) before generating the note,
> or tag the speaker chips manually.*

Dismissible. Re-shows on regenerate (same pattern as coverage banner).

## Banner 2 — within-count merge suspected

**Three OR'd triggers:**

1. **Low-confidence drop.** Capture the raw identify-stage `speakers`
   array (pre-filter). For each entry filtered out at
   `pipeline-browser.ts:939-945` due to confidence < 0.6, add
   `{speakerId}` to suspects. Only fires when the dropped speaker has
   ≥3 utterances in the transcript (filler-only doesn't count).
2. **Silent omit.** Identify returns no entry at all for a transcript
   speakerId with ≥3 utterances. Means the LLM couldn't even commit a
   role at all — strong collapse signal.
3. **"Other" with substance.** Identify kept a speaker with `role="other"`
   AND that speaker has ≥3 utterances. In a pediatric visit, `"other"`
   is supposed to mean front-desk/MA cameo (1–2 lines max). A
   substantial `"other"` cluster is almost always a collapse fragment
   or unexpected participant who got mis-labeled. **This is the trigger
   that catches stress-same-gender** (girl 2's voice ended up as
   speaker D with role="other", 8 utterances).

**UI:** Same amber banner, separate line:
> *Speaker B may contain more than one voice (the AI couldn't confidently
> assign it a single role). Review and tag manually before generating.*

## Files touched

| File | Change |
|---|---|
| `packages/pipeline/src/types.ts` | Add `DiarizationHints` type; extend `RunMvpPipelineOutput`. |
| `apps/web-mvp/src/lib/pipeline-browser.ts` | `identifyPatientsInTranscript`: return raw + filtered speakers. Pipeline: compute `lowSpeakerCount`. |
| `apps/web-mvp/src/lib/db.ts` | Persist `diarizationHints` on `RecordingMeta`. |
| `apps/web-mvp/src/screens/Review.tsx` | Render two banners above note, dismissible, re-show on regenerate. |

No prompt changes. No pipeline order changes. Pure plumbing + UI.

## Validation plan

The synthetic eval (`eval-fixtures/diarization-validation/`) now has
ground truth for 5 fixtures (3 clean, 2 failing). After implementation:

**Recall test (must catch real failures):**
- behavioral-anxiety → Banner 1 should fire (AAI returned 2 of 3).
- stress-sibling-same-gender-girls → at least one banner should fire
  (4 detected but the 2-girl merge is a within-count case; expect
  Banner 2 to fire with `aria` or `theo_as_girl` flagged).

**Precision test (no false positives on clean cases):**
- sibling-sick-visit, wcv-multi-concern, adhd-med-check → neither
  banner should fire.

**Test harness:** Extend `eval-fixtures/diarization-validation/score.py`
to also run the identify stage on each transcript and assert banner
state matches expected. Add to CI of `pnpm test` if the eval lives
in-repo; otherwise document as a manual gate.

**Pass criteria for shipping:**
- 100% recall on the 2 known-failing fixtures.
- 0 false positives on the 3 known-clean fixtures.
- Manual smoke: regenerate a real visit, verify banner does not appear
  for a normal mom+kid visit.

**Status (2026-05-24):** eval at `eval_banners.py` passes 5/5 with the
revised triggers (banner1 dual-trigger, banner2 triple-trigger). The
original single-trigger design missed both known failures — this is why
the eval gate is non-negotiable for pipeline work.

## Out of scope

- Tier 2 mitigations (per-visit speaker config, LLM merge recovery) —
  separate design docs if/when Tier 1 leaves residual error.
- Inline reassignment UI (Tier 3) — too much engineering for now.
- Changing the AAI request body. The fix landed in `f1e648f`; this
  doc is about catching the cases the fix doesn't cover.

## Rollback

Banner is purely additive UI. Hide via a feature flag or revert the
Review.tsx change; pipeline output is backward-compatible because
`diarizationHints` is optional.
