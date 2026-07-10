import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { listTasks, createTask, updateTask, deleteTask, tasksDir, taskFilePath } from './tasks';
import { listWorktrees } from './git';
import type { Task, TaskPhase } from '@code-workbench/mcp-core/task-format';
import { PHASE_META } from '@code-workbench/mcp-core/phase-prompts';
import type { BulkStartResult } from './commands/taskFlow';
import { reactWebviewHtml } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';

export interface TaskFilter {
  text?: string;
  priority?: Task['priority'];
  status?: Task['status'];
}

const NO_BULK_START: BulkStartResult = { succeeded: [], failed: [] };

/** The bulk-start modal helper: confirms a whole-column phase start with the
 *  user, then fans it out. Native and modal on purpose — a webview button that
 *  can spawn a dozen Claude sessions needs a host-level "are you sure", and the
 *  count in the button label is the only throttle the fan-out has.
 *
 *  In-progress tasks are skipped by default (a phase is probably already
 *  running for them); the second button opts them in. Dismissing the modal
 *  (Escape) returns `undefined`, which is a Cancel like any other. */
export async function confirmBulkStartPhase(
  phase: TaskPhase,
  startableIds: string[],
  inProgressIds: string[],
): Promise<BulkStartResult> {
  if (!(phase in PHASE_META) || (startableIds.length === 0 && inProgressIds.length === 0)) {
    return NO_BULK_START;
  }

  const label = PHASE_META[phase].label;

  // Nothing open, only in-progress tasks: the only meaningful action is a
  // restart, so skip the "skip in-progress" branch entirely.
  if (startableIds.length === 0) {
    const restart = `Restart ${inProgressIds.length}`;
    const message = `${inProgressIds.length} in-progress tasks. Restart ${label} for all of them?`;
    const answer = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      restart,
      'Cancel',
    );
    if (answer !== restart) return NO_BULK_START;
    const result = await vscode.commands.executeCommand<BulkStartResult>(
      'codeWorkbench.tasks.startPhaseBulk',
      inProgressIds,
      phase,
      true,
    );
    return result ?? NO_BULK_START;
  }

  const startOnly = `Start ${startableIds.length}`;
  const includeAll = `Include in-progress (${startableIds.length + inProgressIds.length})`;
  const message =
    inProgressIds.length > 0
      ? `Start ${label} for ${startableIds.length} tasks? ${inProgressIds.length} in-progress tasks will be skipped.`
      : `Start ${label} for ${startableIds.length} tasks?`;

  const buttons =
    inProgressIds.length > 0 ? [startOnly, includeAll, 'Cancel'] : [startOnly, 'Cancel'];
  const answer = await vscode.window.showWarningMessage(message, { modal: true }, ...buttons);
  if (answer !== startOnly && answer !== includeAll) return NO_BULK_START;

  const ids = answer === includeAll ? [...startableIds, ...inProgressIds] : startableIds;
  const result = await vscode.commands.executeCommand<BulkStartResult>(
    'codeWorkbench.tasks.startPhaseBulk',
    ids,
    phase,
    answer === includeAll,
  );
  return result ?? NO_BULK_START;
}

/** RPC handler set the shared TasksPanel React component needs — used by
 *  both the sidebar view (TasksProvider) and the full-page tasks board
 *  (tasksPage.ts), so the two surfaces stay behaviorally identical.
 *
 *  `afterMutation` is invoked after any create/update/remove so the host can
 *  push a `tasks-changed` event to BOTH surfaces immediately — the fs.watch on
 *  `~/.code-workbench` is unreliable (macOS FSEvents) and the poll only runs
 *  when a panel is visible, so a mutation in one surface would otherwise not
 *  reflect in the other until the next poll tick (or not at all). */
