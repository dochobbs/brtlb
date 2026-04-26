# brtlb — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the brtlb monorepo with all package and app skeletons in place, every workspace lintable/testable/buildable, and the web/electron/mobile shells each launching an empty placeholder. No product features yet — this phase exists so every later phase has a clean place to slot work into.

**Architecture:** pnpm workspace + Turborepo monorepo. Three apps (`web`, `electron`, `mobile`) consume four shared packages (`pipeline`, `db`, `ui`, `prompts`). Web is the source of truth; electron loads the web build; Capacitor wraps the web build for iOS and Android. Strict TypeScript everywhere, Vitest for unit tests, ESLint + Prettier, GitHub Actions CI.

**Tech Stack:** pnpm 9, Turborepo 2, TypeScript 5.5, React 19, Vite 6, Tailwind v4, Vitest 2, ESLint 9, Prettier 3, Capacitor 6, Electron 30.

**Repo:** `~/Downloads/Consult/pedsdpc/brtlb` (already git-init'd on `main`, initial design-spec commit `5c97a92`).

---

## File Structure for Phase 1

```
brtlb/
├── .github/workflows/ci.yml
├── .editorconfig
├── .nvmrc
├── .prettierrc.json
├── eslint.config.js
├── package.json                    # root, manages workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
│
├── apps/
│   ├── web/
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.cjs
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── index.css
│   │   │   └── App.test.tsx
│   │   └── public/
│   │
│   ├── electron/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── electron-builder.yml
│   │   └── src/
│   │       ├── main.ts
│   │       └── preload.ts
│   │
│   └── mobile/
│       ├── package.json
│       ├── capacitor.config.ts
│       └── README.md               # how to add ios/ and android/
│
├── packages/
│   ├── pipeline/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # exports interface stubs
│   │   │   ├── types.ts
│   │   │   └── index.test.ts
│   │
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── schema.ts           # CREATE TABLE strings
│   │   │   └── schema.test.ts
│   │
│   ├── ui/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── Button.tsx
│   │   │   └── Button.test.tsx
│   │
│   └── prompts/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── templates/
│       │   │   └── soap.json
│       │   ├── patterns/
│       │   │   └── narrative.json
│       │   └── index.test.ts
│
└── docs/
    ├── superpowers/
    │   ├── specs/2026-04-26-brtlb-design.md
    │   └── plans/2026-04-26-phase-1-foundation.md
    └── user-guides/.gitkeep
```

---

## Task 1: Workspace Tooling Baseline

**Files:**
- Create: `.nvmrc`
- Create: `.editorconfig`
- Create: `.prettierrc.json`
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1.1: Create `.nvmrc`**

```
20.11.1
```

- [ ] **Step 1.2: Create `.editorconfig`**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 1.3: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 1.4: Create root `package.json`**

```json
{
  "name": "brtlb",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.11.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,css}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md,css}\""
  },
  "devDependencies": {
    "prettier": "^3.3.3",
    "turbo": "^2.1.3",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 1.5: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 1.6: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 1.7: Install root deps and verify pnpm sees workspaces**

Run:
```bash
cd ~/Downloads/Consult/pedsdpc/brtlb
pnpm install
pnpm list --depth -1
```

Expected: pnpm installs prettier, turbo, typescript at the root with no errors. `pnpm list` shows them.

- [ ] **Step 1.8: Commit**

```bash
git add .
git commit -m "CHORE: scaffold pnpm + turborepo workspace baseline"
```

---

## Task 2: Turbo Pipeline Config

**Files:**
- Create: `turbo.json`

- [ ] **Step 2.1: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 2.2: Verify turbo can enumerate the (still-empty) graph**

Run:
```bash
pnpm exec turbo run build --dry-run
```

Expected: turbo prints "no tasks to run" or similar with no errors. (No packages have build scripts yet.)

- [ ] **Step 2.3: Commit**

```bash
git add turbo.json
git commit -m "CHORE: add turborepo pipeline config"
```

---

## Task 3: ESLint Flat Config

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 3.1: Add ESLint deps to root `package.json`**

Edit root `package.json` `devDependencies` to add:

```json
"@eslint/js": "^9.12.0",
"eslint": "^9.12.0",
"eslint-plugin-react": "^7.37.1",
"eslint-plugin-react-hooks": "^5.0.0",
"globals": "^15.11.0",
"typescript-eslint": "^8.8.1"
```

Then run: `pnpm install`

- [ ] **Step 3.2: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
```

- [ ] **Step 3.3: Verify lint runs cleanly on the empty repo**

Run: `pnpm exec eslint . --max-warnings 0`

Expected: exits 0 (nothing to lint yet).

- [ ] **Step 3.4: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "CHORE: add eslint flat config for ts/tsx"
```

---

## Task 4: `packages/pipeline` Skeleton with Interface Stubs

**Files:**
- Create: `packages/pipeline/package.json`
- Create: `packages/pipeline/tsconfig.json`
- Create: `packages/pipeline/src/types.ts`
- Create: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/src/index.test.ts`

This package will hold the AssemblyAI client and LLM adapters in Phase 2. Phase 1 just defines the interface shapes so other packages can `import type { ... }` from it.

- [ ] **Step 4.1: Write the failing test**

Create `packages/pipeline/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PIPELINE_VERSION, isLlmProvider } from './index';

describe('@brtlb/pipeline', () => {
  it('exports a version constant', () => {
    expect(PIPELINE_VERSION).toBe('0.1.0');
  });

  it('isLlmProvider type guard accepts a minimal provider', () => {
    const provider = {
      name: 'mock',
      generateNote: async () => 'note text',
    };
    expect(isLlmProvider(provider)).toBe(true);
  });

  it('isLlmProvider type guard rejects junk', () => {
    expect(isLlmProvider(null)).toBe(false);
    expect(isLlmProvider({})).toBe(false);
    expect(isLlmProvider({ name: 'x' })).toBe(false);
  });
});
```

- [ ] **Step 4.2: Create `packages/pipeline/package.json`**

```json
{
  "name": "@brtlb/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 4.3: Create `packages/pipeline/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4.4: Create `packages/pipeline/src/types.ts`**

```ts
export type RecordingMode = 'ambient' | 'dictation';

export type SpeakerRole =
  | 'parent'
  | 'patient'
  | 'provider'
  | 'sibling'
  | 'other';

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

export interface GenerateNoteInput {
  transcript: Transcript;
  template: NoteTemplate;
  pattern: NotePattern;
  mode: RecordingMode;
}

export interface LlmProvider {
  readonly name: string;
  generateNote(input: GenerateNoteInput): Promise<string>;
}
```

- [ ] **Step 4.5: Create `packages/pipeline/src/index.ts`**

```ts
export * from './types';
import type { LlmProvider } from './types';

export const PIPELINE_VERSION = '0.1.0';

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
```

- [ ] **Step 4.6: Install pipeline deps**

Run: `pnpm install`

Expected: vitest installed under `packages/pipeline/node_modules` (or hoisted).

- [ ] **Step 4.7: Run the test, expect PASS**

Run: `pnpm --filter @brtlb/pipeline test`

Expected: 3 passing tests.

- [ ] **Step 4.8: Commit**

```bash
git add packages/pipeline pnpm-lock.yaml
git commit -m "FEATURE(pipeline): scaffold package with LlmProvider interface"
```

---

## Task 5: `packages/db` Skeleton with Schema Strings

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/src/schema.test.ts`

Phase 1 only defines the schema as plain SQL strings. Actual SQLite/SQLCipher integration lands in Phase 3.

- [ ] **Step 5.1: Write the failing test**

Create `packages/db/src/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, TABLES } from './index';

