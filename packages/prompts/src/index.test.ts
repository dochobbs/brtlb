import { describe, expect, it } from 'vitest';
import { listTemplates, listPatterns, getTemplate, getPattern } from './index';

describe('@brtlb/prompts', () => {
  it('lists at least one template and pattern', () => {
    expect(listTemplates().length).toBeGreaterThanOrEqual(1);
    expect(listPatterns().length).toBeGreaterThanOrEqual(1);
  });

  it('exposes a SOAP template with a non-empty prompt body', () => {
    const t = getTemplate('soap');
    expect(t).toBeDefined();
    expect(t?.name).toBe('SOAP');
    expect(t?.promptBody.length).toBeGreaterThan(50);
  });

  it('exposes a narrative pattern', () => {
    const p = getPattern('narrative');
    expect(p).toBeDefined();
    expect(p?.name).toBe('Narrative');
  });

  it('returns undefined for unknown ids', () => {
    expect(getTemplate('nope')).toBeUndefined();
    expect(getPattern('nope')).toBeUndefined();
  });
});
