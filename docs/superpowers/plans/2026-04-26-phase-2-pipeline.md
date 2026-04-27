# brtlb — Phase 2: Pipeline Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end Node-testable pipeline: an `audioPath + provider config + template/pattern + mode` goes in, a generated note (and the diarized transcript) comes out. Three LLM adapters (Gemini Vertex, Anthropic, OpenAI-compatible) sit behind a common `LlmProvider` interface. AssemblyAI handles transcription with speaker diarization. No UI in this phase — everything is exercised through unit + integration tests using mocked HTTP.

**Architecture:**

```
packages/pipeline/src/
├── types.ts                      # Phase 1 shapes — extended here
├── index.ts                      # public surface
├── prompts/
│   └── compose.ts                # template + pattern + transcript → prompt
├── transcription/
│   └── assemblyai.ts             # upload → request job → poll → Transcript
├── adapters/
│   ├── anthropic.ts              # @anthropic-ai/sdk
│   ├── openai-compatible.ts      # `openai` SDK, configurable baseURL
│   ├── gemini-vertex.ts          # google-auth-library + raw fetch
│   └── factory.ts                # createLlmProvider(config) → LlmProvider
└── orchestrator.ts               # runPipeline({audioPath, providerConfig, ...}) → {transcript, note}
```

Each adapter accepts an optional `httpClient: typeof fetch` so tests can inject a mock. Where SDKs are used (Anthropic, OpenAI), the SDK module itself is mocked with `vi.mock()`. Gemini Vertex uses `google-auth-library` to get an access token from a service account JSON, then calls Vertex's `generateContent` endpoint directly with `fetch`.

**Tech Stack:** `@anthropic-ai/sdk` (Anthropic), `openai` (OpenAI/Azure/OpenRouter/local), `google-auth-library` (Vertex auth), Node `fetch` (everything else), Vitest with `vi.mock()` for HTTP mocking.

---

## Spec mapping

| Spec section              | Covered by tasks                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 4. Pipeline               | 8 (orchestrator)                                                                                              |
| 5. Diarization            | 3 (AssemblyAI client) — `speaker_labels: true`, `word_boost`; 2 (prompt composer) — passes labeled utterances |
| 6. Recording modes        | 3 (mode → speaker_labels flag), 2 (mode → prompt variant)                                                     |
| 7. Templates and patterns | 2 (compose) — composes `promptBody + promptModifier`                                                          |
| 8. LLM adapter shapes     | 4, 5, 6 (three adapters) + 7 (factory)                                                                        |

---

## Out of scope for Phase 2

- Streaming responses (planned for v1.x)
- Real network calls in tests (everything mocked — real key-based smoke tests live in Phase 8 onboarding wizard)
- Browser-side bundling concerns (the SDKs assume Node fetch and crypto; Phase 4 will verify Capacitor/Electron compatibility before wiring to the UI)
- Note re-generation with updated speaker roles (Phase 5 review UX adds the trigger; orchestrator only needs to accept fresh inputs each call)

---

## File Structure

```
packages/pipeline/
├── package.json                  # MODIFIED: add SDK deps
├── src/
│   ├── types.ts                  # MODIFIED: add ProviderConfig, AssemblyAiConfig, RunPipelineInput, RunPipelineOutput
│   ├── index.ts                  # MODIFIED: re-export new public API
│   ├── prompts/
│   │   ├── compose.ts            # NEW
│   │   └── compose.test.ts       # NEW
│   ├── transcription/
│   │   ├── assemblyai.ts         # NEW
│   │   └── assemblyai.test.ts    # NEW
│   ├── adapters/
│   │   ├── anthropic.ts          # NEW
│   │   ├── anthropic.test.ts     # NEW
│   │   ├── openai-compatible.ts  # NEW
│   │   ├── openai-compatible.test.ts  # NEW
│   │   ├── gemini-vertex.ts      # NEW
│   │   ├── gemini-vertex.test.ts # NEW
│   │   └── factory.ts            # NEW
│   ├── orchestrator.ts           # NEW
│   └── orchestrator.test.ts      # NEW
└── README.md                     # NEW
```

---

## Task 1: Extend types and add SDK dependencies

**Files:**

- Modify: `packages/pipeline/package.json`
- Modify: `packages/pipeline/src/types.ts`
- Modify: `packages/pipeline/src/index.ts`

This task pre-stages every type the later tasks need so each subagent can reference them without inventing shapes.

- [ ] **Step 1.1: Update `packages/pipeline/package.json`**

```json
{
  "name": "@brtlb/pipeline",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.1",
    "google-auth-library": "^9.14.2",
    "openai": "^4.71.1"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 1.2: Run `pnpm install`**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm install
```

If pnpm resolves newer versions, tighten the specifiers in `package.json` to match resolved versions. Re-run `pnpm install`.

- [ ] **Step 1.3: Replace `packages/pipeline/src/types.ts`**

```ts
export type RecordingMode = 'ambient' | 'dictation';

export type SpeakerRole = 'parent' | 'patient' | 'provider' | 'sibling' | 'other';

export interface Utterance {
  speakerId: string;
  role: SpeakerRole | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface Transcript {
  id: string;
  recordingId: string;
  utterances: Utterance[];
  createdAt: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  promptBody: string;
}

export interface NotePattern {
  id: string;
  name: string;
  description: string;
  promptModifier: string;
}

export interface SpeakerRoleAssignment {
  speakerId: string;
  role: SpeakerRole;
}

export interface GenerateNoteInput {
  transcript: Transcript;
  template: NoteTemplate;
  pattern: NotePattern;
  mode: RecordingMode;
  speakerRoles: SpeakerRoleAssignment[];
}

export interface LlmProvider {
  readonly name: string;
  generateNote(input: GenerateNoteInput): Promise<string>;
}

// --- Provider configs (one per adapter) ---

export interface AnthropicProviderConfig {
  kind: 'anthropic';
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface OpenAiCompatibleProviderConfig {
  kind: 'openai-compatible';
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface GeminiVertexProviderConfig {
  kind: 'gemini-vertex';
  serviceAccountJson: string;
  projectId: string;
  location: string;
  model: string;
}

export type ProviderConfig =
  | AnthropicProviderConfig
  | OpenAiCompatibleProviderConfig
  | GeminiVertexProviderConfig;

// --- AssemblyAI ---

export interface AssemblyAiConfig {
  apiKey: string;
}

export interface TranscribeInput {
  audioPath: string;
  mode: RecordingMode;
  config: AssemblyAiConfig;
  wordBoost?: string[];
  httpClient?: typeof fetch;
}

// --- Orchestrator ---

export interface RunPipelineInput {
  recordingId: string;
  audioPath: string;
  mode: RecordingMode;
  template: NoteTemplate;
  pattern: NotePattern;
  speakerRoles?: SpeakerRoleAssignment[];
  providerConfig: ProviderConfig;
  assemblyAi: AssemblyAiConfig;
  wordBoost?: string[];
}

export interface RunPipelineOutput {
  transcript: Transcript;
  note: string;
  providerUsed: ProviderConfig['kind'];
}
```

