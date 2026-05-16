#!/usr/bin/env python3
"""End-to-end sibling-visit pipeline eval.

For multi-patient fixtures (e.g. synthetic-2026-05-16-sibling-sick-visit):

1. Loads <fixture>/transcript.txt — speaker-labeled lines.
2. Runs brtlb's IDENTIFY_PROMPT (verbatim copy from pipeline-browser.ts).
3. Runs brtlb's SPLIT_PROMPT (verbatim copy from pipeline-browser.ts).
4. Generates a per-patient sick-visit note using compose.ts's v4-scoped
   discipline rules and the sick-visit template.

Outputs notes to <fixture>/notes-<label>/<patient-slug>.md so old runs are
preserved alongside new ones.

Usage:
    GEMINI_API_KEY=... python3 run_sibling_eval.py \\
        --fixture synthetic-2026-05-16-sibling-sick-visit \\
        --label v4-scoped

The IDENTIFY_PROMPT/SPLIT_PROMPT strings here are copy-pasted from
apps/web-mvp/src/lib/pipeline-browser.ts so the eval uses the same prompts
production does. If the production prompts change, update this file too.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(FIXTURES_DIR))
from run_eval import (
    DISCIPLINE_RULES_V4,
    ADAPTIVE_LENGTH_RULE,
    load_template,
    call_gemini,
)


# These are copy-paste from apps/web-mvp/src/lib/pipeline-browser.ts so the
# synthetic run uses the same prompts production does.
IDENTIFY_PROMPT = """You are a medical transcription assistant. Identify the patient(s) being clinically seen in this pediatric visit recording.

A "patient" is a child for whom the physician takes history, examines, counsels about, or plans care during this visit. Sibling visits are common and expected — when multiple children are clinically addressed in one recording, list each one.

OUTPUT — JSON ONLY, no prose, no code fences:
{
  "patients": [
    {"name": "Tommy", "confidence": 0.9, "note": "5yo well visit, vaccines given"},
    {"name": "Sara", "confidence": 0.85, "note": "3yo well visit, in OT/speech"},
    {"name": "Annie", "confidence": 0.95, "note": "2-month well visit"}
  ]
}

PATIENT LABEL:
- Use the child's first name when stated in the transcript.
- If a name cannot be determined, use ordinal fallback ("Patient 1", "Patient 2") in the order they appear.
- NEVER use parent or sibling names that aren't being clinically addressed as patient labels.

INCLUDE A CHILD WHEN:
- The physician takes history about them (interval history, symptoms, development).
- The physician examines them (height, weight, looks at skin, checks ears, etc.).
- The physician counsels about their specific care (behavior, feeding, therapy, plan).
- They are receiving an intervention (vaccines, medication, therapy referral).

DO NOT INCLUDE:
- Children mentioned in passing but not addressed clinically (e.g., "my older son is at school today").
- Parents, caregivers, or non-patient family members.
- Children who are present in the room but only as bystanders (the physician interacts with them socially but does not address their care).

CONFIDENCE:
- 0.9+ when clearly addressed with history + exam OR clear plan.
- 0.6–0.8 when partial (e.g., history only, or brief check-in).
- Below 0.6 should usually be omitted.

NOTE FIELD: One short phrase summarizing what was addressed. Helps downstream review.

Output JSON ONLY — no markdown fences, no explanation."""

SPLIT_PROMPT = """You are a medical transcription assistant. The patients being clinically seen in this visit have already been identified. Your job is to assign each transcript utterance to the patient it primarily concerns.

Visit types: sick, well_child, follow_up, phone, other.

OUTPUT — JSON ONLY, no prose, no code fences:
{
  "patient_segments": [
    {
      "patient": "Tommy",
      "visit_type": "well_child",
      "includes_preventive_care": true,
      "acute_concerns": ["left ear pain"],
      "relevant_utterances": [0, 1, 3, 5, 7],
      "chief_complaint": "well-child visit with left ear pain"
    }
  ]
}

ASSIGNMENT RULES:
- Return one segment per patient on the provided roster. Order segments to match the roster order.
- Assign each utterance to the ONE patient it primarily informs:
  - History, exam findings, counseling, or plan addressed to or about a specific child → that child.
  - Behavioral or family-dynamics counseling primarily about one child (even when partly addressed to a parent or sibling) → the child being counseled-about.
  - Shared clinical advice that applies across the children (return precautions, contagion guidance, household sick measures, when-to-call thresholds, school/daycare exclusion rules) → assign to the youngest patient (their visit will carry it). When in doubt between assigning shared clinical content and omitting it, prefer assignment — these instructions need a home in someone's note.
  - General family chatter, social moments, or logistics with no clinical signal for any child (small talk, scheduling, off-topic asides) → omit (do not assign).
- Best-effort. When an utterance could plausibly inform two children, pick the one it most directly applies to. Do not duplicate utterance indices across patients.
- Every patient on the roster should normally have a populated segment. Only return an empty segment for a patient if the transcript truly has zero clinical content for them.

