import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhaseBoard } from '../src/components/PhaseBoard';
import type { PhaseModelMap, TasksApi, WorkspaceTask } from '../src/types';

function task(overrides: Partial<WorkspaceTask> & { id: string; title: string }): WorkspaceTask {
  return {
    priority: 'medium',
    status: 'open',
    worktree: null,
    description: '',
    memo: '',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    parentId: null,
    tags: [],
    ...overrides,
  };
}

function mockApi(tasks: WorkspaceTask[], extra: Partial<TasksApi> = {}): TasksApi {
  return {
    list: vi.fn(async () => tasks),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    startPhase: vi.fn(async () => undefined),
    confirmBulkStart: vi.fn(async () => ({ succeeded: [], failed: [] })),
    ...extra,
  } as TasksApi;
}

/** The column <section> whose header names `label`. */
function column(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const section = heading.closest('section');
  if (!section) throw new Error(`no column for ${label}`);
  return section;
}

const MODELS: PhaseModelMap = {
  fallback: { plan: 'opus', implement: 'sonnet', review: 'sonnet', fix: 'sonnet' },
  byWorktreeKey: {
    'feature-x': { plan: 'haiku', implement: 'haiku', review: 'haiku', fix: 'haiku' },
  },
};

describe('PhaseBoard', () => {
  it('puts a task in the column its `phase` names, and unphased tasks in Plan', async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'No phase yet' }),
      task({ id: 'b2', title: 'Ready to build', phase: 'implement' }),
      task({ id: 'c3', title: 'Needs review', phase: 'review' }),
    ]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('No phase yet');
    expect(within(column('Plan')).getByText('No phase yet')).toBeTruthy();
    expect(within(column('Implement')).getByText('Ready to build')).toBeTruthy();
    expect(within(column('Review')).getByText('Needs review')).toBeTruthy();
  });

  it('derives Implement for an unphased task that already has plan-step subtasks', async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'Already planned' }),
      task({ id: 's1', title: 'step 1', parentId: 'a1', tags: ['plan-step'] }),
    ]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('Already planned');
    expect(within(column('Implement')).getByText('Already planned')).toBeTruthy();
    expect(within(column('Plan')).getByText('0')).toBeTruthy();
  });

  it('counts the tasks in each column', async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'One', phase: 'fix' }),
      task({ id: 'b2', title: 'Two', phase: 'fix' }),
    ]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('One');
    expect(within(column('Fix')).getByText('2')).toBeTruthy();
    expect(within(column('Plan')).getByText('0')).toBeTruthy();
  });

  it('hides subtasks and tasks that already left the flow', async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'Root' }),
      task({ id: 'a1-sub', title: 'A subtask', parentId: 'a1' }),
      task({ id: 'z9', title: 'Finished', status: 'done' }),
    ]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('Root');
    expect(screen.queryByText('A subtask')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
  });

  it('starts the column’s own phase — an unphased task starts Plan', async () => {
    const api = mockApi([task({ id: 'a1', title: 'Fresh' })]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('Fresh');
    await userEvent.click(within(column('Plan')).getByRole('button', { name: /Start Plan/ }));
    expect(api.startPhase).toHaveBeenCalledWith('a1', 'plan');
  });

  it('starts the pending phase for a task already in the flow', async () => {
    const api = mockApi([task({ id: 'b2', title: 'Mid-flow', phase: 'implement' })]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('Mid-flow');
    await userEvent.click(
      within(column('Implement')).getByRole('button', { name: /Start Implement/ }),
    );
    expect(api.startPhase).toHaveBeenCalledWith('b2', 'implement');
  });

  it("shows the model resolved for the task's worktree", async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'Unassigned' }),
      task({ id: 'b2', title: 'On feature-x', worktree: 'feature-x' }),
    ]);
    render(<PhaseBoard api={api} phaseModels={MODELS} />);

    await screen.findByText('Unassigned');
    const cards = within(column('Plan'));
    // Unassigned falls back to the active worktree's map; the assigned one
    // uses its own override.
    expect(cards.getByText('opus')).toBeTruthy();
    expect(cards.getByText('haiku')).toBeTruthy();
  });

  it('summarizes plan-step and review-finding subtask progress on the parent card', async () => {
    const api = mockApi([
      task({ id: 'a1', title: 'Parent', phase: 'implement' }),
      task({ id: 's1', title: 'step 1', parentId: 'a1', tags: ['plan-step'], status: 'done' }),
      task({ id: 's2', title: 'step 2', parentId: 'a1', tags: ['plan-step'] }),
    ]);
    render(<PhaseBoard api={api} />);

    await screen.findByText('Parent');
    expect(screen.getByText('steps 1/2')).toBeTruthy();
    expect(screen.queryByText(/findings/)).toBeNull();
  });

  it('re-lists after a start so the card moves to its new column', async () => {
    const before = task({ id: 'a1', title: 'Mover' });
    const after = task({ id: 'a1', title: 'Mover', phase: 'implement' });
    const list = vi
      .fn<[], Promise<WorkspaceTask[]>>()
      .mockResolvedValueOnce([before])
      .mockResolvedValue([after]);
    const api = mockApi([], { list });

    render(<PhaseBoard api={api} />);
    await screen.findByText('Mover');
    await userEvent.click(within(column('Plan')).getByRole('button', { name: /Start Plan/ }));

    await waitFor(() => expect(within(column('Implement')).getByText('Mover')).toBeTruthy());
  });

  it('tells the user when the host cannot spawn sessions', () => {
    const api = mockApi([task({ id: 'a1', title: 'X' })], { startPhase: undefined });
    render(<PhaseBoard api={api} />);
    expect(screen.getByText(/can.t spawn Claude sessions/)).toBeTruthy();
  });

  describe('bulk column start', () => {
    const COLUMN_TASKS = [
      task({ id: 'p1', title: 'Open one' }),
      task({ id: 'p2', title: 'Open two' }),
      task({ id: 'p3', title: 'Running', status: 'in-progress' }),
    ];

    it('counts only startable tasks and passes both id sets to the host', async () => {
      const api = mockApi(COLUMN_TASKS);
      render(<PhaseBoard api={api} />);

      await screen.findByText('Open one');
      const bulk = within(column('Plan')).getByRole('button', { name: 'Start all Plan (2)' });
      await userEvent.click(bulk);

      expect(api.confirmBulkStart).toHaveBeenCalledWith('plan', ['p1', 'p2'], ['p3']);
    });

    it('hides the footer button in a column with nothing startable', async () => {
      const api = mockApi([task({ id: 'p3', title: 'Running', status: 'in-progress' })]);
      render(<PhaseBoard api={api} />);

      await screen.findByText('Running');
      expect(screen.queryByRole('button', { name: /Start all/ })).toBeNull();
    });

    it('hides the footer button when the host offers no bulk start', async () => {
      const api = mockApi(COLUMN_TASKS, { confirmBulkStart: undefined });
      render(<PhaseBoard api={api} />);

      await screen.findByText('Open one');
      expect(screen.queryByRole('button', { name: /Start all/ })).toBeNull();
    });

    it('reports partial failures, and the summary survives a tasks-changed reload', async () => {
      const api = mockApi(COLUMN_TASKS, {
        confirmBulkStart: vi.fn(async () => ({
          succeeded: ['p1'],
          failed: [{ id: 'p2', error: 'no worktree' }],
        })),
      });
      const { rerender } = render(<PhaseBoard api={api} reloadKey={0} />);

      await screen.findByText('Open one');
      await userEvent.click(within(column('Plan')).getByRole('button', { name: /Start all/ }));

      const summary = await screen.findByText(/1 of 2 failed to start/);
      expect(summary.textContent).toContain('no worktree');

      // The host's watcher fires after the started sessions touch the task
      // files; the load effect must not wipe the summary.
      rerender(<PhaseBoard api={api} reloadKey={1} />);
      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
      expect(screen.getByText(/1 of 2 failed to start/)).toBeTruthy();
    });

    it('leaves no error strip when every start succeeds', async () => {
      const api = mockApi(COLUMN_TASKS, {
        confirmBulkStart: vi.fn(async () => ({ succeeded: ['p1', 'p2'], failed: [] })),
      });
      render(<PhaseBoard api={api} />);

      await screen.findByText('Open one');
      await userEvent.click(within(column('Plan')).getByRole('button', { name: /Start all/ }));

      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(/failed to start/)).toBeNull();
    });
  });
});