- [ ] **Step 1.4: Replace `packages/pipeline/src/index.ts`**

```ts
export * from './types';
import type { LlmProvider } from './types';

export const PIPELINE_VERSION = '0.2.0';

export function isLlmProvider(value: unknown): value is LlmProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    'generateNote' in value &&
    typeof (value as { generateNote: unknown }).generateNote === 'function'
  );
}

export { composeNotePrompt } from './prompts/compose';
export { transcribeWithAssemblyAi } from './transcription/assemblyai';
export { createAnthropicProvider } from './adapters/anthropic';
export { createOpenAiCompatibleProvider } from './adapters/openai-compatible';
export { createGeminiVertexProvider } from './adapters/gemini-vertex';
export { createLlmProvider } from './adapters/factory';
export { runPipeline } from './orchestrator';
```

This file references modules that don't exist yet — that's intentional. Subsequent tasks create them. The existing test (`src/index.test.ts`) only imports `PIPELINE_VERSION` and `isLlmProvider`, which both still resolve, so it keeps passing through every subsequent task.

- [ ] **Step 1.5: Verify Phase 1 test still passes**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm --filter @brtlb/pipeline test
```

Expected: 3 tests still pass. (TypeScript will complain about unresolved imports in `index.ts` until later tasks land — that's the point of TDD here. Run `pnpm --filter @brtlb/pipeline typecheck` only AFTER the dependent files exist; for Task 1 alone, expect typecheck to fail. That's OK — the gate is "tests still pass.")

To unblock typecheck during Phase 2 task 1, comment out the new exports at the bottom of `index.ts` until Task 2 lands. Do this only if needed; an alternative is to land Tasks 1 + 2 together. Recommended: keep them as separate commits but don't run `pnpm typecheck` (or `pnpm test` from the repo root, which runs typecheck before test) until the dependent file is created in Task 2.

**Concretely for Task 1's commit:** comment out lines 13–19 of `index.ts` (every `export` after `isLlmProvider`). Each subsequent task uncomments its own export when it lands.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
git add packages/pipeline pnpm-lock.yaml
git commit -m "FEATURE(pipeline): extend types for provider configs + add SDK deps"
```

---

## Task 2: Prompt composer

**Files:**

- Create: `packages/pipeline/src/prompts/compose.ts`
- Test: `packages/pipeline/src/prompts/compose.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment the `composeNotePrompt` export)

The composer is a pure function. Given `{transcript, template, pattern, mode, speakerRoles}` it returns the final prompt string sent to the LLM.

Output format (deterministic so it can be snapshot-tested):

```
<template.promptBody>

<pattern.promptModifier>

Recording mode: <ambient|dictation>

Transcript:
[Parent] We've had a fever for two days.
[Provider] How high did it get?
[Patient] Mom says it was over a hundred.
...
```

When `speakerRoles` is empty or doesn't cover a speaker ID, that speaker is rendered as `[Speaker A]`, `[Speaker B]`, etc., derived from `speakerId`. Roles that ARE in `speakerRoles` win over `Utterance.role`.

- [ ] **Step 2.1: Write the failing tests**

Create `packages/pipeline/src/prompts/compose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeNotePrompt } from './compose';
import type { GenerateNoteInput, NotePattern, NoteTemplate, Transcript, Utterance } from '../types';

const template: NoteTemplate = {
  id: 't',
  name: 'Test',
  description: '',
  promptBody: 'Generate a SOAP note.',
};

const pattern: NotePattern = {
  id: 'p',
  name: 'Test',
  description: '',
  promptModifier: 'Use bullet points.',
};

function utterance(overrides: Partial<Utterance>): Utterance {
  return {
    speakerId: 'A',
    role: null,
    startMs: 0,
    endMs: 1000,
    text: 'hello',
    confidence: 0.9,
    ...overrides,
  };
}

function transcript(utterances: Utterance[]): Transcript {
  return {
    id: 't1',
    recordingId: 'r1',
    utterances,
    createdAt: '2026-04-26T00:00:00Z',
  };
}

function input(over: Partial<GenerateNoteInput> = {}): GenerateNoteInput {
  return {
    template,
    pattern,
    mode: 'ambient',
    transcript: transcript([utterance({ text: 'fever for two days', speakerId: 'A' })]),
    speakerRoles: [],
    ...over,
  };
}

