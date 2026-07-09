/* Task-bound phase flow: Plan -> Implement -> Review -> Fix.
 *
 * Generalizes the pattern in commands/codeReview.ts (a Claude session with a
 * fixed model + prompt) to any task on the board: each phase spawns a session
 * scoped to that one task, primed to read/update it via the cw-tasks MCP
 * tools, and to hand off to the next phase by setting the task's `phase`
 * field. The board is the state machine, not the chat transcript — closing
 * the session and reopening the task later loses nothing.
 *
 * The prompts and per-phase model live in mcp-core/phase-prompts, shared with
 * the bundled `/cw-implement`, `/cw-review`, `/cw-fix` skills so a phase run by
 * hand and a phase run from the board follow the same procedure. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import type { TaskPhase } from '@code-workbench/mcp-core/task-format';
import { worktreeKey } from '@code-workbench/mcp-core/task-format';
import { PHASE_META, phasePrompt } from '@code-workbench/mcp-core/phase-prompts';
import { listTasks, updateTask } from '../tasks';
import { listWorktrees } from '../git';

/** Resolve a task's `worktree` (a lowercased-basename key, NOT a path — see
 *  task-format.cjs worktreeKey) to an actual worktree path. Falls back to the
 *  active worktree for unassigned tasks. */
async function resolveTaskWorktree(
  repoRoot: string,
  taskWorktreeKey: string | null,
  fallback: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (taskWorktreeKey) {
    try {
      const trees = await listWorktrees(repoRoot);
      const match = trees.find((w) => worktreeKey(w.path) === taskWorktreeKey);
      if (match) return match.path;
    } catch {
      /* fall through to the active-worktree fallback */
    }
  }
  return fallback();
}

export function registerTaskFlowCommand(
  ctx: vscode.ExtensionContext,
  deps: {
    sessionMgr: SessionManager;
    getRepoKey: () => string | undefined;
    getRepoRoot: () => string | undefined;
    ensureActiveWorktree: () => Promise<string | undefined>;
  },
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.tasks.startPhase',
      async (taskId?: string, phase?: TaskPhase) => {
        const key = deps.getRepoKey();
        const repoRoot = deps.getRepoRoot();
        if (!taskId || !phase || !key || !repoRoot || !(phase in PHASE_META)) return;

        const tasks = await listTasks(key);
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
          void vscode.window.showErrorMessage('Task not found — it may have been deleted.');
          return;
        }

        const wt = await resolveTaskWorktree(repoRoot, task.worktree, deps.ensureActiveWorktree);
        if (!wt) return;

        const spec = PHASE_META[phase];
        await updateTask(key, task.id, { phase });
        await deps.sessionMgr.create('claude', wt, undefined, {
          title: `${spec.label}: ${task.title}`.slice(0, 80),
          icon: spec.icon,
          // Settings can override the phase's built-in model, globally or per worktree.
          model: deps.sessionMgr.resolvePhaseModel(wt, phase),
          prompt: phasePrompt(phase, task),
          ...(spec.planOnly ? { permissionMode: 'plan' } : {}),
          ...(spec.effort != null ? { effort: spec.effort } : {}),
        });
      },
    ),
  );
}
