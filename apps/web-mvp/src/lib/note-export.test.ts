import { describe, expect, it } from 'vitest';
import {
  MULTI_PATIENT_SEPARATOR,
  splitConcatenatedMultiPatientNote,
  spliceMultiPatientNote,
  splitNoteIntoSections,
} from './note-export';

describe('splitNoteIntoSections', () => {
  it('returns empty array for empty input', () => {
    expect(splitNoteIntoSections('')).toEqual([]);
  });

  it('splits hash-style headings', () => {
    const md = '## HPI\n4yo M with ear pain\n\n## Plan\n- Amox';
    const sections = splitNoteIntoSections(md);
    expect(sections.map((s) => s.label)).toEqual(['HPI', 'Plan']);
    expect(sections[0]?.body).toContain('4yo M');
  });

  it('splits bold-style headings', () => {
    const md = '**HPI**\nKid with cough\n\n**Plan**\n- Watchful waiting';
    const sections = splitNoteIntoSections(md);
    expect(sections.map((s) => s.label)).toEqual(['HPI', 'Plan']);
  });

  it('drops sections with no body', () => {
    const md = '## HPI\n\n## Plan\nbody here';
    const sections = splitNoteIntoSections(md);
    expect(sections.map((s) => s.label)).toEqual(['Plan']);
  });
});

describe('splitConcatenatedMultiPatientNote', () => {
  const segments = [
    { id: 'p0', patientLabel: 'Tommy', visitType: 'sick' },
    { id: 'p1', patientLabel: 'Lily', visitType: 'well_child' },
  ];

  it('splits a 2-patient note on the separator', () => {
    const note = `## Tommy · Sick\n\nbody1${MULTI_PATIENT_SEPARATOR}## Lily · Well Child\n\nbody2`;
    const chunks = splitConcatenatedMultiPatientNote(note, segments);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.id).toBe('p0');
    expect(chunks[0]?.label).toBe('Tommy');
    expect(chunks[0]?.body).toContain('## Tommy');
    expect(chunks[1]?.id).toBe('p1');
    expect(chunks[1]?.body).toContain('## Lily');
  });

  it('returns [] for single-patient (caller renders combined)', () => {
    expect(splitConcatenatedMultiPatientNote('## Solo\n\nbody', [segments[0]!])).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(splitConcatenatedMultiPatientNote('', segments)).toEqual([]);
    expect(splitConcatenatedMultiPatientNote('   ', segments)).toEqual([]);
  });

  it('returns [] when chunk count does not match segment count (corrupt note)', () => {
    // 3 chunks but 2 segments — fall back to combined rather than dropping content
    const note = `a${MULTI_PATIENT_SEPARATOR}b${MULTI_PATIENT_SEPARATOR}c`;
    expect(splitConcatenatedMultiPatientNote(note, segments)).toEqual([]);
  });
});

describe('spliceMultiPatientNote', () => {
  const note = `## Tommy · Sick\n\nbody1${MULTI_PATIENT_SEPARATOR}## Lily · WCV\n\nbody2${MULTI_PATIENT_SEPARATOR}## Max · WCV\n\nbody3`;

  it('replaces the middle segment without disturbing siblings', () => {
    const out = spliceMultiPatientNote(note, 1, '## Lily · WCV\n\nNEW BODY');
    expect(out).toContain('body1');
    expect(out).toContain('NEW BODY');
    expect(out).toContain('body3');
    expect(out).not.toContain('body2');
  });

  it('replaces the first segment', () => {
    const out = spliceMultiPatientNote(note, 0, 'NEW FIRST');
    expect(out.startsWith('NEW FIRST')).toBe(true);
    expect(out).toContain('body2');
    expect(out).toContain('body3');
  });

  it('returns the new body as-is for single-patient (no separator)', () => {
    const single = '## Solo\n\nbody';
    expect(spliceMultiPatientNote(single, 0, 'replaced')).toBe('replaced');
  });

  it('is a no-op for out-of-range index', () => {
    expect(spliceMultiPatientNote(note, 99, 'oops')).toBe(note);
    expect(spliceMultiPatientNote(note, -1, 'oops')).toBe(note);
  });
});
