import { describe, it, expect } from 'vitest';
import { decodeEntities } from '../src/htmlEntities';

describe('decodeEntities', () => {
  it('decodes the common named entities', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeEntities('&quot;q&quot;')).toBe('"q"');
    expect(decodeEntities('it&#39;s')).toBe("it's");
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes &amp; last so double-encoded entities survive one pass', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('passes through strings with no entities untouched', () => {
    expect(decodeEntities('plain text')).toBe('plain text');
  });

  it('returns empty string for null/undefined', () => {
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
  });
});
