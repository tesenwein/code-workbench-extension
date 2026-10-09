import { describe, expect, it } from 'vitest';
import { CONTEXT_MAX_CHARS, formatTaskContext } from '../src/taskContext';

const card = (i: number) => ({
  slug: `card-${i}`,
  name: `Card ${i}`,
  description: 'x'.repeat(400),
  files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
});
const sym = (i: number) => ({
  file: `/repo/src/f${i}.ts`,
  startLine: i,
  name: `fn${i}`,
  kind: 'function',
});

describe('formatTaskContext', () => {
  it('is empty when nothing was found', () => {
    expect(formatTaskContext([], [], '/repo')).toBe('');
  });

  it('lists cards and repo-relative symbols, bounded to 3 cards / 5 symbols', () => {
    const out = formatTaskContext([1, 2, 3, 4].map(card), [1, 2, 3, 4, 5, 6].map(sym), '/repo');
    expect(out).toContain('card-3');
    expect(out).not.toContain('card-4');
    expect(out).toContain('src/f5.ts:5 function fn5');
    expect(out).not.toContain('fn6');
    expect(out).not.toContain('/repo/');
  });

  it('never exceeds the size cap', () => {
    const out = formatTaskContext([1, 2, 3].map(card), [1, 2, 3, 4, 5].map(sym), '/repo', 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(formatTaskContext([card(1)], [], '/repo').length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
  });
});