describe('@brtlb/db schema', () => {
  it('declares a schema version', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('defines the core tables', () => {
    const names = TABLES.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'recordings',
        'transcripts',
        'utterances',
        'notes',
        'speaker_role_assignments',
        'settings',
      ]),
    );
  });

  it('every table has a CREATE TABLE statement', () => {
    for (const t of TABLES) {
      expect(t.createSql).toMatch(/^CREATE TABLE/i);
      expect(t.createSql).toContain(t.name);
    }
  });
});
```

- [ ] **Step 5.2: Create `packages/db/package.json`**

```json
{
  "name": "@brtlb/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 5.3: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5.4: Create `packages/db/src/schema.ts`**

```ts
export interface TableDef {
  name: string;
  createSql: string;
}

export const TABLES: TableDef[] = [
  {
    name: 'recordings',
    createSql: `CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      audio_path TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('ambient', 'dictation')),
      status TEXT NOT NULL,
      error_message TEXT
    );`,
  },
  {
    name: 'transcripts',
    createSql: `CREATE TABLE transcripts (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      assemblyai_id TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
  },
  {
    name: 'utterances',
    createSql: `CREATE TABLE utterances (
      id TEXT PRIMARY KEY,
      transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      speaker_id TEXT NOT NULL,
      role TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL
    );`,
  },
  {
    name: 'notes',
    createSql: `CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      provider_used TEXT NOT NULL,
      generated_text TEXT NOT NULL,
      edited_text TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
  },
  {
    name: 'speaker_role_assignments',
    createSql: `CREATE TABLE speaker_role_assignments (
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      speaker_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (recording_id, speaker_id)
    );`,
  },
  {
    name: 'settings',
    createSql: `CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_provider TEXT,
      gemini_config_json TEXT,
      anthropic_config_json TEXT,
      openai_compatible_config_json TEXT,
      assemblyai_key_encrypted TEXT,
      audio_purge_days INTEGER NOT NULL DEFAULT 7,
      default_template_id TEXT,
      default_pattern_id TEXT,
      letterhead_html TEXT,
      lock_policy TEXT NOT NULL DEFAULT 'after_5_min'
    );`,
  },
];
```

