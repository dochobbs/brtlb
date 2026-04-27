# brtlb Development Checkpoint

> Where we are in the build, what was paused, what to resume, and **everything learned along the way**. Read this first if you're picking up where someone else left off.

**Last updated:** 2026-04-27

---

## TL;DR

- **Long-term Capacitor app:** Phase 1 (foundation) + Brand v0.1 + Phase 2 (pipeline core) + Phase 3 (data layer) merged into `main`. Phases 4–10 paused.
- **Current focus:** `feature/web-mvp` branch — a browser-only AI scribe at `apps/web-mvp`. Working end-to-end with OpenAI + AssemblyAI. Records visits, generates SOAP/well-child/sick/follow-up/ADHD/procedure notes, runs a QA review pass, lets you tweak in plain English, lets you save your own templates, and respects your privacy aggressively.
- **Demo URL:** TBD (Vercel config in `apps/web-mvp/vercel.json` is ready; not yet connected).
- **Tested with:** OpenAI `gpt-4o`. Anthropic blocked by org-CORS for BAA accounts. Gemini AI Studio works for non-BAA testing. Vertex deferred.

---

## What's complete on `main`

| Phase | Title         | What landed                                                                                                                                                                                  | Tests |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1     | Foundation    | pnpm + Turborepo monorepo, four packages with TDD interface stubs, three app shells, ESLint/Prettier/TS strict, GitHub Actions CI                                                            | 16    |
| Brand | v0.1          | DotsMark/Wordmark/Lockup, color tokens (graphite/seafoam/mist), Inter font, favicon, app-icon                                                                                                | —     |
| 2     | Pipeline core | LLM adapters (Anthropic, OpenAI-compat, Vertex, Gemini AI Studio), AssemblyAI client, prompt composer, orchestrator. All HTTP/SDK calls mocked at test boundaries — no real network in tests | 40    |
| 3     | Data layer    | `Database` adapter interface, `better-sqlite3` impl, schema migrations, five repositories (recordings, transcripts+utterances, notes, speaker roles, settings), `DataLayer` aggregator       | 45    |

**Total tests on `main`:** 117. Last main commit: `a462b69`.

**Repo:** https://github.com/dochobbs/brtlb (private).

---

## Current branch: `feature/web-mvp` (18+ commits ahead of main)

A standalone browser app at `apps/web-mvp/` using the existing `@brtlb/pipeline` package directly. BYO keys (AssemblyAI + Anthropic / OpenAI-compat / Gemini AI Studio). Records via MediaRecorder, persists in IndexedDB via `idb`. No server.

### Stack

- React 19 + Vite 6 + TypeScript strict + Tailwind v3
- Zustand for app state and a separate Zustand store for the recorder
- `idb` for IndexedDB
- `react-markdown` + `remark-gfm` for the Formatted view
- `vite-plugin-node-polyfills` + an inline `process` shim in `index.html` for browser-side SDK compatibility

### What works end-to-end

1. **Pick provider + paste keys** in Settings → Test connection → Save.
2. **Tap "Record visit"** on Home (default = ambient). Mic permission prompt fires once. Recording starts immediately. There's also "or dictate instead" for dictation mode.
3. **Live waveform + timer + pause/resume.** Audio is captured at 32 kbps opus.
4. **Stop** → audio saved to IndexedDB → Review screen.
5. **Review auto-runs the pipeline:** AssemblyAI upload → transcribe with diarization + pediatric word boost → LLM generates a SOAP note.
6. **Speaker rename** via tap-cycling chips (Speaker A → Parent → Patient → Provider → Sibling → Other → unset). Transcript and prompt re-render with the role labels.
7. **Pick a template** from the dropdown (Built-in: SOAP / Well-Child / Sick / Follow-up / ADHD / Procedure / Dictation; Yours: any custom templates the user authored). Click Regenerate → re-runs the LLM only, no re-transcription.
8. **Ask for changes** — physician types "shorten the assessment" or "add return precautions"; LLM returns the revised full note.
9. **Quality check** — separate LLM pass that flags 🔴 critical / 🟡 warning / ⚪ info concerns about note-vs-transcript fidelity. Persisted with the recording.
10. **Edit / Formatted toggle** on the note. Edit = textarea (raw markdown source). Formatted = prose-rendered preview.
11. **Share** (Web Share API → AirDrop / Messages / Mail on mobile; falls back to copy on desktop). **Copy text**. **Download** as a `.md` file with the visit label as the filename.
12. **Recordings on Home are grouped** Today / Yesterday / Earlier this week / Earlier with stage badges (Ready / Generating / Failed / Audio purged).

