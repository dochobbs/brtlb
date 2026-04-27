# brtlb — Design Spec

**Date:** 2026-04-26
**Status:** Draft for review
**Author:** Dr. Hobbs + Claude

---

## 1. Purpose

`brtlb` is a standalone, cross-platform, BYO-keys AI ambient scribe focused on pediatrics. It records a patient encounter, transcribes it with speaker diarization, generates a clinical note in a chosen template, lets the provider edit, and shares it out. PHI never leaves the user's device — no servers, no accounts, no cloud sync in v1.

The product extracts and adapts the proven recording → transcribe → generate pipeline from `Roci` (Lakes Pediatrics' internal scribe), but removes the Elation EHR coupling and per-practice assumptions so any pediatrician can install it and use their own provider keys.

## 2. Target User

- Independent / direct-primary-care / small-group pediatricians.
- Already has (or can obtain) a Business Associate Agreement with at least one foundation-model provider (Vertex AI, Anthropic, Azure OpenAI, etc.).
- Already has (or will create) an AssemblyAI account with a BAA on a paid tier.
- Wants their notes generated _for_ them, not posted _into_ an EHR for them.

## 3. Non-Goals (v1)

- No EHR integration. Output is copy/share/export only.
- No cloud accounts, no auth, no sync.
- No multi-user / team / practice features.
- No billing or payments.
- No custom prompt editor UI (templates ship as JSON, advanced users edit by hand).
- No multilingual transcription (English only at launch).
- No on-device foundation model. Network required for transcription and note generation.

## 4. Pipeline

```
Record (with diarization on)
  → AssemblyAI transcribe (speaker labels + medical vocabulary boost)
  → User picks template + pattern
  → LLM generates first-pass note (diarized transcript + template; speakers labeled generically)
  → User reviews: rename speakers to roles (Parent/Patient/Provider), edit text inline
  → (Optional) Regenerate note with assigned roles for higher fidelity
  → Share / Export
```

One recording = one encounter = one note. Multi-patient sessions are handled by the user starting a new recording per patient.

The first generation pass runs immediately after transcription so the user has something to look at while assigning speaker roles. Re-generation is one click and reuses the cached transcript + new role assignments.

### Pipeline States

```
recording → recorded → uploading → transcribing → ready_for_template → generating → ready_for_review → finalized
                                                                                                        → failed (any stage)
```

Stale-state recovery: any stage stuck > 3 minutes is auto-flagged as `failed` with a manual retry option.

## 5. Diarization (critical feature)

- AssemblyAI `speaker_labels: true` is **mandatory** for ambient mode.
- Transcript is stored as an array of utterances: `{speaker_id, start_ms, end_ms, text, confidence}`.
- Review view renders speakers as colored chips ("Speaker A," "Speaker B," "Speaker C") with one-click rename to **Parent / Patient / Provider / Sibling / Other**. Renames persist for that recording and are passed into the note prompt on regeneration.
- Note prompt is explicitly instructed to attribute statements to roles (Parent/Patient/Provider), not raw "Speaker A" tags.
- If AssemblyAI returns one speaker (single-voice monologue), the app auto-falls-back to dictation note generation and shows a warning banner.

## 6. Recording Modes

| Mode                  | Diarization | Prompt assumption                                                |
| --------------------- | ----------- | ---------------------------------------------------------------- |
| **Ambient** (default) | On          | Multiple speakers; LLM attributes statements to roles.           |
| **Dictation**         | Off         | Single speaker (provider); LLM treats as a structured monologue. |

Toggle on the record screen. Both share the same recording, upload, and transcription code paths — only the AssemblyAI flag and the prompt template change.

## 7. Templates and Patterns

A **template** is the _output structure_:

- SOAP (default)
- HPI-only
- Well-Child Visit (age-aware variants: newborn / infant / toddler / school-age / adolescent)
- Sick Visit
- Follow-up
- ADHD Med Check
- Behavioral
- Procedure note

A **pattern** is the _stylistic shape_ applied on top:

- Terse vs. narrative prose
- Inline ROS vs. bulleted ROS
- Numbered vs. paragraph assessment/plan
- Includes/excludes a parent-education section

Templates and patterns are picked **after** transcription, **before** generation. Defaults remember the last selection. Both ship as versioned JSON in `packages/prompts/`. Editing in v1 is JSON-only; a graphical editor is post-v1.

### Pediatric-Specific Template Behavior

- Age-aware Well-Child variants prime the LLM with age-appropriate ROS items, milestones, anticipatory guidance topics, and physical exam expectations.
- Weight-based dosing is **flagged** ("verify mg/kg dosing for amoxicillin") rather than computed. brtlb is not a calculator.
- Vaccines mentioned (given / declined / due) are extracted into a structured list at the end of every note.
- Speaker roles bias attribution: parent reports vs. patient self-reports (when developmentally appropriate).

## 8. Foundation Model Adapters

Three adapters behind a `LLMProvider` interface in `packages/pipeline/`:

| Adapter                | Auth                                           | Primary use                                                                   |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| **Gemini (Vertex AI)** | GCP project ID + region + service account JSON | **Default / most-used.** BAA via Google Cloud HIPAA.                          |
| **Anthropic**          | API key                                        | BAA via Anthropic Enterprise.                                                 |
| **OpenAI-compatible**  | Base URL + API key + model name                | Covers OpenAI, Azure OpenAI, OpenRouter, local Ollama, vLLM, custom gateways. |

User selects the active provider in settings and the model used for note generation. All three adapters expose the same `generateNote({transcript, template, pattern, speakerRoles}) → string` shape so the rest of the app is provider-agnostic.

## 9. Storage and Security

- **Local-only.** No data ever leaves the device except the AssemblyAI upload and the LLM API call (both sent directly to the user's chosen provider).
- **SQLite via @capacitor-community/sqlite + SQLCipher.** Database key derived from a user-set passphrase (Argon2id). Derived key is stored in platform secure storage:
  - iOS / macOS: Keychain
  - Android: Keystore
  - Windows: Credential Manager (DPAPI)
  - Linux: libsecret / GNOME Keyring
- **Audio files** stored encrypted at rest in the app's private documents directory.
- **Auto-purge** of audio files after N days (default 7, configurable 1–90 or "never"). Notes and transcripts persist until manually deleted.
- **Wipe-all** button in settings with double confirmation.
- **Biometric unlock** (Face ID / Touch ID / Windows Hello / Android BiometricPrompt) gates app launch.
- **Lock policy** options: immediate, after 1 min idle, after 5 min idle, after backgrounded.

## 10. Sharing and Export (first-class)

Every note has a one-tap share menu offering:

- Copy as **Markdown**
- Copy as **Plain text**
- Copy as **Rich text / HTML** (pastes formatted into EHR fields)
- Export **PDF** (formatted; user-customizable letterhead in settings)
- Export **DOCX**
- Export **JSON** (raw note + transcript + metadata, for power users / backup)
- **Native share sheet** (AirDrop, Messages, Mail, Drive, Files, etc.)
- **Print** (desktop and iOS)
- **Email** (note as PDF attachment + plain-text body preview)
- **"Send to Self"** quick action — configurable destination (email address, Drive folder)

Sharing is exposed as a primary action on the note review screen, the note list, and the note detail view. No friction.

## 11. Onboarding (first-run wizard)

1. Welcome + privacy promise ("Your recordings and notes never leave this device. Only the transcription and LLM API calls go out, directly to providers you configure.")
2. Set passphrase → optional biometric unlock
3. Pick foundation-model provider:
   - **Step-by-step deep-linked guides** for each: "Get a Vertex AI key with BAA in 8 steps," with screenshots, opened in an in-app browser.
   - User pastes credentials into the form; we test the connection live.
4. Paste AssemblyAI key (with linked guide for getting BAA-covered access).
5. **End-to-end test:** record 10 seconds, transcribe, generate a sample note. Confirms the entire pipeline works before the user trusts it with PHI.
6. Pick default template and pattern.
7. Set audio auto-purge interval.

Docs are bundled in-app (offline) and mirrored on a marketing site.

## 12. Offline Behavior

- **Recording works fully offline.** It's local file I/O.
- If processing is requested while offline, the recording is queued with a clear "waiting for connection" badge.
- Background sync resumes automatically when the network returns.
- Each pipeline stage (upload, transcribe, generate) has a manual retry button.

## 13. Cross-Platform Architecture

```
┌──────────────────────────────────────────────────────────┐
│  React 19 + Vite + TypeScript + Tailwind v4              │
│  Single web app — the product                            │
└────────────────────┬─────────────────────────────────────┘
                     │
         ┌───────────┼────────────────┐
         ▼           ▼                ▼
   Capacitor iOS   Capacitor Android  Electron Desktop
   (WebView +      (WebView +         (Mac / Win / Linux)
    plugins)        plugins)
         │           │                │
         └─── Native APIs (audio, share, FS, biometrics) ──┘
```

- **One web codebase**, three native shells.
- **No backend.** All API calls go directly client → AssemblyAI, client → LLM provider.
- We host nothing. We are not a HIPAA covered entity or business associate.

## 14. Tech Stack

| Layer           | Choice                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| UI framework    | React 19 + Vite 6 + TypeScript                                                      |
| Styling         | Tailwind v4                                                                         |
| State           | Zustand                                                                             |
| DB              | @capacitor-community/sqlite + SQLCipher                                             |
| Audio (mobile)  | @capacitor-community/voice-recorder                                                 |
| Audio (desktop) | MediaRecorder API                                                                   |
| Share (mobile)  | @capacitor/share                                                                    |
| Share (desktop) | Electron `shell` + `dialog`                                                         |
| Crypto          | Web Crypto API + platform keychain bridges                                          |
| Native shells   | Capacitor 6 (iOS + Android), Electron 30 (Mac/Win/Linux)                            |
| Monorepo        | Turborepo + pnpm workspaces                                                         |
| Build           | Vite for web, electron-builder for desktop, Capacitor CLI + Xcode/Gradle for mobile |
| Testing         | Vitest (unit), Playwright (E2E web), manual smoke per platform                      |
| Lint/format     | ESLint + Prettier + TypeScript strict                                               |
| CI              | GitHub Actions                                                                      |

## 15. Repo Layout

```
brtlb/
├── apps/
│   ├── web/           # Vite React app — the product
│   ├── electron/      # Desktop shell
│   └── mobile/        # Capacitor configs (ios/, android/)
├── packages/
│   ├── pipeline/      # AssemblyAI client, LLM adapters, orchestration
│   ├── db/            # Schema, encrypted SQLite wrapper, migrations
│   ├── ui/            # Shared component library
│   └── prompts/       # Versioned templates and patterns (JSON + .md prompt bodies)
├── docs/
│   ├── superpowers/
│   │   ├── specs/     # Design specs
│   │   └── plans/     # Implementation plans
│   └── user-guides/   # API key setup walkthroughs (in-app + web)
├── .github/workflows/
├── README.md
└── package.json
```

Bundle / product identifiers:

- Capacitor app ID: `com.brtlb.app`
- Electron product name: `brtlb`
- SQLite filename: `brtlb.db`

## 16. Data Model (initial)

```
recordings
  id, created_at, duration_ms, audio_path, mode (ambient|dictation),
  status (recording|recorded|uploading|...), error_message

transcripts
  id, recording_id, assemblyai_id, raw_json, created_at

utterances
  id, transcript_id, speaker_id, role (parent|patient|provider|sibling|other|null),
  start_ms, end_ms, text, confidence

notes
  id, recording_id, template_id, pattern_id, provider_used,
  generated_text, edited_text, status (draft|finalized), created_at, updated_at

speaker_role_assignments
  recording_id, speaker_id, role  (lets renames survive note regeneration)

settings   (single-row table)
  active_provider, gemini_config_json, anthropic_config_json,
  openai_compatible_config_json, assemblyai_key_encrypted,
  audio_purge_days, default_template_id, default_pattern_id,
  letterhead_html, lock_policy, ...
```

All sensitive fields encrypted via SQLCipher at rest.

## 17. Risks and Open Questions

| Risk / Question                                             | Mitigation                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **iOS background recording** can be killed by the OS.       | Declare `audio` background mode in `Info.plist`, show the system recording indicator, write audio in small chunks so a kill loses ≤ 30 sec. |
| **App Store review for medical apps.**                      | Clear privacy disclosure: PHI never leaves the device; all third-party calls are user-configured. Expect extra review cycles.               |
| **AssemblyAI BAA gating.**                                  | Document required plan tier in onboarding; refuse to send any audio if user hasn't checked the "I have a BAA" attestation.                  |
| **Vertex AI service-account JSON UX** is awkward on mobile. | Provide an in-app file picker + paste-from-clipboard fallback, with a "How do I create this?" deep-linked guide.                            |
| **Diarization quality** varies wildly with mic placement.   | Show real-time audio meter while recording; in onboarding test, surface the speaker count detected so the user calibrates expectations.     |
| **Passphrase loss = total data loss.**                      | Big warning during setup. Offer optional written-down recovery word list (BIP-39 style) printed once during setup.                          |
| **License** for the codebase.                               | TBD — likely AGPL-3.0 or source-available; decide before first public push.                                                                 |

## 18. Out of Scope (deferred to later versions)

- EHR posting (adapter pattern leaves room — Elation, Athena, eClinicalWorks)
- Cloud sync (encrypted, BYO-bucket)
- Multilingual transcription (Spanish first)
- On-device transcription (Whisper) for offline use
- Custom template editor UI
- Practice/team accounts
- Billing
- Third-party plugin system

---

## 19. Success Criteria for v1

- Provider records a real (consented) ambient encounter on iPhone.
- Diarization correctly separates parent and provider voices ≥ 90% of the time.
- Generated SOAP note requires ≤ 3 minutes of editing for a typical 10-minute visit.
- Provider shares the finished note to their EHR (via paste or PDF) in ≤ 30 seconds.
- Same flow works on Mac desktop with no behavioral surprises.
- Zero PHI ever transits a brtlb-controlled server.