describe('composeNotePrompt', () => {
  it('includes the template body, pattern modifier, and mode', () => {
    const out = composeNotePrompt(input());
    expect(out).toContain('Generate a SOAP note.');
    expect(out).toContain('Use bullet points.');
    expect(out).toContain('Recording mode: ambient');
  });

  it('renders unlabeled speakers as [Speaker A], [Speaker B]', () => {
    const out = composeNotePrompt(
      input({
        transcript: transcript([
          utterance({ speakerId: 'A', text: 'one' }),
          utterance({ speakerId: 'B', text: 'two' }),
        ]),
      }),
    );
    expect(out).toContain('[Speaker A] one');
    expect(out).toContain('[Speaker B] two');
  });

  it('uses speakerRoles when provided, capitalizing role names', () => {
    const out = composeNotePrompt(
      input({
        transcript: transcript([
          utterance({ speakerId: 'A', text: 'fever' }),
          utterance({ speakerId: 'B', text: 'how high' }),
        ]),
        speakerRoles: [
          { speakerId: 'A', role: 'parent' },
          { speakerId: 'B', role: 'provider' },
        ],
      }),
    );
    expect(out).toContain('[Parent] fever');
    expect(out).toContain('[Provider] how high');
  });

  it('falls back to Utterance.role when speakerRoles is empty', () => {
    const out = composeNotePrompt(
      input({
        transcript: transcript([utterance({ speakerId: 'A', role: 'patient', text: 'hi' })]),
        speakerRoles: [],
      }),
    );
    expect(out).toContain('[Patient] hi');
  });

  it('speakerRoles wins over Utterance.role', () => {
    const out = composeNotePrompt(
      input({
        transcript: transcript([utterance({ speakerId: 'A', role: 'patient', text: 'hi' })]),
        speakerRoles: [{ speakerId: 'A', role: 'parent' }],
      }),
    );
    expect(out).toContain('[Parent] hi');
    expect(out).not.toContain('[Patient]');
  });

  it('emits "Recording mode: dictation" for dictation mode', () => {
    const out = composeNotePrompt(input({ mode: 'dictation' }));
    expect(out).toContain('Recording mode: dictation');
  });

  it('preserves utterance order', () => {
    const out = composeNotePrompt(
      input({
        transcript: transcript([
          utterance({ speakerId: 'A', text: 'first' }),
          utterance({ speakerId: 'B', text: 'second' }),
          utterance({ speakerId: 'A', text: 'third' }),
        ]),
      }),
    );
    const positions = ['first', 'second', 'third'].map((s) => out.indexOf(s));
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm --filter @brtlb/pipeline test
```

Expected: 7 new tests fail with "composeNotePrompt is not a function" or similar.

- [ ] **Step 2.3: Write the implementation**

Create `packages/pipeline/src/prompts/compose.ts`:

```ts
import type { GenerateNoteInput, SpeakerRole, SpeakerRoleAssignment, Utterance } from '../types';

const ROLE_LABEL: Record<SpeakerRole, string> = {
  parent: 'Parent',
  patient: 'Patient',
  provider: 'Provider',
  sibling: 'Sibling',
  other: 'Other',
};

function speakerLabel(utterance: Utterance, roleMap: Map<string, SpeakerRole>): string {
  const overrideRole = roleMap.get(utterance.speakerId);
  if (overrideRole) return ROLE_LABEL[overrideRole];
  if (utterance.role) return ROLE_LABEL[utterance.role];
  return `Speaker ${utterance.speakerId}`;
}

function buildRoleMap(assignments: SpeakerRoleAssignment[]): Map<string, SpeakerRole> {
  const map = new Map<string, SpeakerRole>();
  for (const a of assignments) map.set(a.speakerId, a.role);
  return map;
}

export function composeNotePrompt(input: GenerateNoteInput): string {
  const roleMap = buildRoleMap(input.speakerRoles);
  const lines = input.transcript.utterances
    .map((u) => `[${speakerLabel(u, roleMap)}] ${u.text}`)
    .join('\n');

  return [
    input.template.promptBody,
    '',
    input.pattern.promptModifier,
    '',
    `Recording mode: ${input.mode}`,
    '',
    'Transcript:',
    lines,
  ].join('\n');
}
```

- [ ] **Step 2.4: Run tests, verify they pass**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm --filter @brtlb/pipeline test
```

Expected: 7 new + 3 existing = 10 passing.

- [ ] **Step 2.5: Uncomment the `composeNotePrompt` export in `src/index.ts`**

Edit `packages/pipeline/src/index.ts`. Find the previously commented-out line `export { composeNotePrompt } from './prompts/compose';` and uncomment it. Leave the others commented for now.

- [ ] **Step 2.6: Format, lint, typecheck, commit**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add composeNotePrompt with role-aware utterance rendering"
```

---

## Task 3: AssemblyAI client

**Files:**

- Create: `packages/pipeline/src/transcription/assemblyai.ts`
- Test: `packages/pipeline/src/transcription/assemblyai.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `transcribeWithAssemblyAi`)

Three sequential HTTP calls:

1. **Upload audio.** `POST https://api.assemblyai.com/v2/upload` with raw bytes, `Authorization: <apiKey>`, `Content-Type: application/octet-stream`. Response: `{ upload_url: string }`.
2. **Request transcription.** `POST https://api.assemblyai.com/v2/transcript` with JSON `{ audio_url, speaker_labels: <true if mode=ambient>, word_boost?: string[] }`, `Authorization: <apiKey>`. Response: `{ id: string, status: 'queued'|'processing' }`.
3. **Poll.** `GET https://api.assemblyai.com/v2/transcript/<id>` every 3 seconds (configurable; tests use a smaller interval) until `status === 'completed'` or `status === 'error'`. Response on completion includes `text`, `utterances: [{speaker, start, end, text, confidence}]`.

The function reads the audio file from disk via Node's `node:fs/promises`. It returns the parsed `Transcript` shape, mapping AssemblyAI's millisecond timestamps and speaker letters into `Utterance[]`.

`httpClient` defaults to global `fetch`. `pollIntervalMs` defaults to 3000 but can be overridden for tests. The function should also accept `now: () => number` and `sleep: (ms) => Promise<void>` for testability — provide sane defaults.

Errors:

- Any HTTP status outside 2xx throws `Error("AssemblyAI <step>: <status> <body>")`.
- AssemblyAI status `error` throws `Error("AssemblyAI transcription failed: <error_message>")`.

- [ ] **Step 3.1: Write the failing tests**

Create `packages/pipeline/src/transcription/assemblyai.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeWithAssemblyAi } from './assemblyai';

async function tempAudio(bytes = Buffer.from([1, 2, 3, 4])): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brtlb-assemblyai-'));
  const path = join(dir, 'sample.m4a');
  await writeFile(path, bytes);
  return path;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('transcribeWithAssemblyAi', () => {
  it('uploads audio, requests transcription with speaker_labels for ambient mode, polls until complete', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });

      if (url === 'https://api.assemblyai.com/v2/upload') {
        return jsonResponse({ upload_url: 'https://cdn.assemblyai.com/uploads/abc' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        return jsonResponse({ id: 'tr_1', status: 'queued' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript/tr_1') {
        // First poll returns processing, second returns completed
        const isFirstPoll = calls.filter((c) => c.url.endsWith('/tr_1')).length === 1;
        if (isFirstPoll) return jsonResponse({ id: 'tr_1', status: 'processing' });
        return jsonResponse({
          id: 'tr_1',
          status: 'completed',
          text: 'fever',
          utterances: [{ speaker: 'A', start: 0, end: 1500, text: 'fever', confidence: 0.92 }],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const audioPath = await tempAudio();
    const transcript = await transcribeWithAssemblyAi({
      audioPath,
      mode: 'ambient',
      config: { apiKey: 'test-key' },
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcript.utterances).toEqual([
      {
        speakerId: 'A',
        role: null,
        startMs: 0,
        endMs: 1500,
        text: 'fever',
        confidence: 0.92,
      },
    ]);

    // Verify the transcribe POST body included speaker_labels=true
    const transcribePost = calls.find((c) => c.url === 'https://api.assemblyai.com/v2/transcript');
    expect(transcribePost).toBeDefined();
    const body = JSON.parse(transcribePost!.init!.body as string);
    expect(body.speaker_labels).toBe(true);
    expect(body.audio_url).toBe('https://cdn.assemblyai.com/uploads/abc');
  });

  it('sends speaker_labels=false for dictation mode', async () => {
    let transcribeBody: Record<string, unknown> | undefined;
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        transcribeBody = JSON.parse(init.body as string);
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({
        id: 'tr',
        status: 'completed',
        text: '',
        utterances: [],
      });
    });

    await transcribeWithAssemblyAi({
      audioPath: await tempAudio(),
      mode: 'dictation',
      config: { apiKey: 'k' },
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcribeBody?.speaker_labels).toBe(false);
  });

  it('throws when AssemblyAI returns status=error', async () => {
    const httpClient = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript') {
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({
        id: 'tr',
        status: 'error',
        error: 'audio file is too short',
      });
    });

    await expect(
      transcribeWithAssemblyAi({
        audioPath: await tempAudio(),
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
        pollIntervalMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/audio file is too short/);
  });

  it('throws when upload returns non-2xx', async () => {
    const httpClient = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(
      transcribeWithAssemblyAi({
        audioPath: await tempAudio(),
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/AssemblyAI upload: 403/);
  });

  it('passes word_boost when provided', async () => {
    let transcribeBody: Record<string, unknown> | undefined;
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        transcribeBody = JSON.parse(init.body as string);
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({ id: 'tr', status: 'completed', text: '', utterances: [] });
    });

    await transcribeWithAssemblyAi({
      audioPath: await tempAudio(),
      mode: 'ambient',
      config: { apiKey: 'k' },
      wordBoost: ['amoxicillin', 'tympanic membrane'],
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcribeBody?.word_boost).toEqual(['amoxicillin', 'tympanic membrane']);
  });
});
```

- [ ] **Step 3.2: Verify they fail**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm --filter @brtlb/pipeline test
```

Expected: 5 new failures.

- [ ] **Step 3.3: Write the implementation**

Create `packages/pipeline/src/transcription/assemblyai.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { TranscribeInput, Transcript, Utterance } from '../types';

interface AssemblyAiUtterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

interface AssemblyAiTranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
  utterances?: AssemblyAiUtterance[];
}

const BASE = 'https://api.assemblyai.com/v2';

export interface TranscribeOptions extends TranscribeInput {
  /** Polling interval between status checks. Default 3000 ms. */
  pollIntervalMs?: number;
  /** Injectable for tests. Default: setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Override clock (used only for diagnostics, not flow control). */
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function expectOk(res: Response, step: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`AssemblyAI ${step}: ${res.status} ${body}`);
}

async function uploadAudio(http: typeof fetch, apiKey: string, audioPath: string): Promise<string> {
  const data = await readFile(audioPath);
  const res = await http(`${BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });
  await expectOk(res, 'upload');
  const json = (await res.json()) as { upload_url: string };
  return json.upload_url;
}

async function requestTranscript(
  http: typeof fetch,
  apiKey: string,
  audioUrl: string,
  speakerLabels: boolean,
  wordBoost?: string[],
): Promise<string> {
  const body: Record<string, unknown> = {
    audio_url: audioUrl,
    speaker_labels: speakerLabels,
  };
  if (wordBoost && wordBoost.length > 0) body.word_boost = wordBoost;

  const res = await http(`${BASE}/transcript`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  await expectOk(res, 'request');
  const json = (await res.json()) as AssemblyAiTranscriptResponse;
  return json.id;
}

async function pollTranscript(
  http: typeof fetch,
  apiKey: string,
  id: string,
  intervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<AssemblyAiTranscriptResponse> {
  for (;;) {
    const res = await http(`${BASE}/transcript/${id}`, {
      headers: { Authorization: apiKey },
    });
    await expectOk(res, 'poll');
    const json = (await res.json()) as AssemblyAiTranscriptResponse;
    if (json.status === 'completed') return json;
    if (json.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${json.error ?? 'unknown error'}`);
    }
    await sleep(intervalMs);
  }
}

