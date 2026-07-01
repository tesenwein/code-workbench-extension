import * as path from 'path';
import * as vscode from 'vscode';
import { TaskFilter, TaskItem, TasksProvider } from '../tasksView';
import { createTask, deleteTask, listTasks, taskFilePath, updateTask } from '../tasks';
import { VALID_PRIORITIES, VALID_STATUSES, type Task } from '@code-workbench/mcp-core/task-format';
import { addWorktree } from '../git';
import { SessionManager } from '../sessions';

interface TaskCommandDeps {
  tasksProvider: TasksProvider;
  getRepoKey: () => string | undefined;
  getRepoRoot: () => string | undefined;
  sessionMgr: SessionManager;
}

export function registerTaskCommands(ctx: vscode.ExtensionContext, deps: TaskCommandDeps): void {
  const { tasksProvider, getRepoKey, getRepoRoot, sessionMgr } = deps;

  const createTaskFlow = async (parent?: Task): Promise<void> => {
    const repoKey = getRepoKey();
    if (!repoKey) {
      vscode.window.showWarningMessage('Open a git repository first.');
      return;
    }
    const title = await vscode.window.showInputBox({
      prompt: parent ? `Subtask of "${parent.title}"` : 'Task title',
    });
    if (!title) return;
    const dueDateInput = await vscode.window.showInputBox({
      prompt: 'Due date (YYYY-MM-DD) — leave empty for none',
      placeHolder: 'YYYY-MM-DD',
      validateInput: (v) =>
        !v.trim() || /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? undefined : 'Use the format YYYY-MM-DD',
    });
    if (dueDateInput === undefined) return;
    const dueDate = dueDateInput.trim() || null;
    const task = await createTask(repoKey, {
      title,
      priority: 'medium',
      worktree: null,
      parentId: parent?.id ?? null,
      dueDate,
    });
    tasksProvider.refresh();
    const doc = await vscode.workspace.openTextDocument(taskFilePath(repoKey, task.id));
    await vscode.window.showTextDocument(doc);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.tasks.refresh', () => tasksProvider.refresh()),

    vscode.commands.registerCommand('codeWorkbench.tasks.create', async () => {
      await createTaskFlow();
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.createSubtask', async (item: TaskItem) => {
      if (!item) return;
      if (!getRepoRoot()) return;
      await createTaskFlow(item.task);
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.edit', async (item: TaskItem) => {
      if (!item) return;
      const repoKey = getRepoKey();
      if (!repoKey) return;
      const doc = await vscode.workspace.openTextDocument(taskFilePath(repoKey, item.task.id));
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.delete', async (item: TaskItem) => {
      if (!item) return;
      const repoKey = getRepoKey();
      if (!repoKey) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete task "${item.task.title}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;
      await deleteTask(repoKey, item.task.id);
      tasksProvider.refresh();
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.cyclePriority', async (item: TaskItem) => {
      if (!item) return;
      const repoKey = getRepoKey();
      if (!repoKey) return;
      const order = [...VALID_PRIORITIES];
      const next = order[(order.indexOf(item.task.priority) + 1) % order.length];
      await updateTask(repoKey, item.task.id, { priority: next });
      tasksProvider.refresh();
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.cycleStatus', async (item: TaskItem) => {
      if (!item) return;
      const repoKey = getRepoKey();
      if (!repoKey) return;
      const order = [...VALID_STATUSES];
      const next = order[(order.indexOf(item.task.status) + 1) % order.length];
      await updateTask(repoKey, item.task.id, { status: next });
      tasksProvider.refresh();
    }),

    vscode.commands.registerCommand(
      'codeWorkbench.tasks.assignToActive',
      async (item: TaskItem) => {
        if (!item) return;
        const repoKey = getRepoKey();
        if (!repoKey) return;
        const active = sessionMgr.getActiveWorktree();
        if (!active) {
          vscode.window.showWarningMessage('Pick an active worktree first.');
          return;
        }
        await updateTask(repoKey, item.task.id, { worktree: active });
        tasksProvider.refresh();
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.tasks.unassignWorktree',
      async (item: TaskItem) => {
        if (!item) return;
        const repoKey = getRepoKey();
        if (!repoKey) return;
        await updateTask(repoKey, item.task.id, { worktree: null });
        tasksProvider.refresh();
      },
    ),

    vscode.commands.registerCommand('codeWorkbench.tasks.filter', async () => {
      const cur = tasksProvider.getFilter();
      const text = await vscode.window.showInputBox({
        prompt:
          'Filter tasks by text (matches title or description). Leave empty for no text filter.',
        value: cur.text ?? '',
      });
      if (text === undefined) return;
      const priorityPick = await vscode.window.showQuickPick(
        [
          { label: 'Any priority', value: undefined },
          { label: '▲ high', value: 'high' as const },
          { label: '· medium', value: 'medium' as const },
          { label: '▽ low', value: 'low' as const },
        ],
        { placeHolder: 'Priority filter' },
      );
      if (!priorityPick) return;
      const statusPick = await vscode.window.showQuickPick(
        [
          { label: 'Any status', value: undefined },
          { label: 'open', value: 'open' as const },
          { label: 'in-progress', value: 'in-progress' as const },
          { label: 'done', value: 'done' as const },
        ],
        { placeHolder: 'Status filter' },
      );
      if (!statusPick) return;
      const filter: TaskFilter = {
        text: text.trim() || undefined,
        priority: priorityPick.value,
        status: statusPick.value,
      };
      await tasksProvider.setFilter(filter);
    }),

    vscode.commands.registerCommand('codeWorkbench.tasks.clearFilter', () =>
      tasksProvider.clearFilter(),
    ),

    vscode.commands.registerCommand('codeWorkbench.tasks.spawnWorktree', async (item: TaskItem) => {
      if (!item) return;
      const repoRoot = getRepoRoot();
      const repoKey = getRepoKey();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      if (!repoKey) return;

      const slug =
        item.task.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50) || 'task';
      const branch = await vscode.window.showInputBox({
        prompt: `Branch name for "${item.task.title}"`,
        value: `feature/${slug}`,
      });
      if (!branch) return;
      const defaultPath = path.join(
        path.dirname(repoRoot),
        `${path.basename(repoRoot)}-${branch.replace(/\//g, '-')}`,
      );
      const target = await vscode.window.showInputBox({
        prompt: 'Path for the new worktree',
        value: defaultPath,
      });
      if (!target) return;

      try {
        await addWorktree(repoRoot, branch, target, { createBranch: true });
        await sessionMgr.assignColorIfUnset(target);
        // Reassign the task and its whole subtree to the new worktree.
        const all = await listTasks(repoKey);
        const ids = new Set<string>();
        const collect = (id: string) => {
          if (ids.has(id)) return;
          ids.add(id);
          for (const c of all.filter((t) => t.parentId === id)) collect(c.id);
        };
        collect(item.task.id);
        for (const id of ids) {
          await updateTask(repoKey, id, { worktree: target });
        }
        tasksProvider.refresh();
        const open = await vscode.window.showInformationMessage(
          `Worktree created at ${target} for "${item.task.title}" (${ids.size} task(s) assigned)`,
          'Open in New Window',
        );
        if (open) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Spawn worktree failed: ${(err as Error).message}`);
      }
    }),
  );
}
