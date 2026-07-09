import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  worktreeKey,
  serializeTask,
  parseTask,
  sortTasks,
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
    dueDate: null,
    epic: 'auth-revamp',
    phase: 'implement',
    tags: ['bug', 'frontend'],
    description: 'A longer description\nwith two lines.',
    memo: 'agent notes here',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

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
});