function toUtterance(u: AssemblyAiUtterance): Utterance {
  return {
    speakerId: u.speaker,
    role: null,
    startMs: u.start,
    endMs: u.end,
    text: u.text,
    confidence: u.confidence,
  };
}

export async function transcribeWithAssemblyAi(input: TranscribeOptions): Promise<Transcript> {
  const http = input.httpClient ?? globalThis.fetch;
  const sleep = input.sleep ?? defaultSleep;
  const intervalMs = input.pollIntervalMs ?? 3000;
  const speakerLabels = input.mode === 'ambient';

  const audioUrl = await uploadAudio(http, input.config.apiKey, input.audioPath);
  const id = await requestTranscript(
    http,
    input.config.apiKey,
    audioUrl,
    speakerLabels,
    input.wordBoost,
  );
  const final = await pollTranscript(http, input.config.apiKey, id, intervalMs, sleep);

  return {
    id,
    recordingId: '',
    utterances: (final.utterances ?? []).map(toUtterance),
    createdAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 3.4: Verify tests pass**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm --filter @brtlb/pipeline test
```

Expected: 5 new + 7 + 3 = 15 passing.

- [ ] **Step 3.5: Uncomment the `transcribeWithAssemblyAi` export**

Edit `packages/pipeline/src/index.ts` and uncomment that line.

- [ ] **Step 3.6: Format, lint, typecheck, commit**

```bash
cd /Users/dochobbs/Downloads/Consult/pedsdpc/brtlb
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add AssemblyAI client with diarization + word_boost"
```

---

## Task 4: Anthropic adapter

**Files:**

- Create: `packages/pipeline/src/adapters/anthropic.ts`
- Test: `packages/pipeline/src/adapters/anthropic.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `createAnthropicProvider`)

The adapter is a thin wrapper around `@anthropic-ai/sdk`. It exposes a `LlmProvider` whose `generateNote` calls `composeNotePrompt`, sends one user message to `messages.create`, and returns the response text.

**Default model** in tests: `claude-sonnet-4-6`. **Default `maxTokens`**: 4096.

The adapter accepts an optional `client?: Anthropic` for tests to inject a stub. The factory uses `new Anthropic({ apiKey })` when no client is passed.

- [ ] **Step 4.1: Write failing tests**

Create `packages/pipeline/src/adapters/anthropic.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic';
import type { GenerateNoteInput } from '../types';

function input(): GenerateNoteInput {
  return {
    transcript: {
      id: 't',
      recordingId: 'r',
      utterances: [
        {
          speakerId: 'A',
          role: 'parent',
          startMs: 0,
          endMs: 1000,
          text: 'fever',
          confidence: 0.9,
        },
      ],
      createdAt: '2026-04-26T00:00:00Z',
    },
    template: { id: 'soap', name: 'SOAP', description: '', promptBody: 'Generate a SOAP note.' },
    pattern: {
      id: 'narrative',
      name: 'Narrative',
      description: '',
      promptModifier: 'Use prose.',
    },
    mode: 'ambient',
    speakerRoles: [],
  };
}

describe('createAnthropicProvider', () => {
  it('exposes name "anthropic"', () => {
    const provider = createAnthropicProvider({
      kind: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
    });
    expect(provider.name).toBe('anthropic');
  });

  it('calls messages.create with the composed prompt and returns the text response', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Generated SOAP note here.' }],
    });
    const provider = createAnthropicProvider(
      {
        kind: 'anthropic',
        apiKey: 'k',
        model: 'claude-sonnet-4-6',
        maxTokens: 2048,
      },
      { client: { messages: { create } } as never },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('Generated SOAP note here.');
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]![0];
    expect(args.model).toBe('claude-sonnet-4-6');
    expect(args.max_tokens).toBe(2048);
    expect(args.messages).toEqual([
      { role: 'user', content: expect.stringContaining('Generate a SOAP note.') },
    ]);
    expect(args.messages[0].content).toContain('[Parent] fever');
  });

  it('concatenates multiple text blocks in the response', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' },
      ],
    });
    const provider = createAnthropicProvider(
      { kind: 'anthropic', apiKey: 'k', model: 'm' },
      { client: { messages: { create } } as never },
    );
    const note = await provider.generateNote(input());
    expect(note).toBe('Part one. Part two.');
  });

  it('uses default maxTokens of 4096 when not specified', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const provider = createAnthropicProvider(
      { kind: 'anthropic', apiKey: 'k', model: 'm' },
      { client: { messages: { create } } as never },
    );
    await provider.generateNote(input());
    expect(create.mock.calls[0]![0].max_tokens).toBe(4096);
  });
});
```

- [ ] **Step 4.2: Verify they fail**

```bash
pnpm --filter @brtlb/pipeline test
```

Expected: 4 new failures.

- [ ] **Step 4.3: Write the implementation**

Create `packages/pipeline/src/adapters/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicProviderConfig, GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface AnthropicAdapterDeps {
  client?: Pick<Anthropic, 'messages'>;
}

export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  deps: AnthropicAdapterDeps = {},
): LlmProvider {
  const client = deps.client ?? new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const parts: string[] = [];
      for (const block of response.content) {
        if (block.type === 'text') parts.push(block.text);
      }
      return parts.join('');
    },
  };
}
```

- [ ] **Step 4.4: Verify tests pass**

```bash
pnpm --filter @brtlb/pipeline test
```

Expected: 4 new + 15 = 19 passing.

- [ ] **Step 4.5: Uncomment export, format, lint, typecheck, commit**

```bash
# uncomment the createAnthropicProvider export in src/index.ts
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add Anthropic adapter via @anthropic-ai/sdk"
```

---

## Task 5: OpenAI-compatible adapter

**Files:**

- Create: `packages/pipeline/src/adapters/openai-compatible.ts`
- Test: `packages/pipeline/src/adapters/openai-compatible.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `createOpenAiCompatibleProvider`)

Same shape as the Anthropic adapter, but uses the `openai` SDK with `chat.completions.create`. Supports a custom `baseURL` so it works with OpenAI proper, Azure OpenAI, OpenRouter, local Ollama, vLLM, etc.

- [ ] **Step 5.1: Write failing tests**

Create `packages/pipeline/src/adapters/openai-compatible.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { GenerateNoteInput } from '../types';

function input(): GenerateNoteInput {
  return {
    transcript: {
      id: 't',
      recordingId: 'r',
      utterances: [
        {
          speakerId: 'A',
          role: 'patient',
          startMs: 0,
          endMs: 1000,
          text: 'cough',
          confidence: 0.9,
        },
      ],
      createdAt: '2026-04-26T00:00:00Z',
    },
    template: { id: 't', name: 'T', description: '', promptBody: 'Generate.' },
    pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Bullet points.' },
    mode: 'ambient',
    speakerRoles: [],
  };
}

describe('createOpenAiCompatibleProvider', () => {
  it('name is "openai-compatible"', () => {
    const provider = createOpenAiCompatibleProvider({
      kind: 'openai-compatible',
      apiKey: 'k',
      model: 'gpt-4o',
    });
    expect(provider.name).toBe('openai-compatible');
  });

  it('calls chat.completions.create with composed prompt as a user message', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK note' } }],
    });
    const provider = createOpenAiCompatibleProvider(
      {
        kind: 'openai-compatible',
        apiKey: 'k',
        model: 'gpt-4o',
        maxTokens: 1000,
      },
      { client: { chat: { completions: { create } } } as never },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('OK note');
    const args = create.mock.calls[0]![0];
    expect(args.model).toBe('gpt-4o');
    expect(args.max_tokens).toBe(1000);
    expect(args.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('cough'),
    });
  });

  it('returns empty string when message content is null', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const provider = createOpenAiCompatibleProvider(
      { kind: 'openai-compatible', apiKey: 'k', model: 'm' },
      { client: { chat: { completions: { create } } } as never },
    );
    expect(await provider.generateNote(input())).toBe('');
  });
});
```

- [ ] **Step 5.2: Run, expect 3 new failures**

- [ ] **Step 5.3: Write `packages/pipeline/src/adapters/openai-compatible.ts`**

```ts
import OpenAI from 'openai';
import type { GenerateNoteInput, LlmProvider, OpenAiCompatibleProviderConfig } from '../types';
import { composeNotePrompt } from '../prompts/compose';

