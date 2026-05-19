import { describe, expect, it } from 'vitest';
import {
  MULTI_PATIENT_SEPARATOR,
  detectMultiPatientStructureFromNote,
  extractExpectedSections,
  splitConcatenatedMultiPatientNote,
  spliceMultiPatientNote,
  splitNoteIntoSections,
  validateNoteCoverage,
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

describe('detectMultiPatientStructureFromNote', () => {
  it('returns null for empty input', () => {
    expect(detectMultiPatientStructureFromNote('')).toBeNull();
    expect(detectMultiPatientStructureFromNote('   ')).toBeNull();
  });

  it('returns null for single-patient notes (no separator)', () => {
    expect(
      detectMultiPatientStructureFromNote('**HPI**\n4yo with cough\n\n**Plan**\nrest'),
    ).toBeNull();
  });

  it('detects LLM-emitted **Patient: X** headers with *** separators (self-recovery case)', () => {
    const note =
      '**Patient: Anthony**\n\n**HPI**\nWalking pneumonia, azithro started.\n\n***\n\n**Patient: Oliver**\n\n**HPI**\nPharyngitis, swab pending.';
    const result = detectMultiPatientStructureFromNote(note);
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(2);
    expect(result!.chunks[0]?.label).toBe('Anthony');
    expect(result!.chunks[0]?.id).toBe('p0');
    expect(result!.chunks[0]?.body).toContain('Walking pneumonia');
    expect(result!.chunks[1]?.label).toBe('Oliver');
    expect(result!.chunks[1]?.body).toContain('Pharyngitis');
  });

  it('detects canonical ## Name · Visit Type headers with --- separators', () => {
    const note =
      '## Anthony · Sick Visit — cough\n\nbody1\n\n---\n\n## Oliver · Sick Visit — sore throat\n\nbody2';
    const result = detectMultiPatientStructureFromNote(note);
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(2);
    expect(result!.chunks[0]?.label).toBe('Anthony');
    expect(result!.chunks[0]?.visitType).toBe('sick_visit');
    expect(result!.chunks[1]?.label).toBe('Oliver');
  });

  it('returns null when any chunk lacks an identifiable patient header', () => {
    // Two parts separated by ***, but only the first has a recognizable
    // patient header — refuse to misattribute the second.
    const note = '**Patient: Anthony**\n\nbody1\n\n***\n\n**Some Random Header**\n\nbody2';
    expect(detectMultiPatientStructureFromNote(note)).toBeNull();
  });

  it('handles three-patient notes with mixed separator widths', () => {
    const note =
      '**Patient: A**\n\nx\n\n***\n\n**Patient: B**\n\ny\n\n----\n\n**Patient: C**\n\nz';
    const result = detectMultiPatientStructureFromNote(note);
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(3);
    expect(result!.chunks.map((c) => c.label)).toEqual(['A', 'B', 'C']);
  });
});

describe('extractExpectedSections', () => {
  it('parses the canonical section list block from a template', () => {
    const body = `Some instructions.\n\nRETURN MARKDOWN with these sections (omit any not addressed):\n- Chief Complaint\n- HPI\n- ROS\n- Plan\n- Follow-up\n\nMore text after.`;
    expect(extractExpectedSections(body)).toEqual([
      'Chief Complaint',
      'HPI',
      'ROS',
      'Plan',
      'Follow-up',
    ]);
  });

  it('strips parenthetical clarifications', () => {
    const body = `RETURN MARKDOWN with these sections:\n- HPI\n- Anticipatory Guidance (if discussed)\n`;
    expect(extractExpectedSections(body)).toEqual(['HPI', 'Anticipatory Guidance']);
  });

  it('returns [] when template lacks the convention', () => {
    expect(extractExpectedSections('no section block here')).toEqual([]);
  });
});

describe('validateNoteCoverage', () => {
  it('reports no missing sections when the note has them all', () => {
    const note = '**Chief Complaint**\nCough\n\n**HPI**\nThree days of cough.\n\n**Plan**\nSupportive care.';
    const result = validateNoteCoverage(note, ['Chief Complaint', 'HPI', 'Plan']);
    expect(result.missingSections).toEqual([]);
    expect(result.potentialTruncation).toBe(false);
  });

  it('flags a section the template promised but the note dropped', () => {
    const note = '**HPI**\nThree days of cough.\n\n**Plan**\nSupportive care.';
    const result = validateNoteCoverage(note, ['Chief Complaint', 'HPI', 'Plan']);
    expect(result.missingSections).toEqual(['Chief Complaint']);
  });

  it('treats Subjective as covering HPI (behavioral-health alias)', () => {
    const note = '**Subjective**\nAnxiety follow-up.\n\n**Plan**\nContinue therapy.';
    const result = validateNoteCoverage(note, ['HPI', 'Plan']);
    expect(result.missingSections).toEqual([]);
  });

  it('flags potential truncation when last section ends without terminal punctuation', () => {
    const note = '**HPI**\nThree days of cough.\n\n**Plan**\nStart amoxicillin 80 mg/kg/day';
    const result = validateNoteCoverage(note, ['HPI', 'Plan']);
    expect(result.potentialTruncation).toBe(true);
  });

  it('returns empty report on empty input', () => {
    expect(validateNoteCoverage('', ['HPI', 'Plan'])).toEqual({
      missingSections: [],
      potentialTruncation: false,
    });
  });

  it('returns empty report when no expected sections supplied', () => {
    expect(validateNoteCoverage('**HPI**\nbody.', [])).toEqual({
      missingSections: [],
      potentialTruncation: false,
    });
  });

  it('skips truncation check and missing-section check when the note has no headings', () => {
    const note = 'just a freeform paragraph with no section structure';
    const result = validateNoteCoverage(note, ['HPI', 'Plan']);
    expect(result.missingSections).toEqual([]);
    expect(result.potentialTruncation).toBe(false);
  });
});
