# Synthetic sibling sick visit — eval criteria

**Status:** SYNTHETIC fixture. Names (Aria, Theo, Lucy) and clinical details
are fabricated. Safe to commit and share.

**Date:** 2026-05-16
**Visit type:** Three siblings, all sick, single appointment slot.
**Purpose:** Regression test for brtlb's multi-patient splitter pipeline
(`apps/web-mvp/src/lib/pipeline-browser.ts` — `identifyPatientsInTranscript`
+ `splitByPatient`) plus per-patient sick-visit note generation under the
v4-scoped discipline rules.

## The cast

| Patient | Age | Acute presentation |
|---|---|---|
| Aria | school-age (~4-5y, female) | sore throat + low-grade fever (Friday), mild right otalgia, exam suspicious for strep |
| Theo | school-age (~6y, male) | productive cough since Saturday, mild-asthma history flaring |
| Lucy | 18 months (female) | this-morning ear-pulling + rhinorrhea, right AOM on exam, also has overdue Hep A + varicella vaccines (deferred today due to illness) |

## How to run

```bash
GEMINI_API_KEY=... python3 eval-fixtures/run_sibling_eval.py \
    --fixture synthetic-2026-05-16-sibling-sick-visit \
    --label <run-label>
```

Outputs land in `notes-<label>/{aria,theo,lucy}.md`. The baseline from the
first successful 2026-05-16 run lives in `notes-baseline/`.

## Stage 1 (identify) — pass criteria

- Three patients identified, all with confidence ≥ 0.6.
- Names: Aria, Theo, Lucy (exact spelling, in transcript-mention order).
- No false positives — mom is not listed as a patient.

## Stage 2 (split) — pass criteria

- One segment per patient, each with `visit_type: "sick"`.
- Acute concerns:
  - Aria: must include sore throat / fever (ear pain optional; she does
    have right otalgia, so a model that picks it up is correct).
  - Theo: must include cough and asthma flare.
  - Lucy: must include otitis media / ear pulling.
- Each patient's segment has ≥ 8 relevant utterances (some shared
  AG/family-chatter utterances may be dropped — that's fine).
- No utterance index duplicated across patients.

## Stage 3 (per-patient notes) — pass criteria

### Aria
- Chief complaint: "My throat hurts." (verbatim quote from transcript).
- HPI captures: Friday onset, low-grade fever (101.4°F) Friday night,
  resolved with Tylenol and afebrile since, decreased appetite, drinking
  OK, right otalgia.
- Exam captures: tonsillar exudate on the **right**, tender cervical
  lymphadenopathy, right TM erythema without bulge, left TM normal, lungs
  clear.
- Plan: rapid strep test, conditional amoxicillin if positive, supportive
  care if negative. Conditional plan must remain conditional ("if X, then
  Y") — not collapsed to definite.
- No fabrication. No "denies penile" or "denies breathing difficulty" — the
  transcript has no Q&A exchanges that would justify those.

### Theo
- HPI captures: Saturday onset, dry → wet productive yellow sputum, no
  fever, mild-asthma history with last albuterol use "last fall", no
  wheezing at home, "winded going up the stairs" detail.
- Exam captures: coarse breath sounds with rhonchi on the left, no
  wheezing (this is in the transcript verbatim — clinician said
  "rhonchi, no wheezing", so "no wheezing" is legitimate, not the
  asthma-fixture failure mode).
- Plan captures: albuterol 2 puffs via spacer q4h × 3 days then PRN,
  spacer counseling ("the medicine actually gets to your lungs"),
  not at steroid threshold, return precautions.

### Lucy
- HPI captures: this-morning onset, cranky on waking, runny nose, right
  ear pulling, no fever at home, nursed OK but refused oatmeal.
- Exam captures: right TM red, dull, slightly bulging, loss of landmarks;
  left TM normal; throat OK with mild postnasal drip; lungs clear.
- Plan captures: watchful-waiting with **safety-net** amoxicillin
  prescription (hold-and-fill model), ibuprofen 6 mL q6h max 4 doses,
  daycare OK ("ear infections aren't contagious").
- Vaccine plan: Hep A #1 and Varicella #2 deferred today due to acute
  illness; follow up in 3-4 weeks.

### Universal — applies to every patient note

- No water safety / common-WCV-phrase fabrication (this isn't a WCV but the
  failure mode could still leak).
- No "denies" verb where transcript has no Q&A.
- No exam findings invented or expanded beyond what the clinician said.
- Conditional plans preserved as conditional.

## Known soft findings — not strict regressions but watch for

- **Authority overreach.** The baseline run had Lucy's plan citing "Per
  AAFP guidelines for watchful waiting" — the clinician never named a
  guideline. Acceptable but mild. If this gets more aggressive (citing
  specific guideline numbers, dates, or organizations not named in the
  transcript), tighten the prompt.
- **Shared anticipatory guidance.** The transcript includes shared advice
  (hand-washing, don't share cups, day-5-or-6 worsening threshold). The
  splitter prompt says shared AG should attach to the youngest patient
  (Lucy). The baseline run did not roll this content into Lucy's note —
  the splitter dropped it as "general family chatter." Acceptable for now
  (none of the notes is missing anything clinically critical), but the
  rule is being followed loosely.

## Sample run

`notes-baseline/` contains the first successful run (2026-05-16,
gemini-2.5-pro, discipline=v4-scoped). Compare future runs against it.
