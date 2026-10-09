import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { findRepoKey, findRepoRoot, removeWorktree } from './git';
import { WorktreeItem, WorktreesProvider } from './worktreesView';
import { TasksProvider, watchTasks } from './tasksView';
import { SessionManager, SessionsProvider } from './sessions';
import { clearTaskWorktree } from './tasks';
import { initProjectWorkspace } from './workspaceInit';
import {
  checkWorkbenchSkills,
  installWorkbenchSkills,
  skillsBundleSignature,
} from './skillsBundle';
import { installWorkbenchAgents, removeUnmodifiedWorkbenchAgents } from './agentsBundle';
import { cleanupWorktreeAssets } from './worktreeAssets';
import { installWorkbenchPermissions } from './settingsPermissions';
import { registerWorkbenchMcpServers } from './mcpRegister';
import { GlobalPrefsPanel } from './globalPrefsPanel';
import { loadGlobalPrefs, loadGlobalPrefsSync, saveGlobalPrefs } from './globalPrefs';
import { BrandViewProvider } from './brandView';
import { pickWorktreeAndActivate } from './workspaceFolder';
import { registerLayoutCommands } from './commands/layoutCommands';
import { registerPageCommands } from './commands/pageCommands';
import { registerSessionCommands } from './commands/sessionCommands';
import { registerTaskCommands } from './commands/taskCommands';
import { registerWorktreeCommands } from './commands/worktreeCommands';
import { registerScanPageCommands } from './scanPages';
import { registerCodeHealthView } from './codeHealthView';
import { registerCodeReviewCommand } from './commands/codeReview';
import { registerPlanFeatureCommand } from './commands/planFeature';
import { registerIssueSync } from './issueSync';
import { captureHealthBaseline, recordHealthDelta } from './codeHealth';
import { registerReviewDiagnostics } from './reviewDiagnostics';
import { buildTaskContext } from './taskContext';
import { registerAutopilot, registerTaskFlowCommand } from './commands/taskFlow';
import { registerUpdateCommand } from './update';
import { refreshTasksPage, isTasksPageOpen } from './tasksPage';
import { refreshPhaseBoardPage, isPhaseBoardPageOpen } from './phaseBoardPage';
import { ArchViewProvider } from './archView';
import { refreshArchPage } from './archPage';
import { setAccentOverride } from './webviewTheme';
import { WORKTREE_DOT } from './panelTheme';
import { resetNodeRuntimeCache } from './nodeRuntime';
import { errorMessage } from './errors';

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
  // Delete workbench-injected skills/agents first — the worktree dir goes
  // away anyway, but this keeps removal clean even when git balks and the
  // checkout survives. Best-effort; never blocks removal.
  await cleanupWorktreeAssets(worktreePath);
  await removeWorktree(repoRootArg, worktreePath, makePendingDeletionStore(ctx));
  try {
    await clearTaskWorktree(repoKeyArg, worktreePath);
  } catch {
    /* best-effort: don't block worktree removal if task cleanup fails */
  }
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

  // The interpreter is resolved once and memoized; re-resolve when the user
  // points us at a different Node.
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeWorkbench.mcp.nodePath')) resetNodeRuntimeCache();
    }),
  );
  await sessionMgr.setRepoKey(repoKey);
  sessionMgr.setCurrentWorktreePath(repoRoot);

  // Tint every webview with this window's worktree color ("which worktree am
  // I in" at a glance). Panels created after a color change pick up the new
  // accent; already-open ones keep theirs until recreated.
  const syncAccent = () => {
    const color = repoRoot ? sessionMgr.getPrefs(repoRoot).color : undefined;
    setAccentOverride(color && color !== 'default' ? WORKTREE_DOT[color] : undefined);
  };
  syncAccent();

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
      vscode.window.showErrorMessage(`Deferred worktree removal failed: ${errorMessage(err)}`);
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

  const brandView = new BrandViewProvider(sessionMgr);
  const worktreesProvider = new WorktreesProvider(
    () => repoRoot,
    () => sessionMgr.getActiveWorktree(),
    (wt) => sessionMgr.getPrefs(wt).color,
    (wt) => sessionMgr.getPrefs(wt).note,
  );
  // Refresh BOTH task surfaces (sidebar view + full-page board) at once. Wired
  // into every task mutation so an edit in one surface reflects in the other
  // immediately, rather than waiting on the unreliable fs.watch / 3s poll.
  let refreshDiagnostics: () => void = () => undefined;
  let refreshIssueSync: () => void = () => undefined;
  const refreshTaskSurfaces = () => {
    refreshDiagnostics();
    refreshIssueSync();
    tasksProvider.refresh();
    refreshTasksPage();
    refreshPhaseBoardPage();
  };
  const tasksProvider = new TasksProvider(
    () => repoKey,
    () => sessionMgr.getActiveWorktree() ?? undefined,
    ctx.extensionUri,
    () => repoRoot,
    ctx.workspaceState,
    refreshTaskSurfaces,
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
  let boundSig = '';
  sessionMgr.onDidChange(() => {
    syncAccent();
    worktreesProvider.refresh();
    tasksProvider.refresh();
    refreshStatusBar();
    // The task page shows "running in" chips: refresh it only when the set of
    // live task-bound sessions actually changed.
    const sig = sessionMgr
      .list()
      .filter((s) => s.boundTask && sessionMgr.isOpen(s.id))
      .map((s) => s.id)
      .join(',');
    if (sig !== boundSig) {
      boundSig = sig;
      refreshTasksPage();
    }
  });
  refreshStatusBar();

  // Surface this worktree's handoff note once per window — the "where did I
  // leave off" breadcrumb written at the end of the previous session.
  if (repoRoot) {
    const note = sessionMgr.getPrefs(repoRoot).note;
    if (note) {
      void vscode.window
        .showInformationMessage(
          `Handoff note (${path.basename(repoRoot)}): ${note}`,
          'Edit',
          'Clear',
        )
        .then(async (choice) => {
          if (choice === 'Edit') {
            await vscode.commands.executeCommand('codeWorkbench.worktrees.editNote');
          } else if (choice === 'Clear' && repoRoot) {
            await sessionMgr.setPrefs(repoRoot, { note: undefined });
          }
        });
    }
  }

  const archProvider = new ArchViewProvider(ctx, () => repoRoot, refreshArchPage);

  registerPageCommands(ctx, {
    sessionMgr,
    archProvider,
    getRepoRoot: () => repoRoot,
    getRepoKey: () => repoKey,
    refreshTaskSurfaces,
  });

  ctx.subscriptions.push(
    statusBar,
    // Code-health scans open full editor-tab pages (the old sidebar scan
    // views are gone — the Tools action bar triggers these commands).
    ...registerScanPageCommands(
      ctx,
      () => repoRoot,
      () => repoKey,
    ),
    registerCodeHealthView(),
    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.editNote',
      async (item?: WorktreeItem) => {
        const target = item?.wt.path ?? repoRoot;
        if (!target) {
          vscode.window.showWarningMessage('Open a git repository first.');
          return;
        }
        const current = sessionMgr.getPrefs(target).note ?? '';
        const next = await vscode.window.showInputBox({
          title: `Handoff note — ${path.basename(target)}`,
          prompt:
            'Where did you leave off? Shown when the next session opens this worktree. Empty clears the note.',
          value: current,
        });
        if (next === undefined) return;
        await sessionMgr.setPrefs(target, { note: next.trim() || undefined });
      },
    ),
    vscode.window.registerWebviewViewProvider(BrandViewProvider.viewId, brandView),
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
      syncAccent();
      worktreesProvider.refresh();
      tasksProvider.refresh();
      archProvider.onRepoChanged();
      refreshStatusBar();
    }),
    vscode.window.registerWebviewViewProvider(ArchViewProvider.viewId, archProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    watchTasks(
      () => repoKey,
      refreshTaskSurfaces,
      () => tasksProvider.isVisible() || isTasksPageOpen() || isPhaseBoardPageOpen(),
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
          vscode.window.showErrorMessage(`Install skills failed: ${errorMessage(e)}`);
        }
      },
    ),
  );

  // ── Skills drift check ─ where workbench skills were previously installed,
  // detect copies that differ from this release's bundled versions and prompt
  // to update (never auto-write). A dismissal is remembered per scope until
  // the bundled skill set changes again.
  const promptSkillsDrift = async (scope: 'user' | 'project', target: string) => {
    try {
      const drift = await checkWorkbenchSkills(target);
      if (!drift.installedAny) return; // never opted in here — don't nag
      const parts: string[] = [];
      if (drift.stale.length) parts.push(`${drift.stale.length} outdated`);
      if (drift.missing.length) parts.push(`${drift.missing.length} not installed`);
      if (drift.legacy.length) parts.push(`${drift.legacy.length} legacy`);
      if (!parts.length) return;
      const promptKey = `codeWorkbench.skillsDriftDismissed.${scope}`;
      const sig = skillsBundleSignature();
      if (ctx.globalState.get<string>(promptKey) === sig) return;
      const where = scope === 'user' ? '~/.claude' : path.basename(target);
      const pick = await vscode.window.showInformationMessage(
        `Code Workbench skills in ${where} are out of date (${parts.join(', ')}).`,
        'Update skills',
        'Not now',
      );
      if (pick === 'Update skills') {
        await vscode.commands.executeCommand('codeWorkbench.installWorkbenchSkills', scope);
      } else {
        await ctx.globalState.update(promptKey, sig);
      }
    } catch (e) {
      console.error('Skills drift check failed', e);
    }
  };
  // ── Install workbench agent definitions into .claude/agents ──────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.installWorkbenchAgents',
      async (scope?: 'user' | 'project') => {
        const target =
          scope === 'user' ? os.homedir() : (sessionMgr.getActiveWorktree() ?? repoRoot);
        if (!target) {
          vscode.window.showWarningMessage('Open a git repository first.');
          return;
        }
        try {
          const { installed, removed } = await installWorkbenchAgents(target);
          const parts: string[] = [];
          if (installed.length) parts.push(`installed ${installed.join(', ')}`);
          if (removed.length) parts.push(`removed legacy ${removed.join(', ')}`);
          const where = scope === 'user' ? 'user (~/.claude)' : path.basename(target);
          vscode.window.showInformationMessage(
            `Workbench agents: ${parts.join('; ') || 'nothing to do'} at ${where}.`,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Install agents failed: ${errorMessage(e)}`);
        }
      },
    ),
  );

  // ── Agents backfill retirement ─ agents are now injected per-worktree on
  // every session launch (worktreeAssets.ts), so the old user-scope backfill
  // into ~/.claude/agents is gone. One time, remove the copies that backfill
  // left behind: byte-identical files are deleted silently; modified ones get
  // a single prompt (they may carry user edits). Explicit user-scope installs
  // via the command/prefs remain available and are not touched again after
  // this runs once.
  const retireUserAgentBackfill = async () => {
    const doneKey = 'codeWorkbench.userAgentsBackfillRetired';
    if (ctx.globalState.get<boolean>(doneKey)) return;
    try {
      const { removed, kept } = await removeUnmodifiedWorkbenchAgents(os.homedir());
      if (kept.length) {
        const pick = await vscode.window.showInformationMessage(
          `Code Workbench agents now install per-worktree. ${kept.length} modified cop${
            kept.length === 1 ? 'y' : 'ies'
          } remain in ~/.claude/agents (${kept.join(', ')}) — remove them too?`,
          'Remove',
          'Keep',
        );
        if (pick === 'Remove') {
          const dir = path.join(os.homedir(), '.claude', 'agents');
          for (const name of kept) {
            await vscode.workspace.fs.delete(vscode.Uri.file(path.join(dir, `${name}.md`)));
          }
        } else if (pick === undefined) {
          return; // dismissed without deciding — ask again next activation
        }
      } else if (removed.length) {
        vscode.window.showInformationMessage(
          `Code Workbench agents now install per-worktree; removed ${removed.length} auto-installed cop${
            removed.length === 1 ? 'y' : 'ies'
          } from ~/.claude/agents.`,
        );
      }
      await ctx.globalState.update(doneKey, true);
    } catch (e) {
      console.error('User agents backfill retirement failed', e);
    }
  };

  // ── Install workbench MCP permissions into <target>/.claude/settings.json ──
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.installWorkbenchPermissions',
      async (scope?: 'user' | 'project') => {
        const target =
          scope === 'user' ? os.homedir() : (sessionMgr.getActiveWorktree() ?? repoRoot);
        if (!target) {
          vscode.window.showWarningMessage('Open a git repository first.');
          return;
        }
        try {
          const added = await installWorkbenchPermissions(target);
          const where = scope === 'user' ? 'user (~/.claude)' : path.basename(target);
          vscode.window.showInformationMessage(
            `Workbench permissions: ${added.length ? `added ${added.join(', ')}` : 'nothing to do'} at ${where}.`,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Install permissions failed: ${errorMessage(e)}`);
        }
      },
    ),
  );

  // ── Permissions backfill ─ merge Code Workbench's MCP permissions into
  // ~/.claude/settings.json on every activation, so cw-code tool calls never
  // prompt for approval in any project. Merges and no-ops when already there.
  // Project scope is deliberately never written on activation: a repo's
  // .claude/settings.json is usually tracked, and backfilling it would dirty
  // the working tree. Reach it explicitly via Preferences instead.
  const installUserPermissions = async () => {
    try {
      await installWorkbenchPermissions(os.homedir());
    } catch (e) {
      console.error('User permissions backfill failed', e);
    }
  };

  // ── MCP server backfill ─ same reasoning as the permissions backfill above:
  // merge Code Workbench's MCP servers into ~/.claude.json on every activation
  // so cw-code tools are always reachable, without ever touching project scope.
  const registerUserMcpServers = async () => {
    try {
      await registerWorkbenchMcpServers(ctx.extensionPath, os.homedir());
    } catch (e) {
      console.error('User MCP server backfill failed', e);
    }
  };

  void (async () => {
    // Sequential so scopes/checks never stack notifications on one activation.
    await promptSkillsDrift('user', os.homedir());
    await retireUserAgentBackfill();
    await installUserPermissions();
    await registerUserMcpServers();
  })();

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
          vscode.window.showErrorMessage(`Register MCP servers failed: ${errorMessage(e)}`);
        }
      },
    ),
  );

  registerLayoutCommands(ctx);

  registerUpdateCommand(ctx);

  registerCodeReviewCommand(ctx, { sessionMgr, ensureActiveWorktree });

  registerPlanFeatureCommand(ctx, { sessionMgr, ensureActiveWorktree });

  // The gate guards phases that change code; Plan/Review/Ship leave it alone.
  const healthGateOn = (phase: string): boolean =>
    (phase === 'implement' || phase === 'fix') &&
    vscode.workspace
      .getConfiguration('codeWorkbench')
      .get<boolean>('codeHealth.scanOnPhaseDone', true);
  const taskFlowDeps = {
    sessionMgr,
    getRepoKey: () => repoKey,
    getRepoRoot: () => repoRoot,
    ensureActiveWorktree,
    onPhaseStart: async (wt: string, taskId: string, phase: string) => {
      if (repoKey && healthGateOn(phase)) await captureHealthBaseline(ctx, repoKey, wt, taskId);
    },
    onPhaseDone: async (wt: string, taskId: string, phase: string) => {
      if (repoKey && healthGateOn(phase)) await recordHealthDelta(ctx, repoKey, wt, taskId);
    },
    prefetchContext: async (wt: string, task: { title: string; description: string }) =>
      vscode.workspace
        .getConfiguration('codeWorkbench')
        .get<boolean>('taskFlow.prefetchContext', true)
        ? buildTaskContext(ctx, wt, task).catch(() => '')
        : '',
  };
  registerTaskFlowCommand(ctx, taskFlowDeps);
  registerAutopilot(ctx, taskFlowDeps);

  refreshDiagnostics = registerReviewDiagnostics(ctx, {
    getRepoKey: () => repoKey,
    getRepoRoot: () => repoRoot,
    getActiveWorktree: () => sessionMgr.getActiveWorktree() ?? undefined,
    afterMutation: refreshTaskSurfaces,
  }).refresh;
  // Unassigned findings resolve against the active worktree, so a switch must
  // republish them (onDidChange fires for many reasons; only act on a real change).
  let lastActiveWorktree = sessionMgr.getActiveWorktree();
  ctx.subscriptions.push(
    sessionMgr.onDidChange(() => {
      const active = sessionMgr.getActiveWorktree();
      if (active === lastActiveWorktree) return;
      lastActiveWorktree = active;
      refreshDiagnostics();
    }),
  );

  refreshIssueSync = registerIssueSync(ctx, {
    getRepoKey: () => repoKey,
    getRepoRoot: () => repoRoot,
  }).refresh;

  registerTaskCommands(ctx, { tasksProvider });

  registerSessionCommands(ctx, { sessionMgr, ensureActiveWorktree });
}

export function deactivate(): void {}