export interface OpenAiAdapterDeps {
  client?: Pick<OpenAI, 'chat'>;
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
  deps: OpenAiAdapterDeps = {},
): LlmProvider {
  const client =
    deps.client ??
    new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });

  return {
    name: 'openai-compatible',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const first = response.choices[0]?.message.content;
      return first ?? '';
    },
  };
}
```

- [ ] **Step 5.4: Verify tests pass (22 total)**

- [ ] **Step 5.5: Uncomment export, commit**

```bash
# uncomment in src/index.ts
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add OpenAI-compatible adapter (configurable baseURL)"
```

---

## Task 6: Gemini Vertex adapter

**Files:**

- Create: `packages/pipeline/src/adapters/gemini-vertex.ts`
- Test: `packages/pipeline/src/adapters/gemini-vertex.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `createGeminiVertexProvider`)

Vertex auth flow:

1. Parse `serviceAccountJson` (a string containing the JSON file).
2. Use `google-auth-library` `JWT` or `GoogleAuth` to obtain an access token scoped to `https://www.googleapis.com/auth/cloud-platform`.
3. POST to `https://{location}-aiplatform.googleapis.com/v1/projects/{projectId}/locations/{location}/publishers/google/models/{model}:generateContent` with `Authorization: Bearer <token>` and a JSON body containing the prompt.

