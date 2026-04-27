import type {
  LlmProvider,
  ProviderConfig,
  RunPipelineInput,
  RunPipelineOutput,
  Transcript,
} from './types';
import type { TranscribeOptions } from './transcription/assemblyai';
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
