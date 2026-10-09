/* Autopilot over a multi-task batch session: when a "Start all" session that
 * ran several tasks reports done, every member that handed off must advance —
 * and members sharing a next phase must start as ONE batch again, never as
 * N concurrent sessions over the same worktree. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskPhase } from '@code-workbench/mcp-core/task-format';
import type { SavedSession } from '../src/sessionTypes';
import { registerAutopilot, type TaskFlowDeps } from '../src/commands/taskFlow';
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

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'in-progress',
    priority: 'medium',
    worktree: null,
    description: '',
    memo: '',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    parentId: null,
    tags: [],
    autoRun: true,
    phase: 'review',
    ...over,
  } as unknown as Task;
}

type Notify = (e: { sessionId: string; kind: 'done' | 'needs_input' | 'info' }) => void;

function harness(sessions: SavedSession[]) {
  let notify: Notify = () => {};
  const create = vi.fn(async () => undefined);
  const deps: TaskFlowDeps = {
    sessionMgr: {
      create,
      resolvePhaseModel: () => 'sonnet',
      list: () => sessions,
      isOpen: () => false,
      onNotify: (fn: Notify) => {
        notify = fn;
        return { dispose() {} };
      },
      markAutopilotHandled: vi.fn(async () => undefined),
    } as unknown as TaskFlowDeps['sessionMgr'],
    getRepoKey: () => 'repo',
    getRepoRoot: () => '/repo',
    ensureActiveWorktree: async () => '/active',
  };
  registerAutopilot({ subscriptions: [] } as never, deps);
  return { create, fire: (sessionId: string) => notify({ sessionId, kind: 'done' }) };
}

const batchSession = (ids: string[], phase: TaskPhase = 'implement'): SavedSession =>
  ({
    id: 's1',
    title: 'Implement: 2 tasks',
    worktreePath: '/wt',
    kind: 'claude',
    initCommand: '',
    created: 1,
    boundBatch: { ids, phase },
  }) as SavedSession;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('registerAutopilot with a batch session', () => {
  it('re-batches members that share a next phase into ONE session', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b')]);
    const h = harness([batchSession(['a', 'b'])]);

    h.fire('s1');
    await flush();

    expect(h.create).toHaveBeenCalledTimes(1);
    const [, wt, , opts] = h.create.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      Record<string, unknown>,
    ];
    // Same worktree the finished session ran in, not the active one.
    expect(wt).toBe('/wt');
    expect(opts.title).toBe('Review: 2 tasks');
    expect(opts.boundBatch).toEqual({ ids: ['a', 'b'], phase: 'review' });
  });

  it('only advances members that opted in and handed off', async () => {
    listTasksMock.mockResolvedValue([
      task('a'),
      task('b', { autoRun: false }),
      // Unchanged phase after done means the session got blocked on this one.
      task('c', { phase: 'implement' }),
    ]);
    const h = harness([batchSession(['a', 'b', 'c'])]);

    h.fire('s1');
    await flush();

    expect(h.create).toHaveBeenCalledTimes(1);
    const opts = h.create.mock.calls[0][3] as unknown as Record<string, unknown>;
    expect(opts.boundTask).toEqual({ id: 'a', phase: 'review' });
  });

  it('acts on a session only once', async () => {
    listTasksMock.mockResolvedValue([task('a'), task('b')]);
    const h = harness([batchSession(['a', 'b'])]);

    h.fire('s1');
    h.fire('s1');
    await flush();

    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