### Recording metadata (RecordingMeta)

```ts
interface RecordingMeta {
  id: string;
  createdAt: string;
  durationMs: number;
  mode: 'ambient' | 'dictation';
  stage:
    | 'recording'
    | 'recorded'
    | 'uploading'
    | 'transcribing'
    | 'generating'
    | 'ready_for_review'
    | 'failed';
  errorMessage: string | null;
  transcriptText: string | null; // role-rendered for display
  transcriptJson?: string | null; // full structured Transcript for regenerate
  noteMarkdown: string | null;
  templateId: string;
  patternId: string;
  providerUsed: string | null;
  audioPurgedAt?: string | null;
  label?: string | null; // free-form, e.g. "MM age 4 WCV"
  speakerRoles?: SpeakerRoleAssignment[];
  qaReviewMarkdown?: string | null; // null = QA not run yet
  qaReviewedAt?: string | null;
}
```

### Settings (persisted in localStorage, masked when displayed)

```ts
interface Settings {
  provider: 'anthropic' | 'openai-compatible' | 'gemini-api-key';
  anthropicApiKey: string;
  anthropicModel: string; // default 'claude-sonnet-4-6'
  openaiApiKey: string;
  openaiBaseUrl: string; // blank = api.openai.com; override for Azure / OpenRouter / local
  openaiModel: string; // default 'gpt-4o'
  geminiApiKey: string;
  geminiModel: string; // default 'gemini-2.0-flash' — list-my-models button finds whatever the key has
  assemblyAiKey: string;
  audioPurgeDays: number; // default 7, 0 = never
  idleLockMinutes: number; // default 5, 0 = disabled
  customTemplates: CustomTemplate[];
}
```

### Built-in templates (packages/prompts/src/templates/\*.json)

All five clinical templates use Roci's actual battle-tested prose, lifted with minimal paraphrase:

- `soap.json` — generic SOAP, default starting point. Documentation Principles + Fabrication Rules + Encounter Framing + Multi-Patient Safety + Format Rules + section-by-section guidance.
- `well-child.json` — well-child guidance + by-age key elements + documentation musts.
- `sick-visit.json` — sick visit guidance + common pediatric scenarios scaffold (URI / ear pain / rash / GI / fever / sore throat / asthma).
- `follow-up.json` — interim history / status / plan modification scaffold.
- `adhd-med-check.json` — explicit side-effect checklist + vitals + rating scales.
- `procedure.json` — step-by-step narration + tolerance + plan.
- `dictation.json` — Roci's `formatDictation` prose verbatim. Preserve content, organize sections, clean grammar, never invent.

Custom user templates live in `Settings.customTemplates`, are added/edited via `CustomTemplateEditor`, and resolve through the same `resolveTemplate` path in `pipeline-browser.ts`.

### Security

- **Masked saved keys** — once saved, the form shows `sk-•••••last4` with a "Replace" button. Full keys never sit in the DOM.
- **Redacted errors** — `redactKeysInText()` runs all error displays through regex masks for sk-ant, sk-(proj), AIza, ya29, and 32-char hex.
- **Wipe all data** — Danger Zone button drops every recording, transcript, note, key, and setting.
- **Audio auto-purge** — runs on app load; drops audio blobs older than `audioPurgeDays` (default 7). Metadata + transcript + note are kept; recording shows "Audio purged" badge.
- **CSP** — meta tag in `index.html` whitelists outbound to AssemblyAI, OpenAI, Anthropic, Google, \*.run.app, plus ws/wss for Vite HMR. Restricts script/style/img/etc.
- **Idle auto-lock** — `useIdleLock` hook tracks mouse/key/touch + tab visibility; flips `locked: true` after `idleLockMinutes` of inactivity. LockScreen overlays everything until tap-to-continue.
- **Web Share API** is preferred over filename downloads for mobile to avoid leaving PHI in the Downloads folder.

