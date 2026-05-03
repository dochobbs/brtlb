import { describe, expect, it } from 'vitest';
import { pathForView, viewFromPath } from './routing';

describe('viewFromPath', () => {
  it('maps each canonical path to its view', () => {
    expect(viewFromPath('/')).toBe('home');
    expect(viewFromPath('/wizard')).toBe('wizard');
    expect(viewFromPath('/record')).toBe('record');
    expect(viewFromPath('/review')).toBe('review');
    expect(viewFromPath('/settings')).toBe('settings');
  });

  it('falls back to home for unknown paths so a typo never blanks the screen', () => {
    expect(viewFromPath('/foo')).toBe('home');
    expect(viewFromPath('/wizard/step-2')).toBe('home');
    expect(viewFromPath('')).toBe('home');
  });

  it('strips trailing slash on non-root paths', () => {
    expect(viewFromPath('/wizard/')).toBe('wizard');
    expect(viewFromPath('/settings/')).toBe('settings');
  });

  it('keeps root as root', () => {
    expect(viewFromPath('/')).toBe('home');
  });
});

describe('pathForView', () => {
  it('round-trips through viewFromPath', () => {
    for (const view of ['home', 'wizard', 'record', 'review', 'settings'] as const) {
      expect(viewFromPath(pathForView(view))).toBe(view);
    }
  });

  it('returns / for home', () => {
    expect(pathForView('home')).toBe('/');
  });
});