- [ ] **Step 5.5: Create `packages/db/src/index.ts`**

```ts
export * from './schema';
export const SCHEMA_VERSION = 1;
```

- [ ] **Step 5.6: Install + run test**

Run:
```bash
pnpm install
pnpm --filter @brtlb/db test
```

Expected: 3 passing tests.

- [ ] **Step 5.7: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "FEATURE(db): scaffold schema strings for v1 tables"
```

---

## Task 6: `packages/prompts` Skeleton with Initial SOAP Template

**Files:**
- Create: `packages/prompts/package.json`
- Create: `packages/prompts/tsconfig.json`
- Create: `packages/prompts/src/templates/soap.json`
- Create: `packages/prompts/src/patterns/narrative.json`
- Create: `packages/prompts/src/index.ts`
- Test: `packages/prompts/src/index.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `packages/prompts/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listTemplates, listPatterns, getTemplate, getPattern } from './index';

describe('@brtlb/prompts', () => {
  it('lists at least one template and pattern', () => {
    expect(listTemplates().length).toBeGreaterThanOrEqual(1);
    expect(listPatterns().length).toBeGreaterThanOrEqual(1);
  });

  it('exposes a SOAP template with a non-empty prompt body', () => {
    const t = getTemplate('soap');
    expect(t).toBeDefined();
    expect(t?.name).toBe('SOAP');
    expect(t?.promptBody.length).toBeGreaterThan(50);
  });

  it('exposes a narrative pattern', () => {
    const p = getPattern('narrative');
    expect(p).toBeDefined();
    expect(p?.name).toBe('Narrative');
  });

  it('returns undefined for unknown ids', () => {
    expect(getTemplate('nope')).toBeUndefined();
    expect(getPattern('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Create `packages/prompts/package.json`**

```json
{
  "name": "@brtlb/prompts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 6.3: Create `packages/prompts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 6.4: Create `packages/prompts/src/templates/soap.json`**

```json
{
  "id": "soap",
  "name": "SOAP",
  "description": "Standard SOAP note (Subjective, Objective, Assessment, Plan).",
  "promptBody": "You are a pediatric clinical scribe. Generate a SOAP note from the diarized transcript below. Sections: Subjective, Objective, Assessment, Plan. Attribute statements to the speaker roles provided. Use precise, professional clinical language. Do not invent vital signs or exam findings that were not stated. If a section has no relevant content from the transcript, write 'Not addressed during this visit.'"
}
```

- [ ] **Step 6.5: Create `packages/prompts/src/patterns/narrative.json`**

```json
{
  "id": "narrative",
  "name": "Narrative",
  "description": "Flowing prose paragraphs rather than bullet lists.",
  "promptModifier": "Write each section as flowing narrative prose, not bullet points. Use full sentences and natural transitions."
}
```

- [ ] **Step 6.6: Create `packages/prompts/src/index.ts`**

```ts
import soapTemplate from './templates/soap.json' with { type: 'json' };
import narrativePattern from './patterns/narrative.json' with { type: 'json' };

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

const templates: ReadonlyArray<NoteTemplate> = [soapTemplate as NoteTemplate];
const patterns: ReadonlyArray<NotePattern> = [narrativePattern as NotePattern];

export function listTemplates(): ReadonlyArray<NoteTemplate> {
  return templates;
}

export function listPatterns(): ReadonlyArray<NotePattern> {
  return patterns;
}

export function getTemplate(id: string): NoteTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export function getPattern(id: string): NotePattern | undefined {
  return patterns.find((p) => p.id === id);
}
```

- [ ] **Step 6.7: Run test**

Run:
```bash
pnpm install
pnpm --filter @brtlb/prompts test
```

Expected: 4 passing tests.

- [ ] **Step 6.8: Commit**

```bash
git add packages/prompts pnpm-lock.yaml
git commit -m "FEATURE(prompts): scaffold templates/patterns with initial SOAP+narrative"
```

---

## Task 7: `packages/ui` Skeleton with One Shared Component

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/Button.tsx`
- Create: `packages/ui/src/index.ts`
- Test: `packages/ui/src/Button.test.tsx`

- [ ] **Step 7.1: Write the failing test**

Create `packages/ui/src/Button.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('fires onClick', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(<Button onClick={() => clicks++}>Tap</Button>);
    await user.click(screen.getByRole('button', { name: 'Tap' }));
    expect(clicks).toBe(1);
  });

  it('respects disabled', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button disabled onClick={() => clicks++}>
        No
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(clicks).toBe(0);
  });
});
```

- [ ] **Step 7.2: Create `packages/ui/package.json`**

```json
{
  "name": "@brtlb/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 7.3: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 7.4: Create `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 7.5: Create `packages/ui/src/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function Button({ children, className, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ' +
    'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <button className={[base, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}
```

- [ ] **Step 7.6: Create `packages/ui/src/index.ts`**

```ts
export { Button } from './Button';
export type { ButtonProps } from './Button';
```

- [ ] **Step 7.7: Run test**

Run:
```bash
pnpm install
pnpm --filter @brtlb/ui test
```

Expected: 3 passing tests in jsdom.

- [ ] **Step 7.8: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "FEATURE(ui): scaffold shared component library with Button"
```

---

## Task 8: `apps/web` — React + Vite + Tailwind Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.cjs`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/index.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 8.1: Write the failing test**

Create `apps/web/src/App.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the brtlb wordmark', () => {
    render(<App />);
    expect(screen.getByText('brtlb')).toBeDefined();
  });

  it('renders the placeholder tagline', () => {
    render(<App />);
    expect(
      screen.getByText(/pediatric ai scribe/i),
    ).toBeDefined();
  });
});
```

- [ ] **Step 8.2: Create `apps/web/package.json`**

```json
{
  "name": "@brtlb/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 5180",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brtlb/pipeline": "workspace:*",
    "@brtlb/prompts": "workspace:*",
    "@brtlb/ui": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.2",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^4.0.0-alpha.30",
    "vite": "^6.0.0",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 8.3: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 8.4: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 8.5: Create `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 8.6: Create `apps/web/postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 8.7: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>brtlb</title>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8.8: Create `apps/web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8.9: Create `apps/web/src/App.tsx`**

```tsx
import { Button } from '@brtlb/ui';

export function App() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-4xl font-semibold tracking-tight">brtlb</h1>
      <p className="text-slate-600">Pediatric AI scribe — coming soon.</p>
      <Button onClick={() => console.log('hello brtlb')}>Test Button</Button>
    </main>
  );
}
```

- [ ] **Step 8.10: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8.11: Install + run test**

Run:
```bash
pnpm install
pnpm --filter @brtlb/web test
```

Expected: 2 passing tests.

- [ ] **Step 8.12: Verify dev server starts**

Run (in foreground for ~5 sec, then Ctrl-C):
```bash
pnpm --filter @brtlb/web dev
```

Expected: Vite reports `Local: http://localhost:5180/` and serves the page without errors. Visit it in a browser to confirm "brtlb" wordmark renders. Stop the server.

- [ ] **Step 8.13: Verify production build**

Run:
```bash
pnpm --filter @brtlb/web build
```

Expected: `apps/web/dist/index.html` and asset bundles produced, no TypeScript errors.

- [ ] **Step 8.14: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "FEATURE(web): scaffold React + Vite + Tailwind shell"
```

---

## Task 9: `apps/electron` — Desktop Shell that Loads `apps/web`

**Files:**
- Create: `apps/electron/package.json`
- Create: `apps/electron/tsconfig.json`
- Create: `apps/electron/electron-builder.yml`
- Create: `apps/electron/src/main.ts`
- Create: `apps/electron/src/preload.ts`

No TDD here — this is purely a glue shell. Verification is "it launches and shows the web app." Tests for IPC bridges land in later phases when there's something to bridge.

- [ ] **Step 9.1: Create `apps/electron/package.json`**

```json
{
  "name": "@brtlb/electron",
  "version": "0.0.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "pnpm build && electron .",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "package": "pnpm build && electron-builder"
  },
  "dependencies": {
    "@brtlb/web": "workspace:*"
  },
  "devDependencies": {
    "electron": "^32.1.2",
    "electron-builder": "^25.0.5"
  }
}
```

- [ ] **Step 9.2: Create `apps/electron/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "verbatimModuleSyntax": false
  },
  "include": ["src"]
}
```

- [ ] **Step 9.3: Create `apps/electron/electron-builder.yml`**

```yaml
appId: com.brtlb.app
productName: brtlb
directories:
  output: dist-pkg
