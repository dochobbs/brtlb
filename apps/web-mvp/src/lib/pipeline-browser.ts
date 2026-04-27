import {
  composeNotePrompt,
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
  transcribeBlobWithAssemblyAi,
  type GenerateNoteInput,
  type LlmProvider,
  type RecordingMode,
  type Transcript,
} from '@brtlb/pipeline';
import { getPattern, getTemplate } from '@brtlb/prompts';
import type { ProviderKind, Settings } from '../store';

export type PipelineStage = 'uploading' | 'transcribing' | 'generating' | 'done' | 'failed';

export interface RunMvpPipelineInput {
  audio: Blob;
  mode: RecordingMode;
  settings: Settings;
  onStage?: (stage: PipelineStage) => void;
  templateId?: string;
  patternId?: string;
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

export async function runMvpPipeline(input: RunMvpPipelineInput): Promise<RunMvpPipelineOutput> {
  const templateId = input.templateId ?? 'soap';
  const patternId = input.patternId ?? 'narrative';
  const template = getTemplate(templateId);
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
    speakerRoles: [],
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
  const template = getTemplate(input.templateId);
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
    speakerRoles: [],
  };
  const note = await provider.generateNote(noteInput);
  return { note, providerUsed: kind };
}

// Re-export composeNotePrompt for tests / dev tooling
export { composeNotePrompt };
