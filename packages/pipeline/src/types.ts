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
