#!/usr/bin/env python3
"""
Multi-provider model bake-off for brtlb's note-generation prompt.

Same prompt (system+user split, current production discipline rules)
sent to a matrix of models from Gemini, OpenAI, and Anthropic. Writes
one note per (fixture, model, run) under eval-fixtures/synthetic-*/
named note.bakeoff.<model-slug>.run<n>.md. Output files match the
note.ab*.md gitignore pattern intentionally → never committed.

Run:
    GEMINI_API_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \\
        python3 run_model_bakeoff.py --runs 2
"""
import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# Reuse the existing prompt-building machinery so the bake-off tests
# the exact same prompt as production.
sys.path.insert(0, str(Path(__file__).parent))
from run_eval import (  # noqa: E402
    FIXTURE_TEMPLATES,
    FIXTURES_DIR,
    load_template,
    build_split_prompt,
    DISCIPLINE_RULES_BY_LABEL,
)

# Single-patient synthetic fixtures only — the sibling fixture needs the
# multi-patient splitter, which is out of scope for a single-prompt
# bake-off.
BAKEOFF_FIXTURES = [
    "synthetic-2026-05-16-wcv-multi-concern",
    "synthetic-2026-05-16-adhd-med-check",
    "synthetic-2026-05-16-behavioral-anxiety",
]

# Models to test. "slug" is used in output filenames; "model" is the
# wire-level model ID for the provider.
MODELS = [
    # Gemini — newest family
    {"family": "gemini", "slug": "gemini-3.1-pro", "model": "gemini-3.1-pro-preview"},
    {"family": "gemini", "slug": "gemini-3.5-flash", "model": "gemini-3.5-flash"},
    # Gemini — prior family
    {"family": "gemini", "slug": "gemini-2.5-pro", "model": "gemini-2.5-pro"},
    {"family": "gemini", "slug": "gemini-3-flash", "model": "gemini-3-flash-preview"},
    # OpenAI
    {"family": "openai", "slug": "gpt-5", "model": "gpt-5"},
    {"family": "openai", "slug": "gpt-5-mini", "model": "gpt-5-mini"},
    # Anthropic
    {"family": "anthropic", "slug": "claude-opus-4-7", "model": "claude-opus-4-7"},
    {"family": "anthropic", "slug": "claude-sonnet-4-6", "model": "claude-sonnet-4-6"},
]

MAX_TOKENS = 16384
TIMEOUT_SEC = 600


def call_gemini(system: str, user: str, model: str, api_key: str) -> str:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    )
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": MAX_TOKENS},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read())
    parts = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )
    return "".join(p.get("text", "") for p in parts).strip()


def call_openai(system: str, user: str, model: str, api_key: str) -> str:
    url = "https://api.openai.com/v1/chat/completions"
    body = {
        "model": model,
        # GPT-5 family rejects temperature, max_tokens, and several other
        # legacy params — use the responses-API-style fields. Older
        # gpt-4o still wants max_tokens, but we're not testing it here.
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if not model.startswith("gpt-5"):
        body["temperature"] = 0.2
        body["max_tokens"] = MAX_TOKENS
    else:
        body["max_completion_tokens"] = MAX_TOKENS
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read())
    return (data["choices"][0]["message"]["content"] or "").strip()


def call_anthropic(system: str, user: str, model: str, api_key: str) -> str:
    url = "https://api.anthropic.com/v1/messages"
    body = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    # Opus 4.7 and later "reasoning" models reject the temperature
    # parameter — they expose extended thinking instead. Sonnet 4.6 and
    # earlier still accept it.
    if not model.startswith("claude-opus-4-7"):
        body["temperature"] = 0.2
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read())
    parts = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts).strip()


PROVIDER_DISPATCH = {
    "gemini": (call_gemini, "GEMINI_API_KEY"),
    "openai": (call_openai, "OPENAI_API_KEY"),
    "anthropic": (call_anthropic, "ANTHROPIC_API_KEY"),
}


def generate_one(
    *,
    fixture: str,
    model: dict,
    run_idx: int,
    discipline: str,
) -> dict:
    """Generate one note. Returns a result dict."""
    family = model["family"]
    fn, key_env = PROVIDER_DISPATCH[family]
    api_key = os.environ.get(key_env)
    if not api_key:
        return {
            "fixture": fixture,
            "slug": model["slug"],
            "run": run_idx,
            "ok": False,
            "error": f"{key_env} not set",
        }

    fdir = FIXTURES_DIR / fixture
    transcript = (fdir / "transcript.txt").read_text()
    template = load_template(FIXTURE_TEMPLATES[fixture])
    system, user = build_split_prompt(template, transcript, DISCIPLINE_RULES_BY_LABEL[discipline])

    out_path = fdir / f"note.bakeoff.{model['slug']}.run{run_idx}.md"
    started = time.time()
    try:
        note = fn(system, user, model["model"], api_key)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        return {
            "fixture": fixture,
            "slug": model["slug"],
            "run": run_idx,
            "ok": False,
            "error": f"HTTP {e.code}: {body_text[:300]}",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "fixture": fixture,
            "slug": model["slug"],
            "run": run_idx,
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
        }
    elapsed = time.time() - started

    out_path.write_text(note)
    return {
        "fixture": fixture,
        "slug": model["slug"],
        "run": run_idx,
        "ok": True,
        "chars": len(note),
        "elapsed_sec": round(elapsed, 1),
        "path": str(out_path.relative_to(FIXTURES_DIR.parent)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--discipline", default="v4")
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Parallel concurrent generations (be polite to APIs).",
    )
    parser.add_argument(
        "--fixture",
        default=None,
        help="Only run this single fixture slug (default: all).",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="Only run this single model slug (default: all).",
    )
    args = parser.parse_args()

    fixtures = [args.fixture] if args.fixture else BAKEOFF_FIXTURES
    models = [m for m in MODELS if not args.slug or m["slug"] == args.slug]

    jobs = []
    for fixture in fixtures:
        for model in models:
            for run_idx in range(1, args.runs + 1):
                jobs.append((fixture, model, run_idx))

    print(
        f"Running {len(jobs)} generations "
        f"({len(fixtures)} fixtures × {len(models)} models × {args.runs} runs) "
        f"with {args.workers} workers",
        flush=True,
    )

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(
                generate_one,
                fixture=fixture,
                model=model,
                run_idx=run_idx,
                discipline=args.discipline,
            )
            for (fixture, model, run_idx) in jobs
        ]
        for fut in concurrent.futures.as_completed(futures):
            r = fut.result()
            results.append(r)
            if r["ok"]:
                print(
                    f"  OK  {r['fixture'][:40]:40s} {r['slug']:20s} "
                    f"run{r['run']} {r['chars']:>5d} chars  {r['elapsed_sec']:>5.1f}s",
                    flush=True,
                )
            else:
                print(
                    f"  ERR {r['fixture'][:40]:40s} {r['slug']:20s} "
                    f"run{r['run']}  {r['error']}",
                    flush=True,
                )

    summary_path = FIXTURES_DIR / "bakeoff-runlog.json"
    summary_path.write_text(json.dumps(results, indent=2))
    print(f"\nWrote run log to {summary_path.relative_to(FIXTURES_DIR.parent)}")
    print(
        f"  OK:  {sum(1 for r in results if r['ok'])}/{len(results)}\n"
        f"  ERR: {sum(1 for r in results if not r['ok'])}/{len(results)}"
    )


if __name__ == "__main__":
    main()