Vertex `generateContent` request body:

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "<composed prompt>" }] }]
}
```

Response: `{ candidates: [{ content: { parts: [{ text: "..." }] } }] }`. Concatenate all text parts of the first candidate.

Inject both the auth client and the http client for tests.

- [ ] **Step 6.1: Write failing tests**

Create `packages/pipeline/src/adapters/gemini-vertex.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGeminiVertexProvider } from './gemini-vertex';
import type { GenerateNoteInput } from '../types';

function input(): GenerateNoteInput {
  return {
    transcript: {
      id: 't',
      recordingId: 'r',
      utterances: [
        {
          speakerId: 'A',
          role: 'parent',
          startMs: 0,
          endMs: 500,
          text: 'rash',
          confidence: 0.9,
        },
      ],
      createdAt: '2026-04-26T00:00:00Z',
    },
    template: { id: 't', name: 'T', description: '', promptBody: 'SOAP.' },
    pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Brief.' },
    mode: 'ambient',
    speakerRoles: [],
  };
}

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'test-proj',
  private_key_id: 'k',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-proj.iam.gserviceaccount.com',
  client_id: '0',
  token_uri: 'https://oauth2.googleapis.com/token',
});

describe('createGeminiVertexProvider', () => {
  it('name is "gemini-vertex"', () => {
    const provider = createGeminiVertexProvider({
      kind: 'gemini-vertex',
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      projectId: 'test-proj',
      location: 'us-central1',
      model: 'gemini-2.0-pro',
    });
    expect(provider.name).toBe('gemini-vertex');
  });

  it('calls Vertex generateContent with composed prompt and bearer token', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'ya29.fake' });
    let receivedUrl = '';
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const httpClient = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = url.toString();
      receivedHeaders = (init?.headers ?? {}) as Record<string, string>;
      receivedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Vertex SOAP output.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'test-proj',
        location: 'us-central1',
        model: 'gemini-2.0-pro',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    const note = await provider.generateNote(input());

    expect(note).toBe('Vertex SOAP output.');
    expect(receivedUrl).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-proj/locations/us-central1/publishers/google/models/gemini-2.0-pro:generateContent',
    );
    expect(receivedHeaders.Authorization).toBe('Bearer ya29.fake');
    expect(receivedBody).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: expect.stringContaining('rash') }],
        },
      ],
    });
  });

  it('throws on non-2xx vertex response', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 't' });
    const httpClient = vi.fn(
      async () =>
        new Response('quota exceeded', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        }),
    ) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'p',
        location: 'us-central1',
        model: 'm',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    await expect(provider.generateNote(input())).rejects.toThrow(/429/);
  });

  it('concatenates multiple text parts of the first candidate', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 't' });
    const httpClient = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'A. ' }, { text: 'B.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const provider = createGeminiVertexProvider(
      {
        kind: 'gemini-vertex',
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        projectId: 'p',
        location: 'us-central1',
        model: 'm',
      },
      { authClient: { getAccessToken } as never, httpClient },
    );

    expect(await provider.generateNote(input())).toBe('A. B.');
  });
});
```

- [ ] **Step 6.2: Run, expect 4 new failures**

- [ ] **Step 6.3: Write `packages/pipeline/src/adapters/gemini-vertex.ts`**

```ts
import { JWT } from 'google-auth-library';
import type { GeminiVertexProviderConfig, GenerateNoteInput, LlmProvider } from '../types';
import { composeNotePrompt } from '../prompts/compose';

interface VertexAuthClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

export interface GeminiVertexAdapterDeps {
  authClient?: VertexAuthClient;
  httpClient?: typeof fetch;
}

interface VertexResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function buildAuthClient(serviceAccountJson: string): VertexAuthClient {
  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };
  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

export function createGeminiVertexProvider(
  config: GeminiVertexProviderConfig,
  deps: GeminiVertexAdapterDeps = {},
): LlmProvider {
  const auth = deps.authClient ?? buildAuthClient(config.serviceAccountJson);
  const http = deps.httpClient ?? globalThis.fetch;

  return {
    name: 'gemini-vertex',
    async generateNote(input: GenerateNoteInput): Promise<string> {
      const prompt = composeNotePrompt(input);
      const tokenResponse = await auth.getAccessToken();
      const token = tokenResponse.token;
      if (!token) throw new Error('gemini-vertex: failed to obtain access token');

      const url = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;

      const res = await http(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`gemini-vertex: ${res.status} ${body}`);
      }

      const json = (await res.json()) as VertexResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}
```

- [ ] **Step 6.4: Verify all 26 tests pass**

- [ ] **Step 6.5: Uncomment export, commit**

```bash
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add Gemini Vertex adapter with service-account auth"
```

---

## Task 7: Provider factory

**Files:**

- Create: `packages/pipeline/src/adapters/factory.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `createLlmProvider`)

Discriminated-union dispatch over `ProviderConfig['kind']`. No new test file — coverage comes from the orchestrator integration test in Task 8 plus a tiny smoke test inline in this task. Keeping the factory test in this task's own file is fine too.

- [ ] **Step 7.1: Create `packages/pipeline/src/adapters/factory.ts`**

