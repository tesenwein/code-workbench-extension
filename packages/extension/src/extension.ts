import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { findRepoKey, findRepoRoot, removeWorktree } from './git';
import { WorktreeItem, WorktreesProvider } from './worktreesView';
import { TasksProvider, watchTasks } from './tasksView';
import { SessionItem, SessionManager, SessionsProvider, SessionKind } from './sessions';
import { clearTaskWorktree } from './tasks';
import { initProjectWorkspace } from './workspaceInit';
import { installWorkbenchSkills } from './skillsBundle';
import { registerWorkbenchMcpServers } from './mcpRegister';
import { GlobalPrefsPanel } from './globalPrefsPanel';
import { loadGlobalPrefs, loadGlobalPrefsSync, saveGlobalPrefs } from './globalPrefs';
import { BrandViewProvider } from './brandView';
import { pickSessionLaunch, pickWorktreeAndActivate } from './workspaceFolder';
import { registerLayoutCommands } from './commands/layoutCommands';
import { registerTaskCommands } from './commands/taskCommands';
import { registerWorktreeCommands } from './commands/worktreeCommands';
import { DeadCodeViewProvider } from './deadCodeView';
import { TypeEscapeViewProvider } from './typeEscapeView';
import { DuplicatesViewProvider } from './duplicatesView';
import { ArchViewProvider } from './archView';
import { searchCode } from './scanHost';

let repoRoot: string | undefined;
let repoKey: string | undefined;

async function detectRepoRoot(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    repoRoot = undefined;
    repoKey = undefined;
    return;
  }
  const cwd = folders[0].uri.fsPath;
  repoRoot = (await findRepoRoot(cwd)) ?? undefined;
  repoKey = (await findRepoKey(cwd)) ?? undefined;
}

const PIN_SIDEBAR_KEY = 'codeWorkbench.sidebarPinned';
const PENDING_REMOVAL_KEY = 'codeWorkbench.pendingWorktreeRemoval';
const PENDING_DELETIONS_KEY = 'codeWorkbench.pendingWorktreeDeletions';

interface PendingRemoval {
  repoKey: string;
  repoRoot: string;
  worktreePath: string;
}

/** Persistent set of worktree directories that were locked at removal time —
 *  retried on next activation once the locking process has exited. Mirrors
 *  the Electron app's userData-backed JSON store, but stored in VS Code's
 *  globalState so it survives reloads. */
function makePendingDeletionStore(ctx: vscode.ExtensionContext) {
  const read = (): string[] => ctx.globalState.get<string[]>(PENDING_DELETIONS_KEY, []);
  return {
    async add(worktreePath: string): Promise<void> {
      const list = read();
      if (!list.includes(worktreePath)) {
        await ctx.globalState.update(PENDING_DELETIONS_KEY, [...list, worktreePath]);
      }
    },
    async drain(): Promise<void> {
      const list = read();
      if (list.length === 0) return;
      const fs = await import('fs');
      const stillStuck: string[] = [];
      for (const p of list) {
        try {
          if (fs.existsSync(p)) {
            await fs.promises.rm(p, {
              recursive: true,
              force: true,
              maxRetries: 5,
              retryDelay: 300,
            });
          }
        } catch (err) {
          console.error(
            '[worktree] pending deletion still locked, will retry next launch:',
            p,
            err,
          );
          stillStuck.push(p);
        }
      }
      if (stillStuck.length !== list.length) {
        await ctx.globalState.update(PENDING_DELETIONS_KEY, stillStuck);
      }
    },
  };
}

/** Run `git worktree remove` plus all per-worktree cleanup. Used by both the
 *  same-tick path (removing a non-active worktree) and the resumed path after
 *  a window reload (removing the active worktree). */
async function performWorktreeRemoval(
  ctx: vscode.ExtensionContext,
  sessionMgr: SessionManager,
  repoRootArg: string,
  repoKeyArg: string,
  worktreePath: string,
): Promise<void> {
  // Close any sessions we own inside the worktree first — terminal cwds and
  // file watchers there will otherwise hold handles that block the rmdir.
  await sessionMgr.cleanupWorktree(worktreePath);
  await removeWorktree(repoRootArg, worktreePath, makePendingDeletionStore(ctx));
  try {
    await clearTaskWorktree(repoKeyArg, worktreePath);
  } catch {
    /* best-effort: don't block worktree removal if task cleanup fails */
  }
}

