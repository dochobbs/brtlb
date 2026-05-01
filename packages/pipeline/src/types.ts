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

export interface NoteBookmark {
  /** Milliseconds from the start of the recording. */
  ms: number;
  /** Optional short label dictated by the physician. */
  label?: string | null;
}

export interface GenerateNoteInput {
  transcript: Transcript;
  template: NoteTemplate;
  pattern: NotePattern;
  mode: RecordingMode;
  speakerRoles: SpeakerRoleAssignment[];
  /** Physician-tapped moments during recording. Surfaced as context for the LLM. */
  bookmarks?: NoteBookmark[];
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

export interface GeminiApiKeyProviderConfig {
  kind: 'gemini-api-key';
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
}

export type ProviderConfig =
  | AnthropicProviderConfig
  | OpenAiCompatibleProviderConfig
  | GeminiVertexProviderConfig
  | GeminiApiKeyProviderConfig;

// --- AssemblyAI ---

export interface AssemblyAiConfig {
  apiKey: string;
  /**
   * If true, fire DELETE /v2/transcript/{id} after successfully pulling the
   * completed transcript. Cuts vendor retention from days (per AssemblyAI's
   * default policy) to seconds. Best-effort: failures are logged but don't
   * break the pipeline.
   */
  deleteOnCompletion?: boolean;
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