### Pipeline orchestration

`apps/web-mvp/src/lib/pipeline-browser.ts`:

- `runMvpPipeline({ audio, mode, settings, onStage, templateId, patternId, speakerRoles })` — full audio → transcript → note pass. Default templateId='soap', patternId='narrative'. Word boost: `PEDIATRIC_WORD_BOOST` (~150 terms — common peds dx, vaccines, anatomy, vitals, milestones, meds).
- `regenerateNoteFromTranscript({ transcript, mode, settings, templateId, speakerRoles })` — LLM-only pass against an already-saved transcript. No AssemblyAI, no audio needed.
- `reviewNoteQuality({ note, transcript, mode, settings, speakerRoles })` — Roci-style QA review pass; returns markdown.
- `tweakNote({ note, transcript, mode, settings, instruction, speakerRoles })` — physician revision pass; returns the complete revised note.
- `resolveTemplate(id, customTemplates)` — looks up built-in IDs first, falls back to user customs.

The four LLM adapters (in `@brtlb/pipeline/src/adapters/`) lazy-load their SDKs inside `generateNote()` so the browser only fetches the SDK when the matching provider is actually used:

- `anthropic.ts` — uses `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`
- `openai-compatible.ts` — uses `openai` SDK with optional baseURL override
- `gemini-vertex.ts` — uses `google-auth-library` JWT for service-account auth (deferred for browser MVP — see "Org-policy roadblock" below)
- `gemini-api-key.ts` — pure fetch to AI Studio's `generativelanguage.googleapis.com/v1beta/models/.../generateContent?key=...`

### Recorder

`apps/web-mvp/src/lib/recorder-store.ts` — Zustand store with global state. Supports start / pause / resume / stop / reset. Live audio level via Web Audio API analyzer. 32 kbps opus. Mime-type detection: `audio/webm;codecs=opus` → `audio/mp4` → fallback `audio/webm`.

### File structure

```
apps/web-mvp/
├── index.html                       # CSP, manifest, process shim
├── vercel.json                      # SPA rewrite + security headers
├── public/
│   ├── manifest.webmanifest
│   ├── favicon.svg
│   ├── app-icon.png
│   └── dots.svg
└── src/
    ├── App.tsx                      # view switcher; useIdleLock; auto-purge on load
    ├── main.tsx
    ├── index.css                    # safe-area padding, 16px form fonts, .prose styles
    ├── store.ts                     # Zustand: settings + view + locked + custom templates
    ├── lib/
    │   ├── db.ts                    # idb wrapper, recordings + audio stores
    │   ├── markdown.ts              # re-exports react-markdown + remark-gfm
    │   ├── peds-vocabulary.ts       # PEDIATRIC_WORD_BOOST list
    │   ├── pipeline-browser.ts      # runMvpPipeline / regenerate / review / tweak
    │   ├── recorder-store.ts        # global recorder Zustand
    │   ├── redact.ts                # key-masking for displayed errors
    │   └── useIdleLock.ts
    ├── components/
    │   ├── KeyField.tsx             # masked-display + Show/Replace
    │   ├── Recorder.tsx             # legacy local hook (still imported but unused since recorder-store)
    │   ├── SpeakerChips.tsx         # tap-to-cycle role assignment
    │   └── CustomTemplateEditor.tsx
    └── screens/
        ├── Home.tsx                 # greeting + grouped recordings + record CTA
        ├── Settings.tsx             # provider tabs, keys, templates, privacy, danger zone
        ├── Record.tsx               # live recording UI; idle fallback
        ├── Review.tsx               # transcript + note + tweak + QA + actions
        └── LockScreen.tsx
```

---

## What's paused on the long-term cross-platform plan

