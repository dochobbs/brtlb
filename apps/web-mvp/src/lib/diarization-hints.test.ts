import { describe, expect, it } from 'vitest';
import {
  computeDiarizationHints,
  summarizeTranscriptSpeakers,
  type ComputeDiarizationHintsInput,
} from './diarization-hints';

/** Helper: build hint input mirroring real fixtures from
 * eval-fixtures/diarization-validation/. Keeps the test cases dense. */
function fixture(
  partial: Partial<ComputeDiarizationHintsInput> & {
    utterancesBySpeaker: Record<string, number>;
  },
): ComputeDiarizationHintsInput {
  const counts = new Map<string, number>(Object.entries(partial.utterancesBySpeaker));
  return {
    transcriptSpeakerIds: [...counts.keys()].sort(),
    utteranceCountBySpeaker: counts,
    speakersExpectedHint: partial.speakersExpectedHint ?? 4,
    identifiedPatientCount: partial.identifiedPatientCount ?? 1,
    keptSpeakers: partial.keptSpeakers ?? [],
    rawIdentifySpeakers: partial.rawIdentifySpeakers ?? [],
  };
}

describe('computeDiarizationHints', () => {
  // === Banner 1 triggers ===

  it('fires lowSpeakerCount when AAI returned ≥2 fewer than the hint (behavioral-anxiety case)', () => {
    // Real eval fixture: hint=4, AAI returned 2 (mom merged into child).
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 26, B: 25 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.85 },
        ],
      }),
    );
    expect(hints.lowSpeakerCount).toBe(true);
  });

  it('does NOT fire lowSpeakerCount when AAI returned hint - 1 (3 detected vs hint 4)', () => {
    // Real fixture: adhd-med-check / wcv-multi-concern. 3 detected, hint 4.
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 25, B: 23, C: 5 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
          { speakerId: 'C', role: 'patient' },
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
          { speakerId: 'C', role: 'patient', confidence: 0.7 },
        ],
      }),
    );
    expect(hints.lowSpeakerCount).toBe(false);
  });

  it('fires lowSpeakerCount via patientsFloor when ≥2 patients identified but speakers < patients+1', () => {
    // Synthetic: 3 patients identified, only 2 speakers detected (extreme collapse).
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 20, B: 20 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 3,
      }),
    );
    expect(hints.lowSpeakerCount).toBe(true);
  });

  it('does NOT fire patientsFloor on single-patient visits with 2 speakers (normal phone/solo)', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 30, B: 25 },
        speakersExpectedHint: 0, // no hint sent (e.g., phone mode)
        identifiedPatientCount: 1,
      }),
    );
    expect(hints.lowSpeakerCount).toBe(false);
  });

  // === Banner 2 triggers ===

  it('flags collapse via low_conf when identify returned a speaker with conf < 0.6 (substantive)', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 20, B: 15 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [{ speakerId: 'A', role: 'provider' }],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.45 },
        ],
      }),
    );
    expect(hints.collapseSuspected).toContainEqual({ speakerId: 'B', reason: 'low_conf' });
  });

  it('flags collapse via silent omit when transcript has a substantive speaker identify ignored', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 20, B: 15, C: 8 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
          // C is completely missing
        ],
      }),
    );
    expect(hints.collapseSuspected).toContainEqual({ speakerId: 'C', reason: 'omitted' });
  });

  it('flags collapse via "other"-with-substance (stress-same-gender case)', () => {
    // Real fixture: stress-sibling-same-gender. Speaker D returned as
    // role="other" with 8 utterances → 2nd girl merged into a misc cluster.
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 27, B: 17, C: 4, D: 8 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 3,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
          { speakerId: 'C', role: 'patient' },
          { speakerId: 'D', role: 'other' },
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
          { speakerId: 'C', role: 'patient', confidence: 0.8 },
          { speakerId: 'D', role: 'other', confidence: 0.9 },
        ],
      }),
    );
    expect(hints.collapseSuspected).toContainEqual({
      speakerId: 'D',
      reason: 'other_role_substantive',
    });
  });

  it('does NOT flag filler-only speakers (< 3 utterances)', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 20, B: 15, C: 1, D: 2 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
          // C and D omitted by identify; both filler-only → ignore
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
        ],
      }),
    );
    expect(hints.collapseSuspected).toEqual([]);
  });

  it('does NOT flag a brief "other" cameo (1-2 utterances)', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 25, B: 20, C: 5, D: 2 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 1,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
          { speakerId: 'C', role: 'patient' },
          { speakerId: 'D', role: 'other' }, // MA cameo
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
          { speakerId: 'C', role: 'patient', confidence: 0.7 },
          { speakerId: 'D', role: 'other', confidence: 0.6 },
        ],
      }),
    );
    expect(hints.collapseSuspected).toEqual([]);
  });

  // === Clean cases — no banner fires ===

  it('clean 4-speaker sibling visit produces no hints', () => {
    const hints = computeDiarizationHints(
      fixture({
        utterancesBySpeaker: { A: 23, B: 20, C: 2, D: 3 },
        speakersExpectedHint: 4,
        identifiedPatientCount: 3,
        keptSpeakers: [
          { speakerId: 'A', role: 'provider' },
          { speakerId: 'B', role: 'parent' },
          { speakerId: 'C', role: 'patient' },
          { speakerId: 'D', role: 'patient' },
        ],
        rawIdentifySpeakers: [
          { speakerId: 'A', role: 'provider', confidence: 0.95 },
          { speakerId: 'B', role: 'parent', confidence: 0.95 },
          { speakerId: 'C', role: 'patient', confidence: 0.9 },
          { speakerId: 'D', role: 'patient', confidence: 0.9 },
        ],
      }),
    );
    expect(hints.lowSpeakerCount).toBe(false);
    expect(hints.collapseSuspected).toEqual([]);
  });
});

describe('summarizeTranscriptSpeakers', () => {
  it('counts utterances per speaker and returns sorted unique ids', () => {
    const summary = summarizeTranscriptSpeakers([
      { speakerId: 'B' },
      { speakerId: 'A' },
      { speakerId: 'B' },
      { speakerId: 'A' },
      { speakerId: 'B' },
    ]);
    expect(summary.transcriptSpeakerIds).toEqual(['A', 'B']);
    expect(summary.utteranceCountBySpeaker.get('A')).toBe(2);
    expect(summary.utteranceCountBySpeaker.get('B')).toBe(3);
  });

  it('skips utterances with empty speakerId', () => {
    const summary = summarizeTranscriptSpeakers([
      { speakerId: 'A' },
      { speakerId: '' },
      { speakerId: 'A' },
    ]);
    expect(summary.transcriptSpeakerIds).toEqual(['A']);
    expect(summary.utteranceCountBySpeaker.get('A')).toBe(2);
  });
});
