import {
  composeNotePrompt,
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
  transcribeBlobWithAssemblyAi,
  type GenerateNoteInput,
  type LlmProvider,
  type NoteTemplate,
  type RecordingMode,
  type SpeakerRoleAssignment,
  type Transcript,
} from '@brtlb/pipeline';
import { getPattern, getTemplate } from '@brtlb/prompts';
import type { ProviderKind, Settings } from '../store';
import { PEDIATRIC_WORD_BOOST } from './peds-vocabulary';

export type PipelineStage = 'uploading' | 'transcribing' | 'generating' | 'done' | 'failed';

export interface RunMvpPipelineInput {
  audio: Blob;
  mode: RecordingMode;
  settings: Settings;
  onStage?: (stage: PipelineStage) => void;
  templateId?: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
}

export interface RunMvpPipelineOutput {
  transcript: Transcript;
  note: string;
  providerUsed: ProviderKind;
}

function buildProvider(settings: Settings): {
  provider: LlmProvider;
  kind: ProviderKind;
} {
  if (settings.provider === 'anthropic') {
    return {
      provider: createAnthropicProvider({
        kind: 'anthropic',
        apiKey: settings.anthropicApiKey,
        model: settings.anthropicModel,
      }),
      kind: 'anthropic',
    };
  }
  if (settings.provider === 'gemini-api-key') {
    return {
      provider: createGeminiApiKeyProvider({
        kind: 'gemini-api-key',
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
      }),
      kind: 'gemini-api-key',
    };
  }
  return {
    provider: createOpenAiCompatibleProvider({
      kind: 'openai-compatible',
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      ...(settings.openaiBaseUrl ? { baseUrl: settings.openaiBaseUrl } : {}),
    }),
    kind: 'openai-compatible',
  };
}

function resolveTemplate(
  id: string,
  customTemplates: readonly {
    id: string;
    name: string;
    description?: string;
    promptBody: string;
  }[],
): NoteTemplate | undefined {
  const builtin = getTemplate(id);
  if (builtin) return builtin;
  const custom = customTemplates.find((t) => t.id === id);
  if (!custom) return undefined;
  return {
    id: custom.id,
    name: custom.name,
    description: custom.description ?? '',
    promptBody: custom.promptBody,
  };
}