```ts
import type { LlmProvider, ProviderConfig } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { createGeminiVertexProvider } from './gemini-vertex';

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(config);
    case 'gemini-vertex':
      return createGeminiVertexProvider(config);
  }
}
```

- [ ] **Step 7.2: Add a smoke test**

Append to `packages/pipeline/src/index.test.ts`:

```ts
import { createLlmProvider } from './index';

describe('createLlmProvider', () => {
  it('returns anthropic provider for anthropic config', () => {
    const p = createLlmProvider({
      kind: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
    });
    expect(p.name).toBe('anthropic');
  });

  it('returns openai-compatible provider for openai-compatible config', () => {
    const p = createLlmProvider({
      kind: 'openai-compatible',
      apiKey: 'k',
      model: 'gpt-4o',
    });
    expect(p.name).toBe('openai-compatible');
  });

  it('returns gemini-vertex provider for gemini-vertex config', () => {
    const p = createLlmProvider({
      kind: 'gemini-vertex',
      serviceAccountJson: JSON.stringify({
        client_email: 'x@y.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
      }),
      projectId: 'p',
      location: 'us-central1',
      model: 'gemini-2.0-pro',
    });
    expect(p.name).toBe('gemini-vertex');
  });
});
```

(Add the missing `import { describe, it, expect } from 'vitest';` at the top if not already there.)

- [ ] **Step 7.3: Uncomment `createLlmProvider` export in `src/index.ts`**

- [ ] **Step 7.4: Verify all 29 tests pass**

```bash
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
pnpm --filter @brtlb/pipeline test
git add packages/pipeline
git commit -m "FEATURE(pipeline): add provider factory for discriminated-union config"
```

---

## Task 8: Orchestrator

**Files:**

- Create: `packages/pipeline/src/orchestrator.ts`
- Test: `packages/pipeline/src/orchestrator.test.ts`
- Modify: `packages/pipeline/src/index.ts` (uncomment `runPipeline`)

`runPipeline(input: RunPipelineInput, deps?): Promise<RunPipelineOutput>` glues transcription + generation:

1. Call `transcribeWithAssemblyAi` with `audioPath`, `mode`, AssemblyAI key, `wordBoost`.
2. Set `transcript.recordingId = input.recordingId`.
3. Call `provider.generateNote({transcript, template, pattern, mode, speakerRoles: input.speakerRoles ?? []})`.
4. Return `{transcript, note, providerUsed: input.providerConfig.kind}`.

Deps: optional injected `transcribe?` (defaults to the real AssemblyAI client) and `createProvider?` (defaults to the real factory). This makes orchestrator tests independent of any HTTP.

- [ ] **Step 8.1: Write failing tests**

Create `packages/pipeline/src/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runPipeline } from './orchestrator';
import type { LlmProvider, ProviderConfig, Transcript } from './types';

function fakeTranscript(): Transcript {
  return {
    id: 'tr',
    recordingId: '',
    utterances: [
      {
        speakerId: 'A',
        role: 'parent',
        startMs: 0,
        endMs: 1000,
        text: 'fever',
        confidence: 0.9,
      },
    ],
    createdAt: '2026-04-26T00:00:00Z',
  };
}

const provConfig: ProviderConfig = {
  kind: 'anthropic',
  apiKey: 'k',
  model: 'claude-sonnet-4-6',
};

describe('runPipeline', () => {
  it('runs transcribe then generate, returning both', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('SOAP note text.');
    const provider: LlmProvider = { name: 'anthropic', generateNote };
    const createProvider = vi.fn(() => provider);

    const out = await runPipeline(
      {
        recordingId: 'rec_42',
        audioPath: '/tmp/x.m4a',
        mode: 'ambient',
        template: { id: 'soap', name: 'SOAP', description: '', promptBody: 'Generate.' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'Brief.' },
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
      },
      { transcribe, createProvider },
    );

    expect(out.transcript.recordingId).toBe('rec_42');
    expect(out.note).toBe('SOAP note text.');
    expect(out.providerUsed).toBe('anthropic');

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        audioPath: '/tmp/x.m4a',
        mode: 'ambient',
        config: { apiKey: 'aai' },
      }),
    );

    expect(createProvider).toHaveBeenCalledWith(provConfig);

    expect(generateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.objectContaining({ recordingId: 'rec_42' }),
        speakerRoles: [],
      }),
    );
  });

  it('passes through speakerRoles when provided', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('ok');
    const createProvider = vi.fn(() => ({ name: 'anthropic', generateNote }));

    await runPipeline(
      {
        recordingId: 'r',
        audioPath: '/tmp/a.m4a',
        mode: 'ambient',
        template: { id: 't', name: 'T', description: '', promptBody: 'g' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'p' },
        speakerRoles: [{ speakerId: 'A', role: 'parent' }],
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
      },
      { transcribe, createProvider },
    );

    expect(generateNote.mock.calls[0]![0].speakerRoles).toEqual([
      { speakerId: 'A', role: 'parent' },
    ]);
  });

  it('passes wordBoost down to transcribe', async () => {
    const transcribe = vi.fn().mockResolvedValue(fakeTranscript());
    const generateNote = vi.fn().mockResolvedValue('ok');
    const createProvider = vi.fn(() => ({ name: 'anthropic', generateNote }));

    await runPipeline(
      {
        recordingId: 'r',
        audioPath: '/tmp/a.m4a',
        mode: 'ambient',
        template: { id: 't', name: 'T', description: '', promptBody: 'g' },
        pattern: { id: 'p', name: 'P', description: '', promptModifier: 'p' },
        providerConfig: provConfig,
        assemblyAi: { apiKey: 'aai' },
        wordBoost: ['amoxicillin'],
      },
      { transcribe, createProvider },
    );

    expect(transcribe.mock.calls[0]![0].wordBoost).toEqual(['amoxicillin']);
  });
});
```

- [ ] **Step 8.2: Verify they fail (3 new)**

- [ ] **Step 8.3: Write `packages/pipeline/src/orchestrator.ts`**

