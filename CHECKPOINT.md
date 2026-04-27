# brtlb Development Checkpoint

> Where we are in the build, what was paused, and what to resume.

**Last updated:** 2026-04-27

## Current focus

**Phase 4-MVP (web-only).** A rapid-iteration browser app at `apps/web-mvp/`. BYO keys (AssemblyAI + Anthropic or OpenAI), records via MediaRecorder, persists in IndexedDB, runs the existing `@brtlb/pipeline` directly in the browser. Ship-in-days, not weeks. Plan: `docs/superpowers/plans/2026-04-27-web-mvp.md`.

This is **not** a replacement for the cross-platform plan — it's a parallel track that exists so a real pediatrician can use brtlb during a real visit before Phases 4–10 finish.

## What's complete on `main`

| Phase      | What landed                                                                        | Tests |
| ---------- | ---------------------------------------------------------------------------------- | ----- |
| Phase 1    | Monorepo + four packages + three shells + CI                                       | 16    |
| Brand v0.1 | DotsMark/Wordmark/Lockup, color tokens, Inter, favicon                             | —     |
| Phase 2    | LLM adapters (Anthropic, OpenAI-compat, Vertex) + AssemblyAI client + orchestrator | 34    |
| Phase 3    | `Database` adapter + 5 repositories + `DataLayer` (Node, better-sqlite3)           | 45    |

Total: 95 tests passing on `main`. Last commit: `a462b69`.

## What's paused on the long-term cross-platform plan

The original Phase 4–10 sequence (Capacitor + Electron) is **paused** at the end of Phase 3. Pick it back up after the web MVP ships and after we've learned from real-visit usage. Documented at `docs/superpowers/plans/README.md`.

### Long-term plan status

| Phase | Title                                    | Status                          |
| ----- | ---------------------------------------- | ------------------------------- |
| 1     | Foundation                               | Complete                        |
| Brand | v0.1                                     | Complete                        |
| 2     | Pipeline core                            | Complete                        |
| 3     | Data layer                               | Complete                        |
| 3.5   | Encrypted storage (SQLCipher + keychain) | Deferred — needs device testing |
| 4-MVP | **Web MVP (current focus)**              | In progress                     |
| 4     | Recording UX (Capacitor)                 | Paused — resume after MVP       |
| 5     | Review & edit UX (Capacitor)             | Paused                          |
| 6     | Templates & patterns UX                  | Paused                          |
| 7     | Share & export                           | Paused                          |
| 8     | Onboarding & settings (Capacitor)        | Paused                          |
| 9     | Mobile shell finalization                | Paused                          |
| 10    | Desktop shell finalization               | Paused                          |

### Resume cues

When picking the long-term plan back up:

1. Read this checkpoint first.
2. Check `docs/superpowers/plans/README.md` for current statuses (it's the source of truth).
3. Phase 4 (Capacitor recording UX) reuses everything the web MVP builds — the recording component, MediaRecorder integration, IndexedDB-backed list view, and review screens all become source material.
4. Phase 4 (long-term) extends them with: native audio plugin via `@capacitor-community/voice-recorder`, encrypted SQLite via the `Database` interface in `@brtlb/db`, biometric lock, native share sheet.
5. The web MVP's `apps/web-mvp/` lives alongside `apps/web` (the placeholder shell). Decide at Phase 4 time whether to merge them or keep them as separate apps.

## Things learned along the way

- Better-sqlite3 native binding compiles cleanly under Node 25 on Apple Silicon. No pre-built binary; first install takes ~30s.
- Anthropic + OpenAI SDKs both need `dangerouslyAllowBrowser: true` for direct browser use. Vertex requires server-side auth and is out of scope for the web MVP.
- pnpm specifier discipline: tighten every caret to the resolved version after install. The Phase 1 review enforced this; carry it forward.

## Working directory

- Local: `/Users/dochobbs/Downloads/Consult/pedsdpc/brtlb`
- Remote: https://github.com/dochobbs/brtlb (private)
- Live URL when web MVP ships: TBD (depends on `brtlb.ai` registration)