files:
  - dist/**/*
  - "../../apps/web/dist/**/*"
mac:
  category: public.app-category.medical
  target: dmg
win:
  target: nsis
linux:
  target: AppImage
```

- [ ] **Step 9.4: Create `apps/electron/src/preload.ts`**

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('brtlb', {
  platform: process.platform,
  versions: process.versions,
});
```

- [ ] **Step 9.5: Create `apps/electron/src/main.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const isDev = !app.isPackaged;

function resolveWebIndex(): string {
  const built = join(__dirname, '..', '..', 'web', 'dist', 'index.html');
  if (existsSync(built)) return built;
  throw new Error(
    'apps/web/dist/index.html not found. Run `pnpm --filter @brtlb/web build` first.',
  );
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.BRTLB_DEV_URL) {
    await win.loadURL(process.env.BRTLB_DEV_URL);
  } else {
    await win.loadFile(resolveWebIndex());
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 9.6: Build the web app first, then launch Electron**

Run:
```bash
pnpm install
pnpm --filter @brtlb/web build
pnpm --filter @brtlb/electron build
```

Expected: both produce `dist/` folders with no errors.

- [ ] **Step 9.7: Smoke-launch electron**

Run (foreground, close the window when verified):
```bash
pnpm --filter @brtlb/electron dev
```

Expected: an Electron window opens showing the brtlb wordmark and "Pediatric AI scribe — coming soon." Close the window.

- [ ] **Step 9.8: Commit**

```bash
git add apps/electron pnpm-lock.yaml
git commit -m "FEATURE(electron): scaffold desktop shell loading apps/web build"
```

---

## Task 10: `apps/mobile` — Capacitor Config Skeleton

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/capacitor.config.ts`
- Create: `apps/mobile/README.md`

