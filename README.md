# brtlb

A pediatric-focused, BYO-keys AI scribe that runs entirely in your browser.

**Live at:** https://brtlb.vercel.app

- **Diarization-first** ambient documentation with multi-patient splitting
- **BYO keys** — AssemblyAI for transcription, Gemini / OpenAI / Azure for note generation
- **No backend** — PHI never leaves your device. brtlb itself has no server, database, or analytics
- **Pediatric-tuned** — 9 visit-type templates including behavioral health and developmental evaluations
- **Long-visit ready** — chunk-save resilience, 90-min transcription budget, chapter markers for ≥30 min visits
- **PWA** — installable on iOS, Android, desktop. Same code path everywhere

## Quick start (users)

1. Open https://brtlb.vercel.app
2. Run the **onboarding wizard** when prompted — it walks you through getting an AssemblyAI key, a Google Gemini key, and verifies both live before you record. ~5 minutes.
3. Tap **Record visit**.

For the legal/BAA path, see `docs/BAAs.md`. For the slower manual key setup, see `docs/SETUP.md`. For the feature tour, see `docs/USING_BRTLB.md`.

## Repo layout

| Path | Purpose |
|---|---|
| `apps/web-mvp` | The product. React 19 + Vite 6 + Tailwind v3 PWA. |
| `apps/electron` | Desktop shell (paused) |
| `apps/mobile` | Capacitor config (paused) |
| `packages/pipeline` | LLM adapters, AssemblyAI client, prompt composer |
| `packages/db` | Schema interface + SQLite impl (used by future native shells) |
| `packages/ui` | Shared React components (Lockup, Button, marks) |
| `packages/prompts` | Versioned visit-type templates and patterns |
| `docs/SETUP.md` | Manual key setup walkthrough |
| `docs/BAAs.md` | HIPAA/BAA decision tree |
| `docs/USING_BRTLB.md` | Feature tour |
| `CHECKPOINT.md` | Development log — read first if picking up work |

## Local dev

```bash
nvm use                              # picks up .nvmrc
corepack enable                      # pnpm
pnpm install
pnpm --filter @brtlb/web-mvp dev     # http://localhost:5180
```

Run all checks:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

The app deploys automatically to brtlb.vercel.app on every push to `main`.

## Architecture in one paragraph

brtlb is a static SPA. Audio captured by `MediaRecorder` is persisted in chunks to IndexedDB (`audio_chunks`) so a tab crash mid-visit doesn't lose data. On stop, the audio uploads to AssemblyAI directly from the browser, the transcript polls back, then the LLM generates a SOAP-style note. Notes, transcripts, settings, and a 200-entry audit log all live in IndexedDB + localStorage. Vercel hosts the app code only — never sees PHI. Each device + browser context is its own data island; no cross-device sync.

License: AGPL-3.0.