/** Hybrid AST + symbol code search — the QuickBar `search-code` command,
 *  surfaced in the VS Code command palette. Prompts for a query, ranks
 *  symbols, and opens the picked result at its line. */
async function runSearchCodeCommand(
  ctx: vscode.ExtensionContext,
  repoRoot: string | undefined,
): Promise<void> {
  if (!repoRoot) {
    vscode.window.showWarningMessage('Open a git repository first.');
    return;
  }
  const query = await vscode.window.showInputBox({
    title: 'Search Code',
    prompt: 'Search code by fragment or description',
    placeHolder: 'e.g. debounce git polling, parse markdown frontmatter',
  });
  if (!query) return;

  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'Code Workbench: searching code…',
    },
    () => searchCode(ctx, repoRoot, query),
  );
  if (results.length === 0) {
    vscode.window.showInformationMessage(`No code matches for “${query}”.`);
    return;
  }

  const pick = await vscode.window.showQuickPick(
    results.map((r) => {
      const rel = path.relative(repoRoot, r.file).split(path.sep).join('/');
      return {
        label: r.name,
        description: r.kind,
        detail: `${rel}:${r.startLine}`,
        result: r,
      };
    }),
    { title: `Search Code — ${results.length} result(s)`, matchOnDetail: true },
  );
  if (!pick) return;

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pick.result.file));
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(Math.max(0, pick.result.startLine - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  await detectRepoRoot();

  const isSidebarPinned = (): boolean => ctx.globalState.get<boolean>(PIN_SIDEBAR_KEY, false);
  const syncPinContext = () =>
    vscode.commands.executeCommand('setContext', PIN_SIDEBAR_KEY, isSidebarPinned());
  syncPinContext();
  const openOnStartup = loadGlobalPrefsSync().openOnStartup;
  if (isSidebarPinned() || openOnStartup) {
    void vscode.commands.executeCommand('workbench.view.extension.codeWorkbench');
  }

  const sessionMgr = new SessionManager(ctx);
  ctx.subscriptions.push({ dispose: () => sessionMgr.dispose() });
  await sessionMgr.setRepoKey(repoKey);
  sessionMgr.setCurrentWorktreePath(repoRoot);

  // Resume any worktree removal that was deferred across a window reload
  // (we switch folders before deleting the active worktree, which kills the
  // running command — so we persist intent and finish here).
  const pending = ctx.globalState.get<PendingRemoval>(PENDING_REMOVAL_KEY);
  if (pending && pending.repoKey === repoKey) {
    await ctx.globalState.update(PENDING_REMOVAL_KEY, undefined);
    try {
      await performWorktreeRemoval(
        ctx,
        sessionMgr,
        pending.repoRoot,
        pending.repoKey,
        pending.worktreePath,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Deferred worktree removal failed: ${(err as Error).message}`);
    }
  }
  // Retry deletion of worktree directories that were locked at removal time —
  // by activation the stray Claude CLI / MCP subprocess that held a handle
  // inside the worktree has typically exited, so the delete now succeeds.
  void makePendingDeletionStore(ctx).drain();
  // Optionally reopen the saved session terminals for this worktree when the
  // workspace opens (codeWorkbench.restoreSessionsOnOpen).
  if (
    repoRoot &&
    vscode.workspace.getConfiguration('codeWorkbench').get<boolean>('restoreSessionsOnOpen', false)
  ) {
    void sessionMgr.restoreSessions(repoRoot);
  }

  const worktreesProvider = new WorktreesProvider(
    () => repoRoot,
    () => sessionMgr.getActiveWorktree(),
    (wt) => sessionMgr.listForWorktree(wt).length,
    (wt) => sessionMgr.getPrefs(wt).color,
  );
  const tasksProvider = new TasksProvider(
    () => repoKey,
    () => sessionMgr.getActiveWorktree() ?? undefined,
    ctx.extensionUri,
    () => repoRoot,
    ctx.workspaceState,
  );
  const sessionsProvider = new SessionsProvider(sessionMgr, ctx.extensionUri);

  // Status bar identifies which worktree this window is working in.
  // Click opens a picker to launch *another* worktree in a new window.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'codeWorkbench.worktrees.switch';
  const refreshStatusBar = () => {
    if (!repoRoot) {
      statusBar.hide();
      return;
    }
    const label = path.basename(repoRoot);
    statusBar.text = `$(git-branch) ${label}`;
    statusBar.tooltip = `This window's worktree: ${repoRoot}\nClick to open another worktree in a new window.`;
    statusBar.show();
  };
  sessionMgr.onDidChange(() => {
    worktreesProvider.refresh();
    tasksProvider.refresh();
    refreshStatusBar();
  });
  refreshStatusBar();

  const deadCodeProvider = new DeadCodeViewProvider(
    ctx,
    () => repoRoot,
    () => repoKey,
  );
  const duplicatesProvider = new DuplicatesViewProvider(
    ctx,
    () => repoRoot,
    () => repoKey,
  );
  const typeEscapeProvider = new TypeEscapeViewProvider(
    ctx,
    () => repoRoot,
    () => repoKey,
  );
  const archProvider = new ArchViewProvider(ctx, () => repoRoot);

  ctx.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand('codeWorkbench.deadCode.scan', () =>
      deadCodeProvider.requestScan(),
    ),
    vscode.commands.registerCommand('codeWorkbench.duplicates.scan', () =>
      duplicatesProvider.requestScan(),
    ),
    vscode.commands.registerCommand('codeWorkbench.typeEscapes.scan', () =>
      typeEscapeProvider.requestScan(),
    ),
    vscode.commands.registerCommand('codeWorkbench.arch.refresh', () => archProvider.refresh()),
    vscode.commands.registerCommand('codeWorkbench.searchCode', () =>
      runSearchCodeCommand(ctx, repoRoot),
    ),
    vscode.window.registerWebviewViewProvider(
      BrandViewProvider.viewId,
      new BrandViewProvider(sessionMgr),
    ),
    vscode.window.registerWebviewViewProvider(WorktreesProvider.viewId, worktreesProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(TasksProvider.viewId, tasksProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(SessionsProvider.viewId, sessionsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await detectRepoRoot();
      await sessionMgr.setRepoKey(repoKey);
      sessionMgr.setCurrentWorktreePath(repoRoot);
      worktreesProvider.refresh();
      tasksProvider.refresh();
      archProvider.onRepoChanged();
      refreshStatusBar();
    }),
    vscode.window.registerWebviewViewProvider(DeadCodeViewProvider.viewId, deadCodeProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(DuplicatesViewProvider.viewId, duplicatesProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(TypeEscapeViewProvider.viewId, typeEscapeProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(ArchViewProvider.viewId, archProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    watchTasks(
      () => repoKey,
      () => tasksProvider.refresh(),
      () => tasksProvider.isVisible(),
    ),
    // Keep worktree status badges fresh: window regaining focus may mean the
    // user committed/pulled in a terminal, and saving a file changes dirty state.
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) worktreesProvider.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => worktreesProvider.refresh()),
  );

  const ensureActiveWorktree = async (): Promise<string | undefined> => {
    const active = sessionMgr.getActiveWorktree();
    if (active) return active;
    if (!repoRoot) {
      vscode.window.showWarningMessage('Open a git repository first.');
      return undefined;
    }
    return pickWorktreeAndActivate(repoRoot, sessionMgr);
  };

  // ── Worktree commands ─────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.pinSidebar', async () => {
      await ctx.globalState.update(PIN_SIDEBAR_KEY, true);
      syncPinContext();
      vscode.window.showInformationMessage(
        'Code Workbench sidebar pinned. It will auto-open on reload and worktree switch.',
      );
    }),
    vscode.commands.registerCommand('codeWorkbench.unpinSidebar', async () => {
      await ctx.globalState.update(PIN_SIDEBAR_KEY, false);
      syncPinContext();
    }),
  );

  registerWorktreeCommands(ctx, {
    getRepoRoot: () => repoRoot,
    getRepoKey: () => repoKey,
    sessionMgr,
    worktreesProvider,
    tasksProvider,
    performWorktreeRemoval,
    pendingRemovalKey: PENDING_REMOVAL_KEY,
  });

  // ── Init command ──────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.init', async (item?: WorktreeItem) => {
      const target = item?.wt.path ?? sessionMgr.getActiveWorktree() ?? repoRoot;
      if (!target) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      const result = await initProjectWorkspace(target);
      const created = result.steps.filter((s) => s.status === 'created').length;
      const errors = result.steps.filter((s) => s.status === 'error');
      if (errors.length) {
        vscode.window.showErrorMessage(
          `Init had errors: ${errors.map((e) => `${e.name}: ${e.detail ?? 'failed'}`).join('; ')}`,
        );
      } else {
        vscode.window.showInformationMessage(
          `Code Workbench initialized at ${path.basename(target)} (${created} created, ${result.steps.length - created} ok).`,
        );
      }
      tasksProvider.refresh();
      worktreesProvider.refresh();
    }),
  );

  // ── Global settings panel ─────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.openGlobalPrefs', async () => {
      await GlobalPrefsPanel.show(ctx, sessionMgr);
    }),
    vscode.commands.registerCommand('codeWorkbench.toggleOpenOnStartup', async () => {
      const cur = await loadGlobalPrefs();
      const next = !cur.openOnStartup;
      await saveGlobalPrefs({ ...cur, openOnStartup: next });
      sessionMgr.setGlobalPrefs({ ...cur, openOnStartup: next });
      vscode.window.showInformationMessage(
        `Code Workbench: open on startup ${next ? 'enabled' : 'disabled'}.`,
      );
    }),
  );

  // ── Install workbench skills into current worktree ────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.installWorkbenchSkills',
      async (scope?: 'user' | 'project') => {
        const target =
          scope === 'user' ? os.homedir() : (sessionMgr.getActiveWorktree() ?? repoRoot);
        if (!target) {
          vscode.window.showWarningMessage('Open a git repository first.');
          return;
        }
        try {
          const { installed, removed } = await installWorkbenchSkills(target);
          const parts: string[] = [];
          if (installed.length) parts.push(`installed ${installed.join(', ')}`);
          if (removed.length) parts.push(`removed legacy ${removed.join(', ')}`);
          const where = scope === 'user' ? 'user (~/.claude)' : path.basename(target);
          vscode.window.showInformationMessage(
            `Workbench skills: ${parts.join('; ') || 'nothing to do'} at ${where}.`,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Install skills failed: ${(e as Error).message}`);
        }
      },
    ),
  );

  // ── Register workbench MCP servers into .claude.json ──────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.registerWorkbenchMcpServers',
      async (scope?: 'user' | 'project') => {
        const target =
          scope === 'user' ? os.homedir() : (sessionMgr.getActiveWorktree() ?? repoRoot);
        if (!target) {
          vscode.window.showWarningMessage('Open a git repository first.');
          return;
        }
        try {
          const result = await registerWorkbenchMcpServers(ctx.extensionPath, target);
          const lines = [
            ...result.registered.map((s) => `✓ ${s}`),
            ...result.skipped.map((s) => `– ${s.name} (skipped: ${s.reason})`),
          ];
          const where = scope === 'user' ? 'user (~/.claude.json)' : path.basename(target);
          vscode.window.showInformationMessage(
            `Workbench MCP: ${lines.join('  ') || 'nothing to do'} at ${where}.`,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Register MCP servers failed: ${(e as Error).message}`);
        }
      },
    ),
  );

  registerLayoutCommands(ctx);

  registerTaskCommands(ctx, {
    tasksProvider,
    getRepoKey: () => repoKey,
    getRepoRoot: () => repoRoot,
    sessionMgr,
  });

  // ── Session commands ──────────────────────────────────────────────────
  const newSession = async (kind: SessionKind) => {
    const wt = await ensureActiveWorktree();
    if (!wt) return;
    await sessionMgr.create(kind, wt);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.sessions.new', () => newSession('claude')),
    vscode.commands.registerCommand('codeWorkbench.sessions.newYolo', () =>
      newSession('claude-yolo'),
    ),
    vscode.commands.registerCommand('codeWorkbench.sessions.newShell', () => newSession('shell')),

    vscode.commands.registerCommand('codeWorkbench.sessions.newFromEditor', async () => {
      const launch = await pickSessionLaunch();
      if (!launch) return;
      const wt = await ensureActiveWorktree();
      if (!wt) return;
      if (launch.kind === 'profile') {
        await sessionMgr.create('shell', wt, launch.profile);
      } else {
        await sessionMgr.create(launch.kind, wt);
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.open', (item: SessionItem) => {
      if (!item) return;
      void sessionMgr.open(item.session);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.rename', async (item: SessionItem) => {
      if (!item) return;
      const next = await vscode.window.showInputBox({
        prompt: 'Rename session',
        value: item.session.title,
      });
      if (!next) return;
      await sessionMgr.rename(item.session.id, next);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.close', async (item: SessionItem) => {
      if (!item) return;
      await sessionMgr.close(item.session.id);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.closeInactive', async () => {
      const worktree = sessionMgr.getActiveWorktree();
      const removed = await sessionMgr.closeInactive(worktree);
      if (removed === 0) {
        void vscode.window.showInformationMessage('No inactive sessions to remove.');
      } else {
        void vscode.window.showInformationMessage(
          `Removed ${removed} inactive session${removed === 1 ? '' : 's'}.`,
        );
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.setIcon', async (item: SessionItem) => {
      if (!item) return;
      const presets: Array<{
        label: string;
        description?: string;
        id: string | undefined;
      }> = [
        {
          label: '$(sparkle) sparkle',
          description: 'default (Claude)',
          id: 'sparkle',
        },
        {
          label: '$(terminal) terminal',
          description: 'default (Shell)',
          id: 'terminal',
        },
        { label: '$(rocket) rocket', id: 'rocket' },
        { label: '$(beaker) beaker', id: 'beaker' },
        { label: '$(bug) bug', id: 'bug' },
        { label: '$(zap) zap', id: 'zap' },
        { label: '$(flame) flame', id: 'flame' },
        { label: '$(star-full) star-full', id: 'star-full' },
        { label: '$(heart) heart', id: 'heart' },
        { label: '$(robot) robot', id: 'robot' },
        { label: '$(tools) tools', id: 'tools' },
        { label: '$(gear) gear', id: 'gear' },
        { label: '$(flask) flask', id: 'flask' },
        { label: '$(lightbulb) lightbulb', id: 'lightbulb' },
        { label: '$(eye) eye', id: 'eye' },
        { label: '$(pulse) pulse', id: 'pulse' },
        {
          label: '$(symbol-misc) Other…',
          description: 'enter a codicon name',
          id: undefined,
        },
        { label: '$(discard) Reset to default', id: '' },
      ];
      const pick = await vscode.window.showQuickPick(presets, {
        placeHolder: 'Choose a tab icon (codicon)',
      });
      if (!pick) return;
      let next: string | undefined;
      if (pick.id === '') {
        next = undefined;
      } else if (pick.id === undefined) {
        const typed = await vscode.window.showInputBox({
          prompt: 'Codicon id (see https://microsoft.github.io/vscode-codicons/dist/codicon.html)',
          placeHolder: 'e.g. rocket',
        });
        if (typed === undefined) return;
        next = typed.trim() || undefined;
      } else {
        next = pick.id;
      }
      const stillLive = await sessionMgr.setIcon(item.session.id, next);
      if (stillLive) {
        void vscode.window.showInformationMessage(
          'Icon saved. Reopen the session to see the new tab icon.',
        );
      }
    }),
  );
}

export function deactivate(): void {}
