import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPanel } from '../src/components/TasksPanel';
import type { TasksApi, WorkspaceTask } from '../src/types';

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

/** In-memory TasksApi over a fixed task list. */
function mockApi(tasks: WorkspaceTask[], extra: Partial<TasksApi> = {}): TasksApi {
  return {
    list: vi.fn(async () => tasks),
    create: vi.fn(),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...extra,
  };
}

const ROOT = task({ id: 'root-1', title: 'Root task A' });
const SUB = task({
  id: 'sub-1',
  title: 'Subtask one',
  parentId: 'root-1',
  description: 'the subtask detail body',
});

describe('TasksPanel', () => {
  it('renders root tasks and their subtasks', async () => {
    render(<TasksPanel api={mockApi([ROOT, SUB])} activeWorktree={null} worktrees={[]} />);
    expect(await screen.findByText('Root task A')).toBeInTheDocument();
    expect(screen.getByText('Subtask one')).toBeInTheDocument();
  });

  it('reveals a subtask description only after the subtask row is clicked', async () => {
    const user = userEvent.setup();
    render(<TasksPanel api={mockApi([ROOT, SUB])} activeWorktree={null} worktrees={[]} />);

    const subTitle = await screen.findByText('Subtask one');
    // Detail is hidden until the row is expanded — this is the bug that was fixed.
    expect(screen.queryByText('the subtask detail body')).not.toBeInTheDocument();

    await user.click(subTitle);
    expect(await screen.findByText('the subtask detail body')).toBeInTheDocument();
  });

  it('shows no open-in-editor affordance when the host omits openInEditor', async () => {
    render(<TasksPanel api={mockApi([ROOT, SUB])} activeWorktree={null} worktrees={[]} />);
    await screen.findByText('Root task A');
    expect(screen.queryByTitle('Open task file in editor')).not.toBeInTheDocument();
  });

  it('calls openInEditor with the task id when the button is clicked', async () => {
    const user = userEvent.setup();
    const openInEditor = vi.fn(async () => {});
    render(
      <TasksPanel
        api={mockApi([ROOT, SUB], { openInEditor })}
        activeWorktree={null}
        worktrees={[]}
      />,
    );

    await screen.findByText('Root task A');
    const buttons = screen.getAllByTitle('Open task file in editor');
    // One on the root row, one on the subtask row.
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    await user.click(buttons[0]);
    expect(openInEditor).toHaveBeenCalledWith('root-1');
  });

  it('opens the subtask file from the subtask row button', async () => {
    const user = userEvent.setup();
    const openInEditor = vi.fn(async () => {});
    render(
      <TasksPanel
        api={mockApi([ROOT, SUB], { openInEditor })}
        activeWorktree={null}
        worktrees={[]}
      />,
    );

    const subRow = (await screen.findByText('Subtask one')).closest('.task-subtask-row');
    expect(subRow).not.toBeNull();
    await user.click(within(subRow as HTMLElement).getByTitle('Open task file in editor'));
    expect(openInEditor).toHaveBeenCalledWith('sub-1');
  });
});
