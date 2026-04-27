import {
  composeNotePrompt,
  createAnthropicProvider,
  createOpenAiCompatibleProvider,
  transcribeBlobWithAssemblyAi,
  type GenerateNoteInput,
  type LlmProvider,
  type RecordingMode,
  type Transcript,
} from '@brtlb/pipeline';
import { getPattern, getTemplate } from '@brtlb/prompts';
import type { Settings } from '../store';

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
  providerUsed: 'anthropic' | 'openai-compatible';
}

function buildProvider(settings: Settings): {
  provider: LlmProvider;
  kind: 'anthropic' | 'openai-compatible';
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

// Re-export composeNotePrompt for tests / dev tooling
export { composeNotePrompt };