export function buildTaskRpcHandlers(
  getRepoKey: () => string | undefined,
  afterMutation?: () => void,
) {
  return {
    list: async () => {
      const key = getRepoKey();
      return key ? listTasks(key) : [];
    },
    create: async (task: unknown) => {
      const key = getRepoKey();
      if (!key) throw new Error('No repository open');
      const created = await createTask(key, task as Parameters<typeof createTask>[1]);
      afterMutation?.();
      return created;
    },
    update: async (id: unknown, patch: unknown) => {
      const key = getRepoKey();
      if (!key) return;
      await updateTask(key, String(id), patch as Parameters<typeof updateTask>[2]);
      afterMutation?.();
    },
    remove: async (id: unknown) => {
      const key = getRepoKey();
      if (!key) return;
      await deleteTask(key, String(id));
      afterMutation?.();
    },
    openInEditor: async (id: unknown) => {
      const key = getRepoKey();
      if (!key) throw new Error('No repository open');
      const file = taskFilePath(key, String(id));
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { preview: false });
    },
    // Delegates to a registered command rather than depending on SessionManager
    // directly — buildTaskRpcHandlers is shared by the sidebar and the full
    // page and neither constructs a SessionManager itself.
    startPhase: async (id: unknown, phase: unknown) => {
      await vscode.commands.executeCommand('codeWorkbench.tasks.startPhase', String(id), phase);
    },
    confirmBulkStart: async (phase: unknown, startableIds: unknown, inProgressIds: unknown) =>
      confirmBulkStartPhase(
        phase as TaskPhase,
        (startableIds as string[]) ?? [],
        (inProgressIds as string[]) ?? [],
      ),
  };
}

/** Context payload (active worktree + all worktrees) pushed to the panel. */
export async function taskPanelContext(
  getRepoRoot: () => string | undefined,
  getActiveWorktree: () => string | undefined,
): Promise<{ activeWorktree: string | null; worktrees: string[] }> {
  let worktrees: string[] = [];
  const root = getRepoRoot();
  if (root) {
    try {
      worktrees = (await listWorktrees(root)).map((w) => w.path);
    } catch {
      /* best-effort — dropdown just shows Unassigned */
    }
  }
  return { activeWorktree: getActiveWorktree() ?? null, worktrees };
}

/**
 * Tasks sidebar panel. Hosts the shared `@code-workbench/ui` `TasksPanel`
 * React component in a webview and answers its RPC calls — list, create,
 * update, remove — so the extension's task board looks and behaves
 * identically to the Electron app's.
 *
 * The React panel does its own in-panel search; the VS Code-level filter /
 * show-done commands are kept as harmless compatibility stubs so the existing
 * task commands keep compiling and running.
 */
export class TasksProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.tasks';
  private rpc?: RpcContext;
  private filter: TaskFilter = {};
  private view?: vscode.WebviewView;

  /** Whether the Tasks webview is currently visible. The file watcher uses
   *  this to skip its polling scan while the panel is hidden. */
  isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  constructor(
    private getRepoKey: () => string | undefined,
    private getActiveWorktree: () => string | undefined = () => undefined,
    private extensionUri: vscode.Uri = vscode.Uri.file('.'),
    private getRepoRoot: () => string | undefined = () => undefined,
    private memento?: vscode.Memento,
    /** Called after any task mutation so the host can refresh the sibling
     *  full-page board (and this view) without waiting on the file watcher. */
    private afterMutation: () => void = () => undefined,
  ) {
    if (memento) this.filter = memento.get<TaskFilter>('tasks.filter', {});
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    view.webview.html = reactWebviewHtml(view.webview, this.extensionUri, 'tasks');

    // The sidebar gets one extra handler over the shared set: clicking a task
    // opens the full-width board page with that task selected, so editing
    // happens in the main editor area rather than inline in this narrow view.
    const handlers = {
      ...buildTaskRpcHandlers(this.getRepoKey, this.afterMutation),
      openTaskPage: async (id: unknown) => {
        await vscode.commands.executeCommand('codeWorkbench.tasks.openTaskInPage', String(id));
      },
    };
    attachRpc(view.webview, handlers, (rpc) => {
      this.rpc = rpc;
      void this.pushContext();
    });

    // Re-list whenever the panel becomes visible again — with
    // retainContextWhenHidden the webview's `ready` only fires once, so a
    // panel that was hidden while tasks changed would otherwise show stale
    // data until the next poll tick.
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  private async pushContext(): Promise<void> {
    this.rpc?.postEvent(
      'context',
      await taskPanelContext(this.getRepoRoot, this.getActiveWorktree),
    );
  }

  /** Tell the webview to reload its task list. Called by the file watcher and
   *  by task commands after a mutation. */
  refresh(): void {
    this.rpc?.postEvent('tasks-changed', null);
    void this.pushContext();
  }

  // ── Compatibility stubs for the VS Code-level task commands ──────────────
  // The React panel filters in-panel, so these only track state + refresh.

  getFilter(): TaskFilter {
    return { ...this.filter };
  }

  async setFilter(filter: TaskFilter): Promise<void> {
    this.filter = {
      text: filter.text || undefined,
      priority: filter.priority,
      status: filter.status,
    };
    await this.memento?.update('tasks.filter', this.filter);
    this.refresh();
  }

  async clearFilter(): Promise<void> {
    await this.setFilter({});
  }
}

