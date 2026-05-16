#!/usr/bin/env python3
"""
Local fixture eval driver. NOT committed (parent dir is gitignored).

Builds a brtlb-equivalent prompt for each fixture transcript, sends to Gemini,
saves the resulting note to <fixture_dir>/note.<run_label>.md.

Usage:
    GEMINI_API_KEY=... python3 run_eval.py --label v3-compressed
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent
REPO_ROOT = FIXTURES_DIR.parent
TEMPLATES_DIR = REPO_ROOT / "packages/prompts/src/templates"

# Map fixture slug -> visit-type template id. PHI dirs are gitignored; the
# `synthetic-*` dirs are safe-to-commit and exercise the same prompts.
FIXTURE_TEMPLATES = {
    "2026-05-04-wcv-multi-concerns": "well-child",
    "2026-05-04-asthma-cough-flare": "sick-visit",
    "2026-05-04-wcv-cough-allergies": "well-child",
    "synthetic-2026-05-16-wcv-multi-concern": "well-child",
    "synthetic-2026-05-16-adhd-med-check": "adhd-med-check",
    "synthetic-2026-05-16-behavioral-anxiety": "behavioral-health",
}

ADAPTIVE_LENGTH_RULE = """NOTE LENGTH:
Match the note length to the visit's complexity, not a fixed template. A focused 5-minute URI visit gets a brief note; a 60-minute mental-health follow-up or 90-minute autism evaluation gets a longer, richer note that captures the breadth of what was discussed. Do not pad short visits and do not truncate long ones. Length is a function of clinical content density, not template defaults."""

# === v3 COMPRESSED DISCIPLINE RULES (previous baseline) ===
DISCIPLINE_RULES_V3 = """DOCUMENTATION DISCIPLINE:
- Document only what was discussed or observed. Prefer omission over fabrication.
- If a topic, system, or section was not addressed, leave it out. Do not pad sections with blanket negatives ("all other systems negative," "remainder of exam unremarkable") or import content that's "common" for this visit type but absent from the transcript.
- Exam: include only systems actually examined. A clinician's generic positive ("sounds good") may be rendered in standard exam language ("lungs clear to auscultation"). Do not add specific rule-out language ("no wheezing, rales, or rhonchi") unless the clinician named those findings. Never describe an exam that did not happen.
- ROS: pertinent positives and negatives only. Use "denies/reports/endorses" only when the transcript shows an explicit question-and-answer. For clinician observations without a question, use observation language ("no work of breathing observed"). Do not invent denials from silence.
- Apply staging adjectives (intermittent, mild, well-controlled) when the clinician uses them or when the transcript clearly supports the classification by use pattern.
- Preserve conditional plans as conditional. "If X works, then Y" is not the same as "Y will be done."
- When the clinician explicitly disagrees with a prior diagnosis, test, or family assumption, capture both the prior framing and the clinician's reasoning."""

# === v4 ROCI-PARITY (counseling specificity + authority-citation guardrail) ===
# Mirrors the current compose.ts FABRICATION_DISCIPLINE_RULES (2026-05-16).
DISCIPLINE_RULES_V4 = DISCIPLINE_RULES_V3 + """
- Counseling specificity (Plan / Anticipatory Guidance only — does NOT modify the Exam rule above): when the clinician's specific teaching content or rationale appears in the transcript, document it rather than a generic confirmation. "Reviewed back-sleep, firm surface, no blankets" is stronger than "safe-sleep counseling provided." Use generic phrasing only when the transcript truly lacks specifics. Never invent counseling content. Exam findings continue to follow the rule above — do not add specific abnormality rule-outs ("no wheezing") unless the clinician named them.
- Do not cite guidelines, organizations, or authorities the clinician did not name. "Per AAFP guidelines," "AAP recommends," "per CDC," "based on Bright Futures," and similar attributions must appear in the transcript before they appear in the note. Plain clinical rationale ("watchful waiting given age, no fever, no perforation") is fine; rationale dressed up as a citation is not."""

# Default to the current production rules. Override via --discipline v3
# to compare against the previous baseline before the Roci-parity change.
DISCIPLINE_RULES_BY_LABEL = {"v3": DISCIPLINE_RULES_V3, "v4": DISCIPLINE_RULES_V4}


def load_template(template_id: str) -> dict:
    p = TEMPLATES_DIR / f"{template_id}.json"
    return json.loads(p.read_text())


def build_prompt(template: dict, transcript_text: str, discipline_rules: str) -> str:
    """Single-user-message prompt — matches current production composeNotePrompt."""
    return "\n\n".join([
        template["promptBody"],
        ADAPTIVE_LENGTH_RULE,
        discipline_rules,
        "Recording mode: dictation",
        "Transcript:",
        transcript_text.strip(),
    ])


def build_split_prompt(
    template: dict, transcript_text: str, discipline_rules: str
) -> tuple[str, str]:
    """System + user split — what Roci does. Returns (system, user).

    Instructions (template body, length rule, discipline rules) go in the
    system slot; the transcript and mode label stay in the user slot.
    """
    system = "\n\n".join(
        [template["promptBody"], ADAPTIVE_LENGTH_RULE, discipline_rules]
    )
    user = "\n\n".join(
        ["Recording mode: dictation", "Transcript:", transcript_text.strip()]
    )
    return system, user


def call_gemini(
    prompt: str,
    model: str = "gemini-2.5-pro",
    *,
    system_instruction: str | None = None,
) -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8192},
    }
    if system_instruction is not None:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini API error {e.code}: {body_text}") from e

    candidates = data.get("candidates", [])
    if not candidates:
        return f"[NO CANDIDATES] {json.dumps(data)[:500]}"
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="v4-roci-parity",
                        help="Run label written into output filename")
    parser.add_argument("--model", default="gemini-2.5-pro")
    parser.add_argument("--fixture", default=None,
                        help="Run only this fixture slug (default: all)")
    parser.add_argument("--discipline", default="v4", choices=["v3", "v4"],
                        help="Discipline rules version (v4 = current; v3 = previous baseline)")
    parser.add_argument(
        "--system-split",
        action="store_true",
        help="Send instructions in Gemini's systemInstruction slot instead of a single user message. Experimental — Roci does this; brtlb's production currently does not.",
    )
    args = parser.parse_args()

    discipline_rules = DISCIPLINE_RULES_BY_LABEL[args.discipline]
    fixtures = (
        [args.fixture] if args.fixture else list(FIXTURE_TEMPLATES.keys())
    )
    for slug in fixtures:
        fdir = FIXTURES_DIR / slug
        transcript = (fdir / "transcript.txt").read_text()
        template = load_template(FIXTURE_TEMPLATES[slug])
        out_path = fdir / f"note.{args.label}.md"
        msg_mode = "system+user" if args.system_split else "single-user"
        print(
            f"[{slug}] template={template['id']} model={args.model} "
            f"discipline={args.discipline} msg={msg_mode}",
            flush=True,
        )
        try:
            if args.system_split:
                system, user = build_split_prompt(template, transcript, discipline_rules)
                note = call_gemini(user, model=args.model, system_instruction=system)
            else:
                prompt = build_prompt(template, transcript, discipline_rules)
                note = call_gemini(prompt, model=args.model)
        except Exception as e:
            print(f"  FAILED: {e}", flush=True)
            continue
        out_path.write_text(note)
        print(f"  wrote {out_path.name} ({len(note)} chars)", flush=True)


if __name__ == "__main__":
    main()
