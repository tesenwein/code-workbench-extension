/* Full editor-tab Phase Board.
 *
 * The Task Board page answers "what work exists"; this page answers "what does
 * each task need next". Columns are the phase flow (Unstarted → Plan →
 * Implement → Review → Fix); a card's Start button spawns the bound Claude
 * session for that phase via the same codeWorkbench.tasks.startPhase command
 * the TaskDetailPane stepper uses — so the two surfaces can't disagree about
 * what "next" means.
 *
 * Reuses buildTaskRpcHandlers (task CRUD + startPhase) and adds the resolved
 * per-worktree phase→model map, which the board shows on each Start button. */

import * as vscode from 'vscode';
import { showPage, getPage } from './pagePanel';
import { buildTaskRpcHandlers } from './tasksView';
import { listWorktrees } from './git';
import { worktreeKey } from '@code-workbench/mcp-core/task-format';
import type { TaskPhase } from '@code-workbench/mcp-core/phase-prompts';
import type { ClaudeModel, SessionManager } from './sessions';

const VIEW_TYPE = 'codeWorkbench.page.phaseBoard';

/** Mirrors PhaseModelMap in @code-workbench/ui — what the board renders. */
interface PhaseModelMap {
  fallback: Record<TaskPhase, ClaudeModel>;
  byWorktreeKey: Record<string, Record<TaskPhase, ClaudeModel>>;
}

/** Resolved phase→model for every worktree, plus the active worktree's map as
 *  the fallback for unassigned tasks (which run wherever the user is). */
async function phaseModelMap(
  sessionMgr: SessionManager,
  getRepoRoot: () => string | undefined,
  getActiveWorktree: () => string | undefined,
): Promise<PhaseModelMap> {
  const active = getActiveWorktree();
  const byWorktreeKey: PhaseModelMap['byWorktreeKey'] = {};
  const root = getRepoRoot();
  if (root) {
    try {
      for (const wt of await listWorktrees(root)) {
        byWorktreeKey[worktreeKey(wt.path)] = sessionMgr.resolvePhaseModels(wt.path);
      }
    } catch {
      /* best-effort — cards fall back to the active worktree's models */
    }
  }
  return {
    fallback: sessionMgr.resolvePhaseModels(active ?? root ?? ''),
    byWorktreeKey,
  };
}

export function showPhaseBoardPage(
  ctx: vscode.ExtensionContext,
  deps: {
    sessionMgr: SessionManager;
    getRepoKey: () => string | undefined;
    getRepoRoot: () => string | undefined;
    getActiveWorktree: () => string | undefined;
    /** Refresh the sidebar Tasks view after a mutation made from this page. */
    afterMutation?: () => void;
  },
): void {
  const pushModels = async (rpc: { postEvent(name: string, payload: unknown): void }) => {
    rpc.postEvent(
      'phase-models',
      await phaseModelMap(deps.sessionMgr, deps.getRepoRoot, deps.getActiveWorktree),
    );
  };
  const refresh = (rpc: { postEvent(name: string, payload: unknown): void }) => {
    rpc.postEvent('tasks-changed', null);
    void pushModels(rpc);
  };

  showPage({
    ctx,
    viewType: VIEW_TYPE,
    title: 'Phase Board',
    entry: 'phaseboard',
    handlers: {
      ...buildTaskRpcHandlers(deps.getRepoKey, deps.afterMutation),
      openTaskPage: async (id: unknown) => {
        await vscode.commands.executeCommand('codeWorkbench.tasks.openTaskInPage', String(id));
      },
    },
    onReady: (rpc) => void pushModels(rpc),
    onReveal: refresh,
    // Starting a phase mutates the task, but the session is spawned by a
    // command outside this page's RPC round-trip — re-list on return so the
    // card lands in its new column.
    onVisible: refresh,
  });
}

/** Tell the open phase board (if any) to re-list — wired to the tasks watcher. */
export function refreshPhaseBoardPage(): void {
  getPage(VIEW_TYPE)?.rpc?.postEvent('tasks-changed', null);
}

/** Whether the phase board tab is currently visible — keeps the tasks
 *  file-watcher poll alive while the user is looking at it. */
export function isPhaseBoardPageOpen(): boolean {
  return getPage(VIEW_TYPE)?.panel.visible ?? false;
}