/** How often the polling fallback re-scans the task directory (ms). */
const TASKS_POLL_INTERVAL = 3000;

/**
 * Watch the repo's task directory and fire `onChange` on any `.md` change.
 *
 * Uses `fs.watch` for instant notification, but that is unreliable for a
 * long-lived watcher on a directory outside the workspace (`~/.code-workbench`):
 * macOS FSEvents can silently stop delivering after sleep/wake or event
 * coalescing, so tasks created by an external process (the MCP server, another
 * worktree's CLI) would never appear until the panel was re-opened. A cheap
 * poll of the directory's newest mtime + entry count is layered on top as a
 * safety net so changes still surface within `TASKS_POLL_INTERVAL`.
 */
export function watchTasks(
  repoKey: () => string | undefined,
  onChange: () => void,
  isVisible: () => boolean = () => true,
): vscode.Disposable {
  let watcher: fsSync.FSWatcher | undefined;
  let lastSignature = '';

  // Cheap async fingerprint of the directory: entry count + newest child mtime.
  // Changes on any add / remove / write without reading file contents. All I/O
  // is async so the extension host event loop is never blocked, even on a board
  // with hundreds of task files (the old synchronous statSync-per-file scan ran
  // on a 3s timer and stalled the UI on large boards).
  const signature = async (dir: string): Promise<string> => {
    try {
      const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md'));
      const stats = await Promise.all(
        names.map((n) =>
          fs.stat(`${dir}/${n}`).then(
            (s) => s.mtimeMs,
            () => 0, // file vanished mid-scan — ignore
          ),
        ),
      );
      let newest = 0;
      for (const m of stats) if (m > newest) newest = m;
      return `${names.length}:${newest}`;
    } catch {
      return '';
    }
  };

  const rebind = async () => {
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    watcher = undefined;
    const key = repoKey();
    if (!key) return;
    const dir = tasksDir(key);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      /* best-effort */
    }
    lastSignature = await signature(dir);
    try {
      watcher = fsSync.watch(dir, (_event, filename) => {
        if (filename == null || filename.endsWith('.md')) {
          void signature(dir).then((sig) => {
            lastSignature = sig;
            onChange();
          });
        }
      });
    } catch {
      /* directory may not exist yet — the poll below still covers it */
    }
  };

  void rebind();

  // Polling safety net for dropped fs.watch events. Skipped entirely while the
  // panel is hidden — the provider re-lists on `onDidChangeVisibility`, so a
  // hidden panel never needs the poll, and we avoid scanning the board on a
  // 3s timer when nobody is looking.
  let scanning = false;
  const poll = setInterval(() => {
    if (scanning || !isVisible()) return;
    const key = repoKey();
    if (!key) return;
    scanning = true;
    void signature(tasksDir(key))
      .then((sig) => {
        if (sig !== lastSignature) {
          lastSignature = sig;
          onChange();
        }
      })
      .finally(() => {
        scanning = false;
      });
  }, TASKS_POLL_INTERVAL);

  const wfChange = vscode.workspace.onDidChangeWorkspaceFolders(() => void rebind());
  return new vscode.Disposable(() => {
    clearInterval(poll);
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    wfChange.dispose();
  });
}
