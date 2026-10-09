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
      duplicates: 1,
      deadCode: -1,
      typeEscapes: 0,
    });
  });

  it('is zero for identical snapshots', () => {
    expect(diffHealth(snap(['a']), snap(['a']))).toEqual({
      duplicates: 0,
      deadCode: 0,
      typeEscapes: 0,
    });
  });
});

describe('formatHealthDelta / upsertHealthLine', () => {
  const line = formatHealthDelta({ duplicates: 3, deadCode: -1, typeEscapes: 0 });

  it('renders signed counts', () => {
    expect(line).toBe('Code health: +3 duplicates, -1 dead-code items, ±0 type escapes');
  });

  it('appends to a memo, then replaces itself idempotently', () => {
    const once = upsertHealthLine('notes', line);
    expect(once).toBe(`notes\n\n${line}`);
    const next = formatHealthDelta({ duplicates: 0, deadCode: 0, typeEscapes: 2 });
    const twice = upsertHealthLine(once, next);
    expect(twice).toBe(`notes\n\n${next}`);
    expect(twice.match(/Code health:/g)).toHaveLength(1);
  });

  it('works on an empty memo', () => {
    expect(upsertHealthLine('', line)).toBe(line);
  });
});