The mobile app reuses the `apps/web` build as its WebView content. Phase 1 only stages the Capacitor config and documents the one-time `npx cap add ios|android` step. Actual native projects (`apps/mobile/ios/` and `apps/mobile/android/`) are gitignored until Phase 9 when we tune them.

- [ ] **Step 10.1: Create `apps/mobile/package.json`**

```json
{
  "name": "@brtlb/mobile",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "sync": "cap sync",
    "open:ios": "cap open ios",
    "open:android": "cap open android",
    "lint": "echo 'no lintable sources at this stage'",
    "typecheck": "echo 'no typecheckable sources at this stage'"
  },
  "dependencies": {
    "@brtlb/web": "workspace:*",
    "@capacitor/android": "^6.1.2",
    "@capacitor/core": "^6.1.2",
    "@capacitor/ios": "^6.1.2"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.1.2"
  }
}
```

- [ ] **Step 10.2: Create `apps/mobile/capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.brtlb.app',
  appName: 'brtlb',
  webDir: '../web/dist',
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
```

- [ ] **Step 10.3: Create `apps/mobile/README.md`**

```markdown
# @brtlb/mobile

Capacitor wrapper around `apps/web`. The native iOS and Android projects are
generated by Capacitor CLI and not committed in Phase 1.

## One-time setup (per developer machine)

Build the web app first so Capacitor has something to copy:

```bash
pnpm --filter @brtlb/web build
```

Then add the platforms:

```bash
cd apps/mobile
pnpm exec cap add ios
pnpm exec cap add android
```

Capacitor will create `apps/mobile/ios/` and `apps/mobile/android/`. These
directories are gitignored in Phase 1 — the native shells get committed in
Phase 9 once we have permission entries, splash screens, and signing configured.

## Running

```bash
pnpm --filter @brtlb/web build
pnpm --filter @brtlb/mobile sync
pnpm --filter @brtlb/mobile open:ios       # opens Xcode
pnpm --filter @brtlb/mobile open:android   # opens Android Studio
```
```

