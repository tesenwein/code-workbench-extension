/* Bulk phase start: the fan-out helper and the modal that gates it.
 *
 * The modal's copy and its two counts (startable vs. startable+in-progress) are
 * the whole safety story for a button that can spawn a dozen Claude sessions,
 * so they are asserted literally. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { startTaskPhaseBulk, type TaskFlowDeps } from '../src/commands/taskFlow';
import { confirmBulkStartPhase } from '../src/tasksView';
import { listTasks } from '../src/tasks';

vi.mock('../src/tasks', () => ({
  listTasks: vi.fn(async () => []),
  updateTask: vi.fn(async () => undefined),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  tasksDir: () => '/tmp/tasks',
  taskFilePath: () => '/tmp/tasks/x.md',
}));

vi.mock('../src/git', () => ({ listWorktrees: vi.fn(async () => []) }));

const listTasksMock = vi.mocked(listTasks);

function task(id: string, status: Task['status'] = 'open'): Task {
  return {
    id,
    title: `Task ${id}`,
    status,
    priority: 'medium',
    worktree: null,
    description: '',
    memo: '',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    parentId: null,
    tags: [],
  } as unknown as Task;
}

function deps(create = vi.fn(async () => undefined)): TaskFlowDeps & { create: typeof create } {
  return {
    create,
    sessionMgr: {
      create,
      resolvePhaseModel: () => 'sonnet',
    } as unknown as TaskFlowDeps['sessionMgr'],
    getRepoKey: () => 'repo',
    getRepoRoot: () => '/repo',
    ensureActiveWorktree: async () => '/repo',
  };
}

const run = (d: TaskFlowDeps, ids: string[], includeInProgress = false) =>
  startTaskPhaseBulk(d, 'repo', '/repo', ids, 'implement', includeInProgress);

beforeEach(() => {
  vi.restoreAllMocks();
  listTasksMock.mockResolvedValue([]);
});

describe('startTaskPhaseBulk', () => {
  it('starts every task of a worktree in ONE session, not one session each', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b'), task('c')]);
    const d = deps();

    const result = await run(d, ['a', 'b', 'c']);

    expect(d.create).toHaveBeenCalledTimes(1);
    const opts = d.create.mock.calls[0][3] as unknown as { title: string; prompt: string };
    expect(opts.title).toBe('Implement: 3 tasks');
    // Each batched task carries its own copy of the procedure, keyed by its id.
    for (const id of ['a', 'b', 'c']) expect(opts.prompt).toContain(`Task ${id}:`);
    expect(result.succeeded).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
  });

  it('de-dupes ids so a doubled board snapshot cannot double-queue a task', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b')]);
    const d = deps();

    const result = await run(d, ['a', 'a', 'b']);

    expect(result.succeeded).toEqual(['a', 'b']);
  });

  it('skips ids that went stale since the board snapshot', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b', 'in-progress'), task('c', 'done')]);
    const d = deps();

    // 'gone' was deleted, 'b' was picked up elsewhere, 'c' finished.
    const result = await run(d, ['a', 'b', 'c', 'gone']);

    expect(result.succeeded).toEqual(['a']);
    expect(result.failed).toEqual([]);
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it('includes in-progress tasks when the user opted in', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b', 'in-progress')]);
    const d = deps();

    const result = await run(d, ['a', 'b'], true);

    expect(result.succeeded).toEqual(['a', 'b']);
  });

  it('keeps a single task on the single-task title and prompt', async () => {
    listTasksMock.mockResolvedValue([task('a')]);
    const d = deps();

    await run(d, ['a']);

    const opts = d.create.mock.calls[0][3] as unknown as { title: string; prompt: string };
    expect(opts.title).toBe('Implement: Task a');
    expect(opts.prompt).toContain('IMPLEMENT phase for task a.');
  });

  it('fails every task of a batch whose session could not spawn', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b')]);
    const create = vi.fn(async () => Promise.reject(new Error('spawn failed')));
    const d = deps(create as never);

    const result = await run(d, ['a', 'b']);

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: 'a', error: 'spawn failed' },
      { id: 'b', error: 'spawn failed' },
    ]);
  });
});

describe('confirmBulkStartPhase', () => {
  const warn = () => vi.spyOn(vscode.window, 'showWarningMessage');
  const exec = () =>
    vi
      .spyOn(vscode.commands, 'executeCommand')
      .mockResolvedValue({ succeeded: [], failed: [] } as never);

  it('offers both counts and names the phase, then starts only the startable ids', async () => {
    const showWarning = warn().mockResolvedValue('Start 5' as never);
    const executeCommand = exec();

    await confirmBulkStartPhase('implement', ['a', 'b', 'c', 'd', 'e'], ['f', 'g']);

    expect(showWarning).toHaveBeenCalledWith(
      'Start Implement for 5 tasks? 2 in-progress tasks will be skipped.',
      { modal: true },
      'Start 5',
      'Include in-progress (7)',
      'Cancel',
    );
    expect(executeCommand).toHaveBeenCalledWith(
      'codeWorkbench.tasks.startPhaseBulk',
      ['a', 'b', 'c', 'd', 'e'],
      'implement',
      false,
    );
  });

  it('starts the combined id set when the user includes in-progress tasks', async () => {
    warn().mockResolvedValue('Include in-progress (3)' as never);
    const executeCommand = exec();

    await confirmBulkStartPhase('review', ['a', 'b'], ['c']);

    expect(executeCommand).toHaveBeenCalledWith(
      'codeWorkbench.tasks.startPhaseBulk',
      ['a', 'b', 'c'],
      'review',
      true,
    );
  });

  it('drops the skip sentence and the opt-in button when nothing is in progress', async () => {
    const showWarning = warn().mockResolvedValue(undefined as never);

    await confirmBulkStartPhase('plan', ['a'], []);

    expect(showWarning).toHaveBeenCalledWith(
      'Start Plan for 1 tasks?',
      { modal: true },
      'Start 1',
      'Cancel',
    );
  });

  it('treats Cancel and a dismissed modal alike — nothing starts', async () => {
    const executeCommand = exec();

    warn().mockResolvedValue('Cancel' as never);
    expect(await confirmBulkStartPhase('fix', ['a'], [])).toEqual({ succeeded: [], failed: [] });

    warn().mockResolvedValue(undefined as never);
    expect(await confirmBulkStartPhase('fix', ['a'], [])).toEqual({ succeeded: [], failed: [] });

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('never opens a modal for a column with nothing startable', async () => {
    const showWarning = warn();
    expect(await confirmBulkStartPhase('plan', [], ['a'])).toEqual({ succeeded: [], failed: [] });
    expect(showWarning).not.toHaveBeenCalled();
  });
});
