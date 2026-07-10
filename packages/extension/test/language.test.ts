import { describe, expect, it } from 'vitest';
import { languagePromptBody, sanitizeLanguage } from '../src/language';

describe('languagePromptBody', () => {
  it('returns undefined for auto + inherit', () => {
    expect(languagePromptBody('auto', 'inherit')).toBeUndefined();
  });

  it('returns a single prose+comment clause for de + inherit', () => {
    const body = languagePromptBody('de', 'inherit');
    expect(body).toContain('prose');
    expect(body).toContain('Deutsch');
    expect(body).toContain('code comments');
    expect(body).toContain('Deutsch');
  });

  it('emits divergent clauses for de + en', () => {
    const body = languagePromptBody('de', 'en');
    expect(body).toContain('Deutsch');
    expect(body).toContain('English');
  });

  it('sanitizes and echoes a custom language string', () => {
    const body = languagePromptBody('Schwiizerdütsch', 'inherit');
    expect(body).toContain('Schwiizerdütsch');
  });

  it('always appends the English-identifiers clause when injecting', () => {
    const body = languagePromptBody('de', 'inherit');
    expect(body).toContain('Identifiers, symbol names, commit messages, and PR titles are always English');
  });
});

describe('sanitizeLanguage', () => {
  it('truncates oversized input to the max length', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeLanguage(long).length).toBe(64);
  });

  it('strips newlines and collapses to one line', () => {
    expect(sanitizeLanguage('foo\nbar\r\nbaz')).toBe('foo bar baz');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeLanguage(42)).toBe('');
  });
});