- [ ] **Step 10.4: Add mobile native dirs to `.gitignore`**

Append to root `.gitignore` (these lines may already exist; ensure they do):

```
# Capacitor native shells (added in Phase 9)
apps/mobile/ios/
apps/mobile/android/
```

(If already present from the initial `.gitignore`, leave it.)

- [ ] **Step 10.5: Install**

Run: `pnpm install`

Expected: Capacitor packages install. No build/run yet — those are Phase 9.

- [ ] **Step 10.6: Commit**

```bash
git add apps/mobile .gitignore pnpm-lock.yaml
git commit -m "FEATURE(mobile): scaffold capacitor config; native shells deferred to Phase 9"
```

---

## Task 11: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 11.1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read .nvmrc
        id: nvm
        run: echo "version=$(cat .nvmrc)" >> "$GITHUB_OUTPUT"

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.nvm.outputs.version }}

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
          run_install: false

      - name: Get pnpm store directory
        shell: bash
        run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

      - uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: ${{ runner.os }}-pnpm-store-

      - run: pnpm install --frozen-lockfile

      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @brtlb/web build
      - run: pnpm --filter @brtlb/electron build
```

- [ ] **Step 11.2: Run the same commands locally to confirm CI will pass**

Run:
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @brtlb/web build
pnpm --filter @brtlb/electron build
```

Expected: every step exits 0. If `format:check` fails, run `pnpm format` and re-run.

