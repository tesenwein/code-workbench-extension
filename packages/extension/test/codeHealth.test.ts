import { describe, expect, it } from 'vitest';
import { diffHealth, formatHealthDelta, upsertHealthLine } from '../src/codeHealth';

const snap = (d: string[], dead: string[] = [], t: string[] = []) => ({
  duplicates: d,
  deadCode: dead,
  typeEscapes: t,
});

describe('diffHealth', () => {
  it('nets findings that appeared against findings that went away', () => {
    expect(diffHealth(snap(['a', 'b'], ['x'], ['t']), snap(['a', 'c', 'd'], [], ['t']))).toEqual({
      duplicates: { added: 2, removed: 1 },
      deadCode: { added: 0, removed: 1 },
      typeEscapes: { added: 0, removed: 0 },
    });
  });

  it('is zero for identical snapshots', () => {
    const zero = { added: 0, removed: 0 };
    expect(diffHealth(snap(['a']), snap(['a']))).toEqual({
      duplicates: zero,
      deadCode: zero,
      typeEscapes: zero,
    });
  });
});

describe('formatHealthDelta / upsertHealthLine', () => {
  const line = formatHealthDelta({
    duplicates: { added: 3, removed: 0 },
    deadCode: { added: 0, removed: 1 },
    typeEscapes: { added: 2, removed: 2 },
  });

  it('renders signed counts', () => {
    expect(line).toBe('Code health: +3 duplicates, -1 dead-code items, +2/-2 type escapes');
  });

  it('appends to a memo, then replaces itself idempotently', () => {
    const once = upsertHealthLine('notes', line);
    expect(once).toBe(`notes\n\n${line}`);
    const next = formatHealthDelta({
      duplicates: { added: 0, removed: 0 },
      deadCode: { added: 0, removed: 0 },
      typeEscapes: { added: 2, removed: 0 },
    });
    const twice = upsertHealthLine(once, next);
    expect(twice).toBe(`notes\n\n${next}`);
    expect(twice.match(/Code health:/g)).toHaveLength(1);
  });

  it('works on an empty memo', () => {
    expect(upsertHealthLine('', line)).toBe(line);
  });
});