| Phase | Title                                    | Status                                        |
| ----- | ---------------------------------------- | --------------------------------------------- |
| 1     | Foundation                               | Complete                                      |
| Brand | v0.1                                     | Complete                                      |
| 2     | Pipeline core                            | Complete                                      |
| 3     | Data layer                               | Complete                                      |
| 3.5   | Encrypted storage (SQLCipher + keychain) | Deferred — needs device testing               |
| 4-MVP | **Web MVP (current focus)**              | In progress, 18+ commits on `feature/web-mvp` |
| 4     | Recording UX (Capacitor)                 | Paused — resume after MVP                     |
| 5     | Review & edit UX (Capacitor)             | Paused                                        |
| 6     | Templates & patterns UX                  | Paused                                        |
| 7     | Share & export                           | Paused                                        |
| 8     | Onboarding & settings (Capacitor)        | Paused                                        |
| 9     | Mobile shell finalization                | Paused                                        |
| 10    | Desktop shell finalization               | Paused                                        |

When picking the long-term plan back up:

1. The web MVP at `apps/web-mvp/` becomes Phase 4 source material. Most of the recording UI, review UI, store, and lib functions lift straight into a Capacitor app with minimal changes (audio recording becomes `@capacitor-community/voice-recorder`, localStorage becomes Capacitor Preferences, IndexedDB becomes SQLCipher via `@brtlb/db`).
2. Phase 3.5 (SQLCipher + keychain) becomes part of Phase 9 because it requires device testing.
3. The `Database` adapter interface in `@brtlb/db` is the seam — production swaps `openBetterSqliteDatabase` for `openCapacitorSqlCipherDatabase` and the repos work unchanged.

---

## Things learned along the way (carry forward)

### Provider quirks

- **Anthropic + BAA orgs** = 401 with `"CORS requests are not allowed for this Organization"`. Custom-retention enterprise accounts can't call the API directly from a browser. Workaround: a server-side proxy. Personal/non-BAA Anthropic keys work fine in browser.
- **Gemini AI Studio** = simple `?key=` in URL. Easy in browser. **NOT BAA-eligible.** For BAA, Vertex AI is required, which uses ADC + service-account JSON.
- **Google Workspace orgs** often disable raw API key creation via policy ("API Keys are Disallowed. Please use Application Default Credentials"). Personal Gmail accounts at aistudio.google.com are not affected.
- **OpenAI** = works in browser when `dangerouslyAllowBrowser: true`. Even Enterprise / BAA keys work. No CORS issues.
- **AssemblyAI** = works in browser for upload + transcript endpoints. Speaker labels enable diarization.

### Browser / Vite gotchas

- The Anthropic + OpenAI Node SDKs touch `process.env`, `process.stdout.isTTY`, and other Node globals at module load. Vite needs both `vite-plugin-node-polyfills` AND an inline `<script>` shim in `index.html` to provide `process.stdout / process.stderr / on / emit / etc.` Don't skip the inline shim.
- `node:fs/promises` in `transcribeWithAssemblyAi` (the path-based variant) breaks Vite's import analyzer even when the function is never called from the browser. Wrap with an indirect dynamic specifier `const id = 'node:fs/promises'; const fs = await import(/* @vite-ignore */ id);` or split into two files. The browser uses `transcribeBlobWithAssemblyAi(blob)` which has no Node imports.
- `@anthropic-ai/sdk`, `openai`, and `google-auth-library` are heavy. **Lazy-load them inside `generateNote()`** so unused providers don't reach the browser bundle and unused providers don't crash on Node-globals at import time.
- Tailwind utility classes like `bg-slate-900` win over later `bg-white` in compiled output because Tailwind sorts by category. Don't fight it with className overrides on the `<Button>`. Use a regular `<button>` when you need an inverted-on-graphite look.
- The pre-tool security hook blocks any markdown file containing the literal `exec(` even in code examples, and blocks `dangerouslySetInnerHTML` even when used with sanitizer. Use `react-markdown` (JSX-based) for safe markdown rendering.
- iOS Safari zooms on focus when input `font-size < 16px`. Force 16px on `input/textarea/select`.
- iOS safe-area insets (notches, home bar) need explicit `env(safe-area-inset-*)` padding.

