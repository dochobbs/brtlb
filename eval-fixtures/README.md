# brtlb eval fixtures (local-only, PHI)

> **Do not commit.** This directory is gitignored. Real patient transcripts + brtlb-generated notes live here as regression cases for prompt changes. They never leave this machine.

## Why these exist

When we tweak the prompt rules in `packages/pipeline/src/prompts/compose.ts` (or any of the visit-type templates in `packages/prompts/src/templates/`), we want to confirm that previously-flagged failure modes don't reappear. These fixtures are real visits Dr. Hobbs ran through brtlb where we caught hallucinations or omissions worth not regressing.

## Structure

Each case is its own directory dated by the eval date (not the visit date), named by visit type + dominant clinical content. Inside each directory:

- `transcript.txt` — raw AssemblyAI transcript with speaker labels exactly as it came back to brtlb
- `note.md` — the markdown note brtlb produced (before any manual edits)
- `issues.md` — the QA findings we agreed on, with the calibration notes (what was a real issue, what was a false-positive flag I called that Hobbs overruled)

## How to use these later

When changing prompts:

1. Pick a fixture (or all of them)
2. Re-run `composeNotePrompt` against the transcript + the relevant template
3. Send the resulting prompt to your provider (Gemini, etc.) — same way brtlb does
4. Compare the new note to the issues recorded in `issues.md`
5. If a previously-fixed failure mode reappears, the prompt change regressed something

A simple test harness (not built yet) would automate this. For now: manual.

## Cases

| Date | Slug | Visit type | Key issues |
|---|---|---|---|
| 2026-05-04 | `wcv-multi-concerns` | WCV + ARFID + ADHD + molluscum + post-strep cough | Water-safety fabrication, "denies" verb misuse, exam fabrication (auscultation overruled), missing exercise/sleep/social |
| 2026-05-04 | `asthma-cough-flare` | Asthma exacerbation eval | Viral URI fabrication, "denies" verb misuse, exam descriptor over-expansion |

## Adding a new case

1. Create a new directory `eval-fixtures/YYYY-MM-DD-{visit-type}-{dominant-content}/`
2. Save the transcript as `transcript.txt`
3. Save the brtlb note as `note.md`
4. Write up the QA findings as `issues.md` — include both the things flagged and the things Hobbs disagreed with as false-positives, so future prompt evaluators see the full clinical-judgment context

## When prompts change

Add a corresponding line to `prompt-changes.md` (also local-only) noting:
- Which fixture the change was tested against
- Whether the previously-flagged failure modes still trigger after the change
- Any new failure modes introduced
