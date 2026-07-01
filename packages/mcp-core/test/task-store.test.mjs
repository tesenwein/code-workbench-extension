import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const store = require('../task-store.cjs');

const REPO_KEY = 'test-repo';
let home;

// task-store roots its storage at CODE_WORKBENCH_HOME when set, so each test
// gets an isolated temp home and the real board is never touched.
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-store-'));
  process.env.CODE_WORKBENCH_HOME = home;
});

afterEach(async () => {
  delete process.env.CODE_WORKBENCH_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('createTask / listTasks', () => {
  it('creates a task file and lists it back', async () => {
    const created = await store.createTask(REPO_KEY, {
      title: 'First task',
      priority: 'high',
    });
    expect(created.id).toBeTruthy();
    expect(created.title).toBe('First task');

    const listed = await store.listTasks(REPO_KEY);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
  });

  it('drops a subtask worktree — subtasks inherit from the root', async () => {
    const parent = await store.createTask(REPO_KEY, { title: 'parent' });
    const child = await store.createTask(REPO_KEY, {
      title: 'child',
      parentId: parent.id,
      worktree: '/some/where/feature-x',
    });
    expect(child.worktree).toBeNull();
  });

  it('normalizes a root task worktree to its key', async () => {
    const t = await store.createTask(REPO_KEY, {
      title: 'rooted',
      worktree: '/Users/me/Code/Feature-X',
    });
    expect(t.worktree).toBe('feature-x');
  });
});

describe('updateTask', () => {
  it('applies a partial patch and bumps updated', async () => {
    const t = await store.createTask(REPO_KEY, { title: 'orig', status: 'open' });
    const updated = await store.updateTask(REPO_KEY, t.id, { status: 'done' });
    expect(updated.status).toBe('done');
    expect(updated.title).toBe('orig');

    const listed = await store.listTasks(REPO_KEY);
    expect(listed[0].status).toBe('done');
  });

  it('returns null for a missing task', async () => {
    expect(await store.updateTask(REPO_KEY, 'nope', { status: 'done' })).toBeNull();
  });
});

describe('deleteTask cascade', () => {
  it('deletes a task together with its whole subtree', async () => {
    const parent = await store.createTask(REPO_KEY, { title: 'parent' });
    const child = await store.createTask(REPO_KEY, {
      title: 'child',
      parentId: parent.id,
    });
    const grandchild = await store.createTask(REPO_KEY, {
      title: 'grandchild',
      parentId: child.id,
    });

    const removed = await store.deleteTask(REPO_KEY, parent.id);
    expect(removed).toEqual(
      expect.arrayContaining([parent.id, child.id, grandchild.id]),
    );
    expect(await store.listTasks(REPO_KEY)).toHaveLength(0);
  });

  it('ignores deletion of a missing task', async () => {
    expect(await store.deleteTask(REPO_KEY, 'ghost')).toEqual([]);
  });
});

describe('wouldCycle', () => {
  it('detects a self-parent and an ancestor cycle', () => {
    const tasks = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ];
    expect(store.wouldCycle(tasks, 'a', 'a')).toBe(true); // self
    expect(store.wouldCycle(tasks, 'a', 'c')).toBe(true); // c descends from a
    expect(store.wouldCycle(tasks, 'c', null)).toBe(false); // promote to root
  });
});
