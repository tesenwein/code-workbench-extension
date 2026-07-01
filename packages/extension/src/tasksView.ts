import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { listTasks, createTask, updateTask, deleteTask, tasksDir } from './tasks';
import { listWorktrees } from './git';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { reactWebviewHtml } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';

const STATUS_ICON: Record<Task['status'], string> = {
  open: 'circle-large-outline',
  'in-progress': 'sync',
  done: 'check',
};

const PRIORITY_GLYPH: Record<Task['priority'], string> = {
  high: '▲',
  medium: '·',
  low: '▽',
};

/** Plain data carrier passed to task commands. The commands only read
 *  `.task`, so this stays compatible with the old TreeItem-based callers. */
export class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly task: Task,
    hasChildren: boolean,
    activeWorktree: string | undefined,
  ) {
    super(
      task.title,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    void activeWorktree;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[task.status]);
    this.description = `${PRIORITY_GLYPH[task.priority]} ${task.priority}`;
  }
}

export interface TaskFilter {
  text?: string;
  priority?: Task['priority'];
  status?: Task['status'];
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

    attachRpc(
      view.webview,
      {
        list: async () => {
          const key = this.getRepoKey();
          return key ? listTasks(key) : [];
        },
        create: async (task) => {
          const key = this.getRepoKey();
          if (!key) throw new Error('No repository open');
          return createTask(key, task as Parameters<typeof createTask>[1]);
        },
        update: async (id, patch) => {
          const key = this.getRepoKey();
          if (!key) return;
          await updateTask(key, String(id), patch as Parameters<typeof updateTask>[2]);
        },
        remove: async (id) => {
          const key = this.getRepoKey();
          if (!key) return;
          await deleteTask(key, String(id));
        },
      },
      (rpc) => {
        this.rpc = rpc;
        void this.pushContext();
      },
    );

    // Re-list whenever the panel becomes visible again — with
    // retainContextWhenHidden the webview's `ready` only fires once, so a
    // panel that was hidden while tasks changed would otherwise show stale
    // data until the next poll tick.
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  private async pushContext(): Promise<void> {
    let worktrees: string[] = [];
    const root = this.getRepoRoot();
    if (root) {
      try {
        worktrees = (await listWorktrees(root)).map((w) => w.path);
      } catch {
        /* best-effort — dropdown just shows Unassigned */
      }
    }
    this.rpc?.postEvent('context', {
      activeWorktree: this.getActiveWorktree() ?? null,
      worktrees,
    });
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
