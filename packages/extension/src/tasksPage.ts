/* Full editor-tab tasks board.
 *
 * The Tasks sidebar view stays (quick glance while coding); this page is the
 * same shared TasksPanel at full width for actual planning — descriptions
 * and memos become readable. Both surfaces answer the identical RPC set
 * (buildTaskRpcHandlers), and the tasks file watcher refreshes both. */

import * as vscode from 'vscode';
import { showPage, getPage } from './pagePanel';
import { buildTaskRpcHandlers, taskPanelContext } from './tasksView';

const VIEW_TYPE = 'codeWorkbench.page.tasks';

export interface TasksPageIntent {
  /** Open this task in the detail editor once the board mounts. */
  selectTaskId?: string;
  /** Open a blank new-task editor in the detail column. */
  create?: boolean;
}

export function showTasksPage(
  ctx: vscode.ExtensionContext,
  getRepoKey: () => string | undefined,
  getRepoRoot: () => string | undefined,
  getActiveWorktree: () => string | undefined,
  intent: TasksPageIntent = {},
): void {
  const pushContext = async (rpc: { postEvent(name: string, payload: unknown): void }) => {
    rpc.postEvent('context', {
      ...(await taskPanelContext(getRepoRoot, getActiveWorktree)),
      // The same React bundle serves the sidebar and this page; the surface
      // flag switches TasksPanel into page mode (detail editor + filter bar).
      surface: 'page',
    });
  };
  const pushIntent = (rpc: { postEvent(name: string, payload: unknown): void }) => {
    if (intent.selectTaskId) rpc.postEvent('select-task', intent.selectTaskId);
    if (intent.create) rpc.postEvent('new-task', null);
  };
  showPage({
    ctx,
    viewType: VIEW_TYPE,
    title: 'Task Board',
    entry: 'tasks',
    handlers: buildTaskRpcHandlers(getRepoKey),
    onReady: (rpc) => {
      void pushContext(rpc);
      pushIntent(rpc);
    },
    onReveal: (rpc) => {
      rpc.postEvent('tasks-changed', null);
      void pushContext(rpc);
      pushIntent(rpc);
    },
    // The watcher poll skips while the page is hidden (see isTasksPageOpen),
    // so re-list on return to catch anything that changed meanwhile.
    onVisible: (rpc) => {
      rpc.postEvent('tasks-changed', null);
      void pushContext(rpc);
    },
  });
}

/** Tell the open tasks page (if any) to re-list — wired to the same file
 *  watcher that refreshes the sidebar view. */
export function refreshTasksPage(): void {
  getPage(VIEW_TYPE)?.rpc?.postEvent('tasks-changed', null);
}

/** Whether the tasks page tab is currently VISIBLE — keeps the tasks
 *  file-watcher poll running while the user is looking at the board. A
 *  hidden (retained) tab doesn't poll; onVisible re-lists on return. */
export function isTasksPageOpen(): boolean {
  return getPage(VIEW_TYPE)?.panel.visible ?? false;
}