```ts
import type {
  LlmProvider,
  ProviderConfig,
  RunPipelineInput,
  RunPipelineOutput,
  TranscribeOptions,
  Transcript,
} from './types';
import { transcribeWithAssemblyAi } from './transcription/assemblyai';
import { createLlmProvider } from './adapters/factory';

export interface RunPipelineDeps {
  transcribe?: (input: TranscribeOptions) => Promise<Transcript>;
  createProvider?: (config: ProviderConfig) => LlmProvider;
}

export async function runPipeline(
  input: RunPipelineInput,
  deps: RunPipelineDeps = {},
): Promise<RunPipelineOutput> {
  const transcribe = deps.transcribe ?? transcribeWithAssemblyAi;
  const createProvider = deps.createProvider ?? createLlmProvider;

  const transcribed = await transcribe({
    audioPath: input.audioPath,
    mode: input.mode,
    config: input.assemblyAi,
    wordBoost: input.wordBoost,
  });
  const transcript: Transcript = { ...transcribed, recordingId: input.recordingId };

  const provider = createProvider(input.providerConfig);
  const note = await provider.generateNote({
    transcript,
    template: input.template,
    pattern: input.pattern,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });

  return {
    transcript,
    note,
    providerUsed: input.providerConfig.kind,
  };
}
```

You may need to export `TranscribeOptions` from `./transcription/assemblyai` and re-export from `./types` (or import directly here). Either path is fine; pick the one that keeps `types.ts` as the source of truth for shared shapes and importable from `./transcription/assemblyai` at the type level.

- [ ] **Step 8.4: Verify 32 tests pass**

- [ ] **Step 8.5: Uncomment final export, format, lint, typecheck, commit**

```bash
pnpm format
pnpm --filter @brtlb/pipeline typecheck
pnpm --filter @brtlb/pipeline lint
git add packages/pipeline
git commit -m "FEATURE(pipeline): add orchestrator that runs transcribe + generate end-to-end"
```

---

## Task 9: Phase 2 docs and handoff

**Files:**

- Create: `packages/pipeline/README.md`
- Modify: `docs/superpowers/plans/README.md` (Phase 2 → Complete; mark Phase 3 → Pending)
- Modify: root `README.md` (status line: "Phase 1 + Brand v0.1 + Phase 2 (pipeline core)")

- [ ] **Step 9.1: Create `packages/pipeline/README.md`**

```markdown
# @brtlb/pipeline

Node-side pipeline for brtlb: AssemblyAI transcription with diarization, plus
three foundation-model adapters behind a common `LlmProvider` interface.

## Public surface

- `composeNotePrompt(input)` — pure function: template + pattern + transcript → prompt string
- `transcribeWithAssemblyAi(options)` — upload + request + poll via AssemblyAI
- `createAnthropicProvider(config, deps?)` — Anthropic SDK adapter
- `createOpenAiCompatibleProvider(config, deps?)` — OpenAI/Azure/OpenRouter/Ollama-compatible
- `createGeminiVertexProvider(config, deps?)` — Vertex AI with service-account JWT auth
- `createLlmProvider(config)` — discriminated-union factory over `ProviderConfig`
- `runPipeline(input, deps?)` — full audio-in → note-out

## Usage

\`\`\`ts
import { runPipeline } from '@brtlb/pipeline';
import { getTemplate, getPattern } from '@brtlb/prompts';

const out = await runPipeline({
recordingId: 'rec_001',
audioPath: '/tmp/visit.m4a',
mode: 'ambient',
template: getTemplate('soap')!,
pattern: getPattern('narrative')!,
providerConfig: {
kind: 'gemini-vertex',
serviceAccountJson: serviceAccountJsonString,
projectId: 'lakes-ped',
location: 'us-central1',
model: 'gemini-2.0-pro',
},
assemblyAi: { apiKey: process.env.ASSEMBLYAI_KEY! },
});

console.log(out.note);
console.log(out.transcript.utterances.length, 'utterances');
\`\`\`

## Testing

All HTTP and SDK calls are mocked. No real network in tests. Run:

\`\`\`bash
pnpm --filter @brtlb/pipeline test
\`\`\`

Real-key smoke tests live in the Phase 8 onboarding wizard, not here.
```

(In the actual file, replace `\`\`\`` with three real backticks.)

- [ ] **Step 9.2: Update `docs/superpowers/plans/README.md`**

Find the table row for Phase 2 and change `Pending` to `Complete`.

- [ ] **Step 9.3: Update root `README.md`**

Find the line that says `Status: **Phase 1 (foundation) complete.**` and change it to `Status: **Phase 1 + Brand v0.1 + Phase 2 (pipeline core) complete.**`. Adjust the rest of that paragraph as needed.

- [ ] **Step 9.4: Format and commit**

```bash
pnpm format
git add packages/pipeline/README.md docs/superpowers/plans/README.md README.md
git commit -m "DOCS: phase 2 readme + plans status"
```

---

## Self-Review Notes

- **Spec coverage:** Sections 4 (pipeline), 5 (diarization), 6 (modes), 7 (templates+patterns), 8 (adapters) are all implemented. Section 4's "first-pass note → user reviews → optional regenerate" loop is a UI flow; only the orchestrator API (`runPipeline` accepts updated `speakerRoles` per call) is in scope here.
- **Type consistency:** Every shape used across files is defined in `types.ts` and re-exported from `index.ts`. Adapter factories take their corresponding `ProviderConfig` variant; the factory dispatches by `kind`.
- **Placeholders:** None. Every step has either complete code or a precise command + expected output. The only deferred behavior — backward-compat handling of older `index.test.ts` — is addressed inline in Task 1 by commenting out forward-looking exports until each task uncomments its own.
- **Test isolation:** Adapter tests inject SDK clients via the `deps` parameter; AssemblyAI tests inject a mock `httpClient` and a no-op `sleep`; orchestrator tests inject `transcribe` and `createProvider`. No real HTTP, no SDK initialization side effects.
- **Bundle implications:** `@anthropic-ai/sdk`, `openai`, and `google-auth-library` are heavy compared to the Phase 1 footprint. The browser/Capacitor shells will eat them when wired in Phase 4. If bundle size becomes a problem, the Anthropic/OpenAI SDKs can be replaced with raw fetch calls (their wire formats are simple). Note this risk; don't fix it preemptively.

---

## Done Criteria

- [ ] `pnpm install --frozen-lockfile` succeeds with three new SDK deps
- [ ] `pnpm --filter @brtlb/pipeline test` shows 32 passing tests
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check` all green from the repo root
- [ ] `pnpm --filter @brtlb/web build` still succeeds (no UI changes, but the workspace must stay buildable)
- [ ] CI green on the PR
- [ ] Phase 3 (encrypted storage) can begin with a clean checkout and import every public symbol from `@brtlb/pipeline` without surprises
