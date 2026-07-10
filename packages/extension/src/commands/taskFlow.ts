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

export interface TaskFlowDeps {
  sessionMgr: SessionManager;
  getRepoKey: () => string | undefined;
  getRepoRoot: () => string | undefined;
  ensureActiveWorktree: () => Promise<string | undefined>;
}

/** Why a phase failed to start. `no-worktree` is a benign abort (the user
 *  dismissed the worktree picker), everything else is worth reporting. */
export type TaskFlowFailure = 'task-not-found' | 'no-worktree';

export class TaskFlowError extends Error {
  constructor(
    readonly code: TaskFlowFailure,
    message: string,
  ) {
    super(message);
    this.name = 'TaskFlowError';
  }
}

/** Spawn a Claude session running `phase` for one task. The single source of
 *  truth for what "start a phase" means — the `startPhase` command and the
 *  bulk fan-out both go through here, so they cannot drift. */
export async function startTaskPhase(
  deps: TaskFlowDeps,
  key: string,
  repoRoot: string,
  taskId: string,
  phase: TaskPhase,
): Promise<void> {
  const tasks = await listTasks(key);
  const task = tasks.find((t) => t.id === taskId);
  if (!task)
    throw new TaskFlowError('task-not-found', 'Task not found — it may have been deleted.');

  const wt = await resolveTaskWorktree(repoRoot, task.worktree, deps.ensureActiveWorktree);
  if (!wt) throw new TaskFlowError('no-worktree', 'No worktree to run this phase in.');

  const spec = PHASE_META[phase];
  // Never write `phase` here: it names the phase to run NEXT, and only a
  // phase session that actually finished its work may advance it. Writing
  // the phase we are launching would make `phase:'plan'` mean the same as
  // `phase:null` ("no plan exists yet") and offer to re-plan a planned
  // task. Status is the honest signal that a session is live.
  if (task.status === 'open') await updateTask(key, task.id, { status: 'in-progress' });
  await deps.sessionMgr.create('claude', wt, undefined, {
    title: `${spec.label}: ${task.title}`.slice(0, 80),
    icon: spec.icon,
    // Settings can override the phase's built-in model, globally or per worktree.
    model: deps.sessionMgr.resolvePhaseModel(wt, phase),
    prompt: phasePrompt(phase, task),
    ...(spec.effort != null ? { effort: spec.effort } : {}),
  });
}

/** Outcome of a bulk fan-out: one entry per task we actually tried to start.
 *  Tasks skipped as stale (deleted, or already in-progress when the user chose
 *  not to include those) appear in neither list — they are not failures. */
export interface BulkStartResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/** Start `phase` for every id, each in its own session. The ids come from the
 *  board's snapshot, so re-read the live status and drop anything that has
 *  since been deleted, finished, or picked up by another session (unless the
 *  user explicitly asked to include in-progress tasks).
 *
 *  Deliberately un-throttled: the confirmation modal's count is the user's
 *  guard against starting more sessions than they meant to. */
export async function startTaskPhaseBulk(
  deps: TaskFlowDeps,
  key: string,
  repoRoot: string,
  ids: string[],
  phase: TaskPhase,
  includeInProgress: boolean,
): Promise<BulkStartResult> {
  // De-dupe: a stale board snapshot listing a task twice must not double-spawn.
  const unique = [...new Set(ids)];
  const live = new Map((await listTasks(key)).map((t) => [t.id, t]));
  const runnable = unique.filter((id) => {
    const task = live.get(id);
    if (!task || task.status === 'done') return false;
    return includeInProgress || task.status === 'open';
  });

  const settled = await Promise.allSettled(
    runnable.map((id) => startTaskPhase(deps, key, repoRoot, id, phase)),
  );

  const result: BulkStartResult = { succeeded: [], failed: [] };
  settled.forEach((outcome, i) => {
    const id = runnable[i];
    if (outcome.status === 'fulfilled') result.succeeded.push(id);
    else
      result.failed.push({
        id,
        error:
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason ?? ''),
      });
  });
  return result;
}

export function registerTaskFlowCommand(ctx: vscode.ExtensionContext, deps: TaskFlowDeps): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'codeWorkbench.tasks.startPhase',
      async (taskId?: string, phase?: TaskPhase) => {
        const key = deps.getRepoKey();
        const repoRoot = deps.getRepoRoot();
        if (!taskId || !phase || !key || !repoRoot || !(phase in PHASE_META)) return;
        try {
          await startTaskPhase(deps, key, repoRoot, taskId, phase);
        } catch (err) {
          if (err instanceof TaskFlowError) {
            // A missing worktree means the user backed out of the picker — the
            // original inline body just returned, so stay silent here too.
            if (err.code !== 'no-worktree') void vscode.window.showErrorMessage(err.message);
            return;
          }
          throw err;
        }
      },
    ),
    vscode.commands.registerCommand(
      'codeWorkbench.tasks.startPhaseBulk',
      async (
        ids?: string[],
        phase?: TaskPhase,
        includeInProgress = false,
      ): Promise<BulkStartResult> => {
        const empty: BulkStartResult = { succeeded: [], failed: [] };
        const key = deps.getRepoKey();
        const repoRoot = deps.getRepoRoot();
        if (!ids?.length || !phase || !key || !repoRoot || !(phase in PHASE_META)) return empty;
        return startTaskPhaseBulk(deps, key, repoRoot, ids, phase, includeInProgress);
      },
    ),
  );
}
