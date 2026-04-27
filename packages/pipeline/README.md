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

```ts
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
```

## Testing

All HTTP and SDK calls are mocked. No real network in tests. Run:

```bash
pnpm --filter @brtlb/pipeline test
```

Real-key smoke tests live in the Phase 8 onboarding wizard, not here.
