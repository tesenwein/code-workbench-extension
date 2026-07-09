/* Task-bound phase flow: Plan -> Implement -> Review -> Fix.
 *
 * Generalizes the pattern in commands/codeReview.ts (a Claude session with a
 * fixed model + prompt) to any task on the board: each phase spawns a session
 * scoped to that one task, primed to read/update it via the cw-tasks MCP
 * tools, and to hand off to the next phase by setting the task's `phase`
 * field. The board is the state machine, not the chat transcript — closing
 * the session and reopening the task later loses nothing. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import type { ClaudeEffort } from '../sessionTypes';
import type { TaskPhase } from '@code-workbench/mcp-core/task-format';
import { worktreeKey } from '@code-workbench/mcp-core/task-format';
import { listTasks, updateTask } from '../tasks';
import { listWorktrees } from '../git';

interface PhaseSpec {
  readonly label: string;
  readonly icon: string;
  readonly model: 'opus' | 'sonnet';
  /** Forces read-only planning via `claude --permission-mode plan`. */
  readonly planOnly?: boolean;
  /** Overrides the worktree's effort pref for this phase's session. */
  readonly effort?: ClaudeEffort;
  buildPrompt(task: { id: string; title: string; description: string; memo: string }): string;
}

const TASK_REF = (id: string) =>
  `Work ONLY on task [${id.slice(0, 8)}] (full id: ${id}) on the shared cw-tasks board. Start by finding it via task_list or task_find_similar and re-reading its current title, description, memo, and subtasks — do not rely on anything below going stale.`;

export const TASK_PHASES: Record<TaskPhase, PhaseSpec> = {
  plan: {
    label: 'Plan',
    icon: 'compass',
    model: 'opus',
    planOnly: true,
    effort: 4,
    buildPrompt: (task) =>
      [
        `PLAN phase. ${TASK_REF(task.id)}`,
        '',
        `Task: ${task.title}`,
        task.description ? `\n${task.description}` : '',
        '',
        'Explore the codebase enough to design a concrete implementation approach — do not guess at unfamiliar code. You are running in --permission-mode plan: file edits are blocked, so there is no risk in exploring freely.',
        '',
        'When you have an approach:',
        `1. Write it into the task's memo via task_update (id: "${task.id}", memo: "...").`,
        `2. Break it into concrete implementation subtasks via task_create (parentId: "${task.id}", tags: ["plan-step"]), ordered so the Implement phase can work them one by one.`,
        `3. Finally task_update the task itself: id: "${task.id}", phase: "implement".`,
        '',
        'Stop once the plan and subtasks are filed. Do not start implementing.',
      ].join('\n'),
  },
  implement: {
    label: 'Implement',
    icon: 'rocket',
    model: 'sonnet',
    buildPrompt: (task) =>
      [
        `IMPLEMENT phase. ${TASK_REF(task.id)}`,
        '',
        `Task: ${task.title}`,
        task.description ? `\n${task.description}` : '',
        task.memo ? `\nPlan memo:\n${task.memo}` : '',
        '',
        'Work its subtasks tagged "plan-step" in order (if there are none, work the task\'s description directly). Mark each subtask in-progress before you start it and done when it passes. Run whatever lint, typecheck, and test scripts the project has; treat a failure as unfinished work, not a separate finding.',
        '',
        `When every "plan-step" subtask (or the task itself, if it had none) is done, task_update the task: id: "${task.id}", phase: "review".`,
      ].join('\n'),
  },
  review: {
    label: 'Review',
    icon: 'checklist',
    model: 'sonnet',
    buildPrompt: (task) =>
      [
        `REVIEW phase. ${TASK_REF(task.id)}`,
        '',
        `Task: ${task.title}`,
        '',
        "Review the work done for this task: `git status --short`, `git diff`, `git diff --staged`, and this branch's commits vs its base (resolve origin/HEAD, else develop, else main/master). Read surrounding files for context. Look for correctness bugs, logic errors, missing error handling, type-safety escapes, security issues, and needless complexity.",
        '',
        `File each real finding as a subtask via task_create (parentId: "${task.id}", tags: ["review-finding"], priority reflecting severity, description: "file:line, what is wrong, why it matters, suggested fix").`,
        '',
        `Then task_update the task: id: "${task.id}", phase: "fix" if you filed any findings, otherwise phase: "" (clear it) and status: "done" if nothing else is pending.`,
      ].join('\n'),
  },
  fix: {
    label: 'Fix',
    icon: 'wrench',
    model: 'sonnet',
    buildPrompt: (task) =>
      [
        `FIX phase. ${TASK_REF(task.id)}`,
        '',
        `Task: ${task.title}`,
        '',
        'List its open subtasks tagged "review-finding" and fix each one: mark it in-progress before you start, done once fixed. Re-run lint, typecheck, and tests at the end.',
        '',
        `When every "review-finding" subtask is done, task_update the task: id: "${task.id}", phase: "" (clear it), status: "done".`,
      ].join('\n'),
  },
};

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
        if (!taskId || !phase || !key || !repoRoot || !(phase in TASK_PHASES)) return;

        const tasks = await listTasks(key);
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
          void vscode.window.showErrorMessage('Task not found — it may have been deleted.');
          return;
        }

        const wt = await resolveTaskWorktree(repoRoot, task.worktree, deps.ensureActiveWorktree);
        if (!wt) return;

        const spec = TASK_PHASES[phase];
        await updateTask(key, task.id, { phase });
        await deps.sessionMgr.create('claude', wt, undefined, {
          title: `${spec.label}: ${task.title}`.slice(0, 80),
          icon: spec.icon,
          model: spec.model,
          prompt: spec.buildPrompt(task),
          ...(spec.planOnly ? { permissionMode: 'plan' } : {}),
          ...(spec.effort != null ? { effort: spec.effort } : {}),
        });
      },
    ),
  );
}