### Roci patterns we lifted

- The 5-rule **Documentation Principles** preamble.
- The explicit **Fabrication Rules** list.
- **Encounter Framing** (acute-only / preventive-only / preventive plus acute, don't reduce a combined visit to one half).
- **Multi-Patient Safety** (don't import sibling concerns even within a single recording).
- Section-by-section **Format Rules** including "**Bold abnormal findings**" via markdown.
- Per-visit-type guidance verbatim for sick / well-child / follow-up / dictation.
- **`reviewNoteQuality`** (separate LLM pass for QA review).
- **`tweakNote`** (physician instruction → revised note).

### Roci patterns NOT lifted (deferred or not applicable)

- **Multi-patient identification + transcript splitting** — brtlb's design is one-recording-equals-one-encounter, so these are out of scope. If multi-patient need arises, lift Roci's `splitByPatient` prompt directly.
- **CPT/ICD-10 code suggestion pass** — useful, deferred.
- **Vitals extraction (structured)** — deferred.
- **Quick patient-summary / hallway briefing** — requires Elation chart data; not relevant to the BYO-keys browser MVP.

### Recording quirks

- 32 kbps opus is plenty for clear voice and ~5x smaller than MediaRecorder defaults. Keeps 15-min visits under ~3 MB.
- MediaRecorder needs the user-gesture-initiated `getUserMedia` call on the same click handler. We start it on the Home button click before navigating.
- Web Audio API `AudioContext` requires `close()` cleanup or it leaks. Track in the recorder-store internals.

### Naming and copy

- Most users don't know what markdown is. Buttons say "Copy text" and "Download", not "Copy as Markdown" or "Download .md".
- Edit / **Formatted** (not "Edit / Preview") makes the toggle's purpose obvious.
- Visit labels work: free-form text, used for filename, displayed first on Home list, falls back to date+mode if blank.

---

## Working state at last commit (`8b8933f`)

- Branch: `feature/web-mvp`
- Local tests: ✅ all green (15 web-mvp + 6 ui + 4 prompts + 40 pipeline + 45 db = 110)
- CI on PR: not yet pushed for this batch — push this commit and watch
- Dev server: `pnpm --filter @brtlb/web-mvp dev` → `http://localhost:5181`
- Build: `pnpm --filter @brtlb/web-mvp build` → `apps/web-mvp/dist/` (~430 KB JS / 134 KB gzip)

## To resume

1. `cd ~/Downloads/Consult/pedsdpc/brtlb`
2. `git status` — should be clean on `feature/web-mvp`
3. `pnpm install` if you haven't recently
4. `pnpm --filter @brtlb/web-mvp dev`
5. Read this checkpoint.
6. Open the next backlog item below.

## Backlog (rough priority)

1. **Push branch + open PR + merge to main** — `feature/web-mvp` is 18+ commits ahead, CI hasn't run on the latest. Push it.
2. **Deploy to Vercel** — `vercel.json` is configured. Just connect the repo at vercel.com → Import Project. Live URL goes in this checkpoint when deployed.
3. **Auto visit-type detection** — let the LLM pick the template from the transcript. Roci has the prompt for this. Saves user a click.
4. **Auto label suggestion** — extract a 4-word label from the transcript ("Tommy ear pain f/u") so the user doesn't have to type one.
5. **Vertex proxy on Cloud Run** — `services/vertex-proxy/` was scaffolded and rejected at the time. Revisit when the user has a GCP project ready. Solves the BAA-Anthropic-CORS problem too if we proxy any provider.
6. **Recording resilience** — chunk-save during recording so a tab crash doesn't lose the visit.
7. **PDF / DOCX export** — for sharing into EHRs that don't accept markdown.
8. **Search / filter recordings** — at scale, finding "that ADHD med check from last week" matters.
9. **Encrypted localStorage** — passphrase-derived AES key wraps the settings blob. Big lift.
10. **Long-term Capacitor plan** — resume Phases 4–10 when the web MVP has been used for real visits and we know what to build native.