VISIT TYPE RULES:
- If a child is here for a routine well visit AND also has an acute complaint, set visit_type="well_child", includes_preventive_care=true, list acute issues in acute_concerns.
- chief_complaint summarizes the combined encounter for that patient (e.g., "well-child visit with left ear pain"), not just one half.

PATIENT LABEL: Use the exact name from the provided roster.

Output JSON ONLY — no markdown fences, no explanation."""


def extract_json(s: str) -> str:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s)
    return m.group(1).strip() if m else s.strip()


def load_utterances(path: Path) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for line in path.read_text().splitlines():
        m = re.match(r"\[Speaker ([A-Z])\] (.*)", line)
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fixture",
        default="synthetic-2026-05-16-sibling-sick-visit",
        help="Fixture directory slug under eval-fixtures/",
    )
    parser.add_argument(
        "--label",
        default="v4-scoped",
        help="Run label — used to name the per-run output directory",
    )
    parser.add_argument("--model", default="gemini-2.5-pro")
    args = parser.parse_args()

    fixture_dir = FIXTURES_DIR / args.fixture
    transcript_path = fixture_dir / "transcript.txt"
    if not transcript_path.exists():
        print(f"transcript not found: {transcript_path}", file=sys.stderr)
        sys.exit(1)

    utterances = load_utterances(transcript_path)
    print(f"Loaded {len(utterances)} utterances from {args.fixture}", file=sys.stderr)

    numbered = "\n".join(f"[{i}] Speaker {sid}: {txt}" for i, (sid, txt) in enumerate(utterances))

    # Stage 1: identify patients
    identify_prompt = f"{IDENTIFY_PROMPT}\n\nTRANSCRIPT (utterances numbered for reference):\n{numbered}"
    print("\n=== Stage 1: Identify patients ===", file=sys.stderr)
    raw = call_gemini(identify_prompt, model=args.model)
    parsed = json.loads(extract_json(raw))
    patients = [
        {"name": p["name"].strip(), "confidence": p.get("confidence", 0), "note": p.get("note", "").strip()}
        for p in parsed.get("patients", [])
        if p.get("name") and p.get("confidence", 0) >= 0.6
    ]
    print(f"Identified {len(patients)} patient(s):", file=sys.stderr)
    for p in patients:
        print(f"  - {p['name']} ({p['confidence']:.2f}) — {p['note']}", file=sys.stderr)

    if len(patients) <= 1:
        print("Splitter would short-circuit — only one patient identified. Stopping.", file=sys.stderr)
        return

    # Stage 2: split utterances
    roster = "\n".join(f"- {p['name']}{f' ({p['note']})' if p['note'] else ''}" for p in patients)
    split_prompt = (
        f"{SPLIT_PROMPT}\n\nPATIENT ROSTER (assign utterances to these — one segment per patient, in this order):\n"
        f"{roster}\n\nTRANSCRIPT (utterances numbered for reference):\n{numbered}"
    )
    print("\n=== Stage 2: Split by patient ===", file=sys.stderr)
    raw = call_gemini(split_prompt, model=args.model)
    split = json.loads(extract_json(raw))
    segments = split.get("patient_segments", [])
    for s in segments:
        n = len(s.get("relevant_utterances", []))
        print(
            f"  - {s.get('patient')}: visit_type={s.get('visit_type')} "
            f"acute={s.get('acute_concerns')} utterances={n}",
            file=sys.stderr,
        )

    # Stage 3: per-patient note generation
    print("\n=== Stage 3: Per-patient notes ===", file=sys.stderr)
    template = load_template("sick-visit")
    output_dir = fixture_dir / f"notes-{args.label}"
    output_dir.mkdir(exist_ok=True)
    for s in segments:
        patient = s.get("patient", "unknown")
        indices = [i for i in s.get("relevant_utterances", []) if 0 <= i < len(utterances)]
        if not indices:
            print(f"  - {patient}: no utterances; skipping", file=sys.stderr)
            continue
        segment_lines = [f"[Speaker {utterances[i][0]}] {utterances[i][1]}" for i in indices]
        chief_complaint_hint = s.get("chief_complaint", "")
        prompt = "\n\n".join(
            [
                template["promptBody"],
                ADAPTIVE_LENGTH_RULE,
                DISCIPLINE_RULES_V4,
                f"Recording mode: ambient (sibling-visit split, patient: {patient})",
                f"Chief complaint context (from splitter): {chief_complaint_hint}",
                "Transcript (utterances assigned to this patient only):",
                "\n".join(segment_lines),
            ]
        )
        print(f"  Generating note for {patient} ({len(indices)} utterances)...", file=sys.stderr)
        note = call_gemini(prompt, model=args.model)
        slug = re.sub(r"[^a-z0-9]+", "-", patient.lower()).strip("-") or "unknown"
        out = output_dir / f"{slug}.md"
        out.write_text(note)
        print(f"  Wrote {out} ({len(note)} chars)", file=sys.stderr)


if __name__ == "__main__":
    main()
