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
  it('puts template body + pattern modifier in system; mode in user', () => {
    const { system, user } = composeNotePrompt(input());
    expect(system).toContain('Generate a SOAP note.');
    expect(system).toContain('Use bullet points.');
    expect(system).toContain('DOCUMENTATION DISCIPLINE');
    expect(user).toContain('Recording mode: ambient');
    expect(user).not.toContain('Generate a SOAP note.');
    expect(user).not.toContain('DOCUMENTATION DISCIPLINE');
  });

  it('puts transcript content in user, not in system', () => {
    const { system, user } = composeNotePrompt(input());
    expect(user).toContain('fever for two days');
    expect(system).not.toContain('fever for two days');
  });

  it('renders unlabeled speakers as [Speaker A], [Speaker B] in user', () => {
    const { user } = composeNotePrompt(
      input({
        transcript: transcript([
          utterance({ speakerId: 'A', text: 'one' }),
          utterance({ speakerId: 'B', text: 'two' }),
        ]),
      }),
    );
    expect(user).toContain('[Speaker A] one');
    expect(user).toContain('[Speaker B] two');
  });

  it('uses speakerRoles when provided, capitalizing role names', () => {
    const { user } = composeNotePrompt(
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
    expect(user).toContain('[Parent] fever');
    expect(user).toContain('[Provider] how high');
  });

  it('falls back to Utterance.role when speakerRoles is empty', () => {
    const { user } = composeNotePrompt(
      input({
        transcript: transcript([utterance({ speakerId: 'A', role: 'patient', text: 'hi' })]),
        speakerRoles: [],
      }),
    );
    expect(user).toContain('[Patient] hi');
  });

  it('speakerRoles wins over Utterance.role', () => {
    const { user } = composeNotePrompt(
      input({
        transcript: transcript([utterance({ speakerId: 'A', role: 'patient', text: 'hi' })]),
        speakerRoles: [{ speakerId: 'A', role: 'parent' }],
      }),
    );
    expect(user).toContain('[Parent] hi');
    expect(user).not.toContain('[Patient]');
  });

  it('emits "Recording mode: dictation" in the user message for dictation mode', () => {
    const { user } = composeNotePrompt(input({ mode: 'dictation' }));
    expect(user).toContain('Recording mode: dictation');
  });

  it('preserves utterance order in the user message', () => {
    const { user } = composeNotePrompt(
      input({
        transcript: transcript([
          utterance({ speakerId: 'A', text: 'first' }),
          utterance({ speakerId: 'B', text: 'second' }),
          utterance({ speakerId: 'A', text: 'third' }),
        ]),
      }),
    );
    const positions = ['first', 'second', 'third'].map((s) => user.indexOf(s));
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
  });
});
