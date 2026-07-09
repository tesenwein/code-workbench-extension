import * as vscode from 'vscode';
import { TaskFilter, TasksProvider } from '../tasksView';

interface TaskCommandDeps {
  tasksProvider: TasksProvider;
}

export function registerTaskCommands(ctx: vscode.ExtensionContext, deps: TaskCommandDeps): void {
  const { tasksProvider } = deps;

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.tasks.refresh', () => tasksProvider.refresh()),

    // Create opens the full-width board with a blank editor in the detail column.
    vscode.commands.registerCommand('codeWorkbench.tasks.create', async () => {
      await vscode.commands.executeCommand('codeWorkbench.tasks.newInPage');
    }),

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
  );
}
