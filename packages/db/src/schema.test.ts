import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, TABLES } from './index';

describe('@brtlb/db schema', () => {
  it('declares a schema version', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('defines the core tables', () => {
    const names = TABLES.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'recordings',
        'transcripts',
        'utterances',
        'notes',
        'speaker_role_assignments',
        'settings',
      ]),
    );
  });

  it('every table has a CREATE TABLE statement', () => {
    for (const t of TABLES) {
      expect(t.createSql).toMatch(/^CREATE TABLE/i);
      expect(t.createSql).toContain(t.name);
    }
  });
});
