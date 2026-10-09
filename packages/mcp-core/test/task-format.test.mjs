import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  worktreeKey,
  serializeTask,
  parseTask,
  sortTasks,
  siblingCmp,
  parseFindingLocation,
} = require('../task-format.cjs');

/** A fully-populated task, used as the round-trip fixture. */
function makeTask(overrides = {}) {
  return {
    id: 'abc123',
    title: 'Do the thing',
    priority: 'high',
    status: 'in-progress',
    worktree: 'feature-x',
    parentId: null,
    parallel: false,
    order: 3,
    dueDate: null,
    epic: 'auth-revamp',
    phase: 'implement',
    autoRun: false,
    prUrl: null,
    issueNumber: null,
    tags: ['bug', 'frontend'],
    description: 'A longer description\nwith two lines.',
    memo: 'agent notes here',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('autoRun', () => {
  it('round-trips true and defaults to false', () => {
    expect(parseTask(serializeTask(makeTask({ autoRun: true }))).autoRun).toBe(true);
    expect(parseTask(serializeTask(makeTask())).autoRun).toBe(false);
  });

  it('is omitted from the file when off', () => {
    expect(serializeTask(makeTask())).not.toContain('autoRun');
  });
});

describe('prUrl', () => {
  it('round-trips and defaults to null', () => {
    const url = 'https://github.com/o/r/pull/7';
    expect(parseTask(serializeTask(makeTask({ prUrl: url }))).prUrl).toBe(url);
    expect(parseTask(serializeTask(makeTask())).prUrl).toBeNull();
  });
});

describe('issueNumber', () => {
  it('round-trips and defaults to null', () => {
    expect(parseTask(serializeTask(makeTask({ issueNumber: 42 }))).issueNumber).toBe(42);
    expect(parseTask(serializeTask(makeTask())).issueNumber).toBeNull();
  });
});

describe('worktreeKey', () => {
  it('collapses a path to its lowercased last segment', () => {
    expect(worktreeKey('/Users/me/Code/Feature-X')).toBe('feature-x');
    expect(worktreeKey('C:\\dev\\Feature-X\\')).toBe('feature-x');
  });

  it('returns empty string for null/empty', () => {
    expect(worktreeKey(null)).toBe('');
    expect(worktreeKey(undefined)).toBe('');
    expect(worktreeKey('')).toBe('');
  });
});

describe('serializeTask / parseTask round-trip', () => {
  it('preserves every field through a full round-trip', () => {
    const task = makeTask();
    const parsed = parseTask(serializeTask(task));
    expect(parsed).toMatchObject({
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      worktree: task.worktree,
      parentId: task.parentId,
      parallel: task.parallel,
      order: task.order,
      dueDate: task.dueDate,
      epic: task.epic,
      phase: task.phase,
      tags: task.tags,
      description: task.description,
      memo: task.memo,
      created: task.created,
      updated: task.updated,
    });
  });

  it('round-trips a task with no memo, epic, phase, or tags', () => {
    const task = makeTask({
      memo: '',
      epic: null,
      phase: null,
      tags: [],
      worktree: null,
      description: '',
    });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.memo).toBe('');
    expect(parsed.epic).toBeNull();
    expect(parsed.phase).toBeNull();
    expect(parsed.tags).toEqual([]);
    expect(parsed.worktree).toBeNull();
    expect(parsed.description).toBe('');
  });

  it('round-trips a null order', () => {
    const task = makeTask({ order: null });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.order).toBeNull();
  });

  it('round-trips a numeric order, including 0', () => {
    expect(parseTask(serializeTask(makeTask({ order: 0 }))).order).toBe(0);
    expect(parseTask(serializeTask(makeTask({ order: 7 }))).order).toBe(7);
  });

  it('round-trips a memo when the description is empty', () => {
    const task = makeTask({ description: '', memo: 'blocker notes' });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.description).toBe('');
    expect(parsed.memo).toBe('blocker notes');
    // Stable across a second round-trip (no marker bleeding into description).
    const reparsed = parseTask(serializeTask(parsed));
    expect(reparsed.description).toBe('');
    expect(reparsed.memo).toBe('blocker notes');
  });

  it('escapes and restores quotes and backslashes in the title', () => {
    const task = makeTask({ title: 'weird "quoted" \\ path' });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.title).toBe('weird "quoted" \\ path');
  });

  it('decodes HTML entities in the title', () => {
    const task = makeTask({ title: 'a &amp; b &lt;tag&gt;' });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.title).toBe('a & b <tag>');
  });

  it('parses CRLF frontmatter (git autocrlf on Windows)', () => {
    const md = serializeTask(makeTask()).replace(/\n/g, '\r\n');
    const parsed = parseTask(md);
    expect(parsed?.title).toBe('Do the thing');
  });

  it('returns null for content without frontmatter', () => {
    expect(parseTask('just some text')).toBeNull();
    expect(parseTask('---\nid: x\n')).toBeNull(); // no closing ---
  });

  it('falls back to defaults for invalid priority/status', () => {
    const task = makeTask({ priority: 'urgent', status: 'blocked' });
    const parsed = parseTask(serializeTask(task));
    expect(parsed.priority).toBe('medium');
    expect(parsed.status).toBe('open');
  });
});