- [ ] **Step 11.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "CI: add GitHub Actions workflow for lint/typecheck/test/build"
```

---

## Task 12: Docs Polish + Phase Handoff Notes

**Files:**
- Modify: `README.md`
- Create: `docs/user-guides/.gitkeep`
- Create: `docs/superpowers/plans/README.md`

- [ ] **Step 12.1: Replace `README.md`**

```markdown
# brtlb

A pediatric-focused, BYO-keys AI scribe for desktop and mobile.

- **Diarization-first** ambient documentation
- **Bring your own** AssemblyAI key + foundation model (Gemini / Anthropic / OpenAI-compatible)
- **Local-only**, encrypted at rest — PHI never leaves the device
- **Cross-platform** via Capacitor (iOS, Android) + Electron (Mac, Windows, Linux)

Status: **Phase 1 (foundation) complete.** No product features yet.

## Repo layout

| Path | Purpose |
|---|---|
| `apps/web` | React + Vite app — the product |
| `apps/electron` | Desktop shell |
| `apps/mobile` | Capacitor config (native shells generated locally, see its README) |
| `packages/pipeline` | LLM adapter interface + future AssemblyAI client |
| `packages/db` | Schema strings + future SQLCipher wrapper |
| `packages/ui` | Shared React components |
| `packages/prompts` | Versioned templates and patterns |
| `docs/superpowers/specs` | Design specs |
| `docs/superpowers/plans` | Phased implementation plans |
| `docs/user-guides` | API key setup walkthroughs (filled in Phase 8) |

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
```

- [ ] **Step 12.2: Create `docs/user-guides/.gitkeep`** (empty file so the directory is tracked)

```
```

- [ ] **Step 12.3: Create `docs/superpowers/plans/README.md`**

```markdown
# brtlb Implementation Plans

Phased rollout. Each phase produces working, testable software on its own.

| Phase | Plan | Status |
|---|---|---|
| 1 | [Foundation](2026-04-26-phase-1-foundation.md) | In progress |
| 2 | Pipeline core (LLM adapters + AssemblyAI) | Pending |
| 3 | Encrypted storage (SQLCipher) | Pending |
| 4 | Recording UX | Pending |
| 5 | Review & edit UX | Pending |
| 6 | Templates & patterns UX | Pending |
| 7 | Share & export | Pending |
| 8 | Onboarding & settings | Pending |
| 9 | Mobile shell finalization | Pending |
| 10 | Desktop shell finalization | Pending |
```

- [ ] **Step 12.4: Final commit**

```bash
git add README.md docs/
git commit -m "DOCS: phase 1 readme + plans index"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 only):** This plan covers spec sections 13 (cross-platform architecture), 14 (tech stack), 15 (repo layout), and the schema portion of section 16. Sections on the actual pipeline, recording, review, share, onboarding, and security features are scheduled for later phases — that's by design and listed in `docs/superpowers/plans/README.md`.
- **Type consistency:** `LlmProvider`, `NoteTemplate`, `NotePattern`, `Utterance`, `Transcript`, `RecordingMode`, `SpeakerRole` are defined once in `packages/pipeline/src/types.ts` and re-exported. The `prompts` package has a local `NoteTemplate` / `NotePattern` shape that intentionally matches the pipeline's so JSON files validate against either. Phase 2 will consolidate.
- **Placeholders:** none. Every step has either complete code or an exact command + expected output.
- **No-test scaffolding:** Tasks 9 (electron) and 10 (mobile) skip TDD because the Phase 1 deliverable is "the shell launches" — there's no logic to test until later phases give them work to do. Verification is a manual smoke launch.

---

## Done Criteria

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` all green
- [ ] `pnpm --filter @brtlb/web dev` serves the brtlb placeholder at `http://localhost:5180`
- [ ] `pnpm --filter @brtlb/electron dev` opens an Electron window showing the same placeholder
- [ ] CI workflow runs green on push to `main`
- [ ] Phase 2 plan can begin with a clean `pnpm install` and find every interface stub it needs
