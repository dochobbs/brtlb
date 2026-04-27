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

const QA_REVIEW_PROMPT_HEADER = `You are a clinical QA reviewer checking whether a pediatric note accurately reflects a transcript.
Your job is to flag only concrete, clinically meaningful risks supported by the transcript.

REVIEW PRIORITIES:
1. Findings, vitals, diagnoses, or exam details that are NOT supported by the transcript (possible hallucination).
2. Mixed-visit collapse, especially well-child + acute visits reduced to only the sick problem.
3. Major concerns discussed in the transcript that are missing from the note.
4. Major assessment/plan mismatch with the discussed problem.
5. Wrong-patient or sibling-contamination risk if the note appears to describe a different child than the encounter is about.

RULES:
- Be conservative. Do not nitpick style.
- Only report issues that are supported by the transcript or obvious from the note itself.
- If there are no meaningful issues, return exactly: "No issues found."
- Max 5 issues.

OUTPUT — markdown bullet list, with one of these prefixes per issue:
- 🔴 Critical: safety-relevant fabrications or major missing content.
- 🟡 Warning: less-severe risks.
- ⚪ Info: minor concerns or style notes.

Each bullet should be one short sentence. Cite the relevant excerpt from the note or transcript when concrete.`;

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
