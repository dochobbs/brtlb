# brtlb

A pediatric-focused, BYO-keys AI scribe for desktop and mobile.

- **Diarization-first** ambient documentation
- **Bring your own** AssemblyAI key + foundation model (Gemini / Anthropic / OpenAI-compatible)
- **Local-only**, encrypted at rest — PHI never leaves the device
- **Cross-platform** via Capacitor (iOS, Android) + Electron (Mac, Windows, Linux)

Status: **Phase 1 + Brand v0.1 + Phase 2 (pipeline core) complete.** No product features yet.

## Repo layout

| Path                     | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `apps/web`               | React + Vite app — the product                                     |
| `apps/electron`          | Desktop shell                                                      |
| `apps/mobile`            | Capacitor config (native shells generated locally, see its README) |
| `packages/pipeline`      | LLM adapter interface + future AssemblyAI client                   |
| `packages/db`            | Schema strings + future SQLCipher wrapper                          |
| `packages/ui`            | Shared React components                                            |
| `packages/prompts`       | Versioned templates and patterns                                   |
| `docs/superpowers/specs` | Design specs                                                       |
| `docs/superpowers/plans` | Phased implementation plans                                        |
| `docs/user-guides`       | API key setup walkthroughs (filled in Phase 8)                     |

## Quick start

```bash
nvm use                       # picks up .nvmrc
corepack enable               # enables pnpm if needed
pnpm install
pnpm --filter @brtlb/web dev  # http://localhost:5180
```

Run all checks:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

## Plans

See `docs/superpowers/plans/` for the phased roadmap. Phase 1 stands the repo up; Phases 2–10 build the product.

License: TBD.
