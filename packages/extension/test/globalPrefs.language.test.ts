import { describe, expect, it, vi } from 'vitest';

let fixture = '{}';
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: () => fixture, default: { ...actual, readFileSync: () => fixture } };
});

const { DEFAULT_GLOBAL_PREFS, loadGlobalPrefsSync } = await import('../src/globalPrefs');

describe('GlobalPrefs language normalization', () => {
  it('defaults to auto / inherit when keys are missing', () => {
    fixture = '{}';
    const prefs = loadGlobalPrefsSync();
    expect(prefs.language).toBe('auto');
    expect(prefs.commentLanguage).toBe('inherit');
  });

  it('coerces a non-string language back to the default', () => {
    fixture = JSON.stringify({ language: 42 });
    expect(loadGlobalPrefsSync().language).toBe('auto');
  });

  it('coerces an empty commentLanguage back to the default', () => {
    fixture = JSON.stringify({ commentLanguage: '' });
    expect(loadGlobalPrefsSync().commentLanguage).toBe('inherit');
  });

  it('preserves a valid custom language string', () => {
    fixture = JSON.stringify({ language: 'fr', commentLanguage: 'en' });
    const prefs = loadGlobalPrefsSync();
    expect(prefs.language).toBe('fr');
    expect(prefs.commentLanguage).toBe('en');
  });

  it('DEFAULT_GLOBAL_PREFS carries the language defaults', () => {
    expect(DEFAULT_GLOBAL_PREFS.language).toBe('auto');
    expect(DEFAULT_GLOBAL_PREFS.commentLanguage).toBe('inherit');
  });
});