describe('sortTasks', () => {
  const t = (o) => makeTask({ created: '2026-01-01T00:00:00.000Z', ...o });

  it('orders roots by priority then status, nesting children under parents', () => {
    const tasks = [
      t({ id: 'low', priority: 'low', parentId: null }),
      t({ id: 'high', priority: 'high', parentId: null }),
      t({ id: 'child-of-high', priority: 'low', parentId: 'high' }),
      t({ id: 'med', priority: 'medium', parentId: null }),
    ];
    const ids = sortTasks(tasks).map((x) => x.id);
    expect(ids).toEqual(['high', 'child-of-high', 'med', 'low']);
  });

  it('appends orphaned subtasks (missing parent) at the end', () => {
    const tasks = [
      t({ id: 'root', parentId: null }),
      t({ id: 'orphan', parentId: 'ghost' }),
    ];
    const ids = sortTasks(tasks).map((x) => x.id);
    expect(ids).toEqual(['root', 'orphan']);
  });

  it('sorts siblings by order, ascending, ahead of null-order siblings', () => {
    const tasks = [
      t({ id: 'root', priority: 'high', parentId: null }),
      t({ id: 'c-2', parentId: 'root', order: 2 }),
      t({ id: 'c-unordered', parentId: 'root', order: null }),
      t({ id: 'c-0', parentId: 'root', order: 0 }),
      t({ id: 'c-1', parentId: 'root', order: 1 }),
    ];
    const ids = sortTasks(tasks).map((x) => x.id);
    expect(ids).toEqual(['root', 'c-0', 'c-1', 'c-2', 'c-unordered']);
  });

  it('falls back to created order among null-order siblings', () => {
    const tasks = [
      t({ id: 'root', parentId: null }),
      t({ id: 'later', parentId: 'root', order: null, created: '2026-01-02T00:00:00.000Z' }),
      t({ id: 'earlier', parentId: 'root', order: null, created: '2026-01-01T00:00:00.000Z' }),
    ];
    const ids = sortTasks(tasks).map((x) => x.id);
    expect(ids).toEqual(['root', 'earlier', 'later']);
  });

  it('does not change root ordering when order is present', () => {
    const tasks = [
      t({ id: 'low', priority: 'low', parentId: null, order: 0 }),
      t({ id: 'high', priority: 'high', parentId: null, order: 5 }),
      t({ id: 'med', priority: 'medium', parentId: null, order: 1 }),
    ];
    const ids = sortTasks(tasks).map((x) => x.id);
    expect(ids).toEqual(['high', 'med', 'low']);
  });
});

describe('siblingCmp', () => {
  const t = (o) => ({ created: '2026-01-01T00:00:00.000Z', order: null, ...o });

  it('orders by order ascending when both are set', () => {
    expect(siblingCmp(t({ order: 1 }), t({ order: 2 }))).toBeLessThan(0);
    expect(siblingCmp(t({ order: 2 }), t({ order: 1 }))).toBeGreaterThan(0);
  });

  it('sorts a null order after any numeric order', () => {
    expect(siblingCmp(t({ order: null }), t({ order: 0 }))).toBeGreaterThan(0);
    expect(siblingCmp(t({ order: 0 }), t({ order: null }))).toBeLessThan(0);
  });

  it('falls back to created among ties (same order or both null)', () => {
    const earlier = t({ order: 1, created: '2026-01-01T00:00:00.000Z' });
    const later = t({ order: 1, created: '2026-01-02T00:00:00.000Z' });
    expect(siblingCmp(earlier, later)).toBeLessThan(0);

    const earlierNull = t({ order: null, created: '2026-01-01T00:00:00.000Z' });
    const laterNull = t({ order: null, created: '2026-01-02T00:00:00.000Z' });
    expect(siblingCmp(earlierNull, laterNull)).toBeLessThan(0);
  });
});

describe('parseFindingLocation', () => {
  it('reads the usual "file:line, what is wrong" shape', () => {
    expect(parseFindingLocation('src/app.ts:42, null deref when x is empty')).toEqual({
      file: 'src/app.ts',
      line: 42,
    });
  });

  it('handles columns, ranges, backticks and #L anchors', () => {
    expect(parseFindingLocation('`packages/a/b.tsx:10:5` bad')).toEqual({
      file: 'packages/a/b.tsx',
      line: 10,
      column: 5,
    });
    expect(parseFindingLocation('see lib/x.py:7-12 for details').line).toBe(7);
    expect(parseFindingLocation('(src/y.ts#L33)')).toEqual({ file: 'src/y.ts', line: 33 });
  });

  it('handles Windows drive paths', () => {
    expect(parseFindingLocation('C:\\dev\\proj\\a.ts:9, oops')).toEqual({
      file: 'C:\\dev\\proj\\a.ts',
      line: 9,
    });
  });

  it('ignores URLs, versions and text without a location', () => {
    expect(parseFindingLocation('see http://example.com:8080/path')).toBeNull();
    expect(parseFindingLocation('bump to 1.2.3 please')).toBeNull();
    expect(parseFindingLocation('')).toBeNull();
    expect(parseFindingLocation(undefined)).toBeNull();
  });

  it('takes the first location when several are named', () => {
    expect(parseFindingLocation('a.ts:1 and b.ts:2').file).toBe('a.ts');
  });
});
