import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import type { ArchViewProvider } from '../archView';
import { showTasksPage } from '../tasksPage';
import { showPhaseBoardPage } from '../phaseBoardPage';
import { showArchPage } from '../archPage';
import { showSearchPanel } from '../searchPanel';
import { showThemeTokensPanel } from '../themeTokensPanel';

export interface PageCommandDeps {
  sessionMgr: SessionManager;
  archProvider: ArchViewProvider;
  getRepoRoot: () => string | undefined;
  getRepoKey: () => string | undefined;
  refreshTaskSurfaces: () => void;
}

/** Hybrid AST + symbol code search — the QuickBar `search-code` command,
 *  surfaced in the VS Code command palette. Prompts for a query, then opens
 *  the results page (editor-tab webview) showing every match with its code
 *  snippet; clicking a card opens the file at that line. */
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
  showSearchPanel(ctx, repoRoot, query);
}

export function registerPageCommands(
  ctx: vscode.ExtensionContext,
  { sessionMgr, archProvider, getRepoRoot, getRepoKey, refreshTaskSurfaces }: PageCommandDeps,
): void {
  const getActiveWorktree = () => sessionMgr.getActiveWorktree() ?? undefined;
  const openTasksPage = (opts: Parameters<typeof showTasksPage>[4]) =>
    showTasksPage(ctx, getRepoKey, getRepoRoot, getActiveWorktree, opts, refreshTaskSurfaces);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.tasks.openAsPage', () => openTasksPage({})),
    // Opening a task from the sidebar reveals the full-width board with that
    // task selected in its detail editor — editing lives in the main panel,
    // never squeezed into the narrow side view.
    vscode.commands.registerCommand('codeWorkbench.tasks.openTaskInPage', (id?: string) =>
      openTasksPage({ selectTaskId: typeof id === 'string' ? id : undefined }),
    ),
    // Creating a task opens the board with a blank editor in the detail
    // column — no more input-box chain.
    vscode.commands.registerCommand('codeWorkbench.tasks.newInPage', () =>
      openTasksPage({ create: true }),
    ),
    // The phase-flow counterpart to the Task Board: columns are phases, and
    // each card's Start button spawns that phase's bound Claude session.
    vscode.commands.registerCommand('codeWorkbench.tasks.openPhaseBoard', () =>
      showPhaseBoardPage(ctx, {
        sessionMgr,
        getRepoKey,
        getRepoRoot,
        getActiveWorktree,
        afterMutation: refreshTaskSurfaces,
      }),
    ),
    vscode.commands.registerCommand('codeWorkbench.arch.refresh', () => archProvider.refresh()),
    // Open the full-width Architecture board in the main editor area, with
    // semantic card search — the sidebar view's "open as page" counterpart.
    vscode.commands.registerCommand('codeWorkbench.arch.openAsPage', (slug?: string) =>
      showArchPage(ctx, getRepoRoot, {
        focusSlug: typeof slug === 'string' ? slug : undefined,
      }),
    ),
    vscode.commands.registerCommand('codeWorkbench.searchCode', () =>
      runSearchCodeCommand(ctx, getRepoRoot()),
    ),
    vscode.commands.registerCommand('codeWorkbench.themeTokens', () => showThemeTokensPanel()),
  );
}
