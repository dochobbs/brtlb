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