export async function runMvpPipeline(input: RunMvpPipelineInput): Promise<RunMvpPipelineOutput> {
  const templateId = input.templateId ?? 'soap';
  const patternId = input.patternId ?? 'narrative';
  const template = resolveTemplate(templateId, input.settings.customTemplates);
  const pattern = getPattern(patternId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  if (!pattern) throw new Error(`Unknown pattern: ${patternId}`);

  input.onStage?.('uploading');
  let transcript: Transcript;
  try {
    transcript = await transcribeBlobWithAssemblyAi({
      audio: input.audio,
      mode: input.mode,
      config: { apiKey: input.settings.assemblyAiKey },
      wordBoost: [...PEDIATRIC_WORD_BOOST],
    });
    input.onStage?.('transcribing');
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  input.onStage?.('generating');
  const { provider, kind } = buildProvider(input.settings);
  const noteInput: GenerateNoteInput = {
    transcript,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      promptBody: template.promptBody,
    },
    pattern: {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      promptModifier: pattern.promptModifier,
    },
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  };

  let note: string;
  try {
    note = await provider.generateNote(noteInput);
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  input.onStage?.('done');
  return { transcript, note, providerUsed: kind };
}

export interface RegenerateNoteInput {
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  templateId: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
}

export interface RegenerateNoteOutput {
  note: string;
  providerUsed: ProviderKind;
}

/**
 * Re-run only the LLM step against an existing transcript with a (possibly
 * different) template. Skips AssemblyAI entirely — no extra transcription
 * cost, no need to keep the audio.
 */
export async function regenerateNoteFromTranscript(
  input: RegenerateNoteInput,
): Promise<RegenerateNoteOutput> {
  const template = resolveTemplate(input.templateId, input.settings.customTemplates);
  const pattern = getPattern(input.patternId ?? 'narrative');
  if (!template) throw new Error(`Unknown template: ${input.templateId}`);
  if (!pattern) throw new Error(`Unknown pattern: ${input.patternId}`);

  const { provider, kind } = buildProvider(input.settings);
  const noteInput: GenerateNoteInput = {
    transcript: input.transcript,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      promptBody: template.promptBody,
    },
    pattern: {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      promptModifier: pattern.promptModifier,
    },
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  };
  const note = await provider.generateNote(noteInput);
  return { note, providerUsed: kind };
}

const NEUTRAL_PATTERN = {
  id: 'plain',
  name: 'Plain',
  description: 'No additional style modifier.',
  promptModifier: '',
};

const QA_REVIEW_PROMPT_HEADER = `You are a clinical QA reviewer checking whether a pediatric note accurately reflects the transcript.
Your job is to flag concrete, clinically meaningful risks of HALLUCINATION (note says something the transcript doesn't support) and OMISSION (note misses something the transcript clearly addresses).

REVIEW PRIORITIES (in order):
1. HALLUCINATION — findings, vitals, diagnoses, history, exam details, or plan items in the note that are NOT supported by the transcript.
2. OMISSION — concerns, symptoms, exam findings, or plan items clearly discussed in the transcript that are MISSING from the note.
3. MIXED-VISIT COLLAPSE — preventive + acute visits reduced to only the sick problem (or only the well-child portion).
4. ASSESSMENT/PLAN MISMATCH — the assessment or plan doesn't match the chief complaint or what was actually discussed.
5. WRONG-PATIENT RISK — the note appears to describe a different child than the encounter (sibling contamination, name drift).

RULES:
- Be conservative. Do not nitpick style or wording.
- Only report issues supported by the transcript or obvious from the note itself.
- Prefer omission over fabrication when in doubt — but flag both equally when concrete.
- If there are no meaningful issues, return exactly: "No issues found."
- Max 5 issues.

OUTPUT — markdown bullet list. Each bullet starts with a severity emoji, then a category tag, then a one-sentence explanation. Cite a short excerpt from the note or transcript when it makes the issue concrete.

Severity:
- 🔴 Critical — safety-relevant fabrication, missing red-flag content, wrong patient.
- 🟡 Warning — clinically meaningful but not immediately unsafe.
- ⚪ Info — minor concerns.

Category tags (use exactly one per bullet):
- (possible hallucination)
- (missing from note)
- (mixed-visit collapse)
- (assessment/plan mismatch)
- (wrong patient risk)

Example:
- 🔴 (possible hallucination) Note documents temp 102°F but transcript only mentions "felt warm last night."
- 🟡 (missing from note) Transcript discusses fluoride varnish counseling at length; note has no anticipatory guidance section.`;

const PEARLS_PROMPT_HEADER = `You are a pediatric charting assistant doing a brief pearls pass on a finished note.
Your job is to surface 0–3 short, genuinely useful collegial observations about THIS visit. Pearls are noticing-the-pattern observations a senior colleague might mention in passing — not restatements of the note.

GOOD PEARLS:
- Connect a timing pattern to a likely cause (e.g., "Episodes cluster between Concerta peak and unstructured school time — worth distinguishing pharmacologic activation from environmental triggers.").
- Flag a subtle differential or red-flag worth keeping on the radar.
- Note a parent or family dynamic that affects care without restating exam findings.
- Highlight a useful contextual factor the parent gave that doesn't fit cleanly in HPI but matters.

HARD RULES:
- Be conservative. Better to return an empty list than to invent.
- Do not restate the assessment or plan.
- Do not give generic pediatric advice.
- Do not propose tests, imaging, or referrals — those belong in the plan.
- Each pearl is 1–2 sentences. Plain prose. No labels.
- If there is nothing genuinely useful to add, return exactly: "No pearls."

OUTPUT — markdown bullet list, 0 to 3 bullets, one observation each.`;

export interface ReviewNoteInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style QA pass. Run a separate LLM call whose only job is to flag
 * note-vs-transcript inconsistencies. Cheap (one short reply), high value.
 * Returns markdown — render directly in the UI.
 */
export async function reviewNoteQuality(input: ReviewNoteInput): Promise<string> {
  const reviewTemplate: NoteTemplate = {
    id: 'qa-review',
    name: 'QA Review',
    description: 'Internal — note quality review against the transcript.',
    promptBody: `${QA_REVIEW_PROMPT_HEADER}\n\nNOTE TO REVIEW:\n${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: reviewTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

export interface ClinicalPearlsInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style enrichment pass scoped to clinical pearls only — 0-3 brief
 * collegial observations grounded in the transcript and note. Cheap (one
 * short reply), surfaced after the note in the UI.
 */
export async function generateClinicalPearls(input: ClinicalPearlsInput): Promise<string> {
  const pearlsTemplate: NoteTemplate = {
    id: 'clinical-pearls',
    name: 'Clinical Pearls',
    description: 'Internal — pediatric pearls pass.',
    promptBody: `${PEARLS_PROMPT_HEADER}\n\nNOTE:\n${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: pearlsTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

export interface TweakNoteInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  instruction: string;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style note revision. Take an existing note + the transcript +
 * a free-form physician instruction ("shorten the assessment", "rewrite
 * the plan as a numbered list", "fix the dose to mg/kg") and return a
 * revised note. The transcript still gates fabrication.
 */
export async function tweakNote(input: TweakNoteInput): Promise<string> {
  const tweakTemplate: NoteTemplate = {
    id: 'tweak',
    name: 'Tweak',
    description: 'Internal — physician-directed revision.',
    promptBody: `You are revising an existing pediatric outpatient note based on a physician instruction.
Keep the note faithful to the transcript.

HARD RULES:
- Do not invent history, exam findings, vitals, or diagnoses not supported by the transcript.
- Keep the note scoped to this encounter's primary patient.
- Only make changes that are necessary to satisfy the instruction unless the instruction explicitly says the current note is wrong.
- Preserve sections the instruction does not mention.
- Return the COMPLETE revised note in markdown, not just a diff or the changed section.

PHYSICIAN INSTRUCTION:
${input.instruction}

CURRENT NOTE:
${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: tweakTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

// Re-export composeNotePrompt for tests / dev tooling
export { composeNotePrompt };
