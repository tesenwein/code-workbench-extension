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
import type { SavedSession } from '../sessionTypes';
import type { TaskPhase } from '@code-workbench/mcp-core/task-format';
import { worktreeKey } from '@code-workbench/mcp-core/task-format';
import { PHASE_META, phasePrompt, phasePromptBulk } from '@code-workbench/mcp-core/phase-prompts';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { listTasks, updateTask } from '../tasks';
import { formatTokens, usageDetail, usageTotal } from '../sessionLaunch';
import { decideNextPhase, describeStop } from '../phaseAutopilot';
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
  /** Prefetch arch cards / code hits for a task in `wt`, rendered for the
   *  prompt. Omitted (or '' result) → the prompt carries no context section. */
  prefetchContext?: (wt: string, task: Task) => Promise<string>;
  /** Awaited right before a phase session spawns — the code-health gate
   *  snapshots its baseline here, so it must finish before the agent edits. */
  onPhaseStart?: (wt: string, taskId: string, phase: TaskPhase) => void | Promise<void>;
  /** Awaited when a bound session reports done, BEFORE autopilot decides, so
   *  whatever it records (code-health memo line) is visible to the next phase. */
  onPhaseDone?: (wt: string, taskId: string, phase: TaskPhase) => Promise<void>;
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
  /** Run here instead of resolving the task's worktree (autopilot: the tree the
   *  previous phase session ran in, never the currently active one). */
  worktreeOverride?: string,
): Promise<void> {
  const tasks = await listTasks(key);
  const task = tasks.find((t) => t.id === taskId);
  if (!task)
    throw new TaskFlowError('task-not-found', 'Task not found — it may have been deleted.');

  const wt =
    worktreeOverride ??
    (await resolveTaskWorktree(repoRoot, task.worktree, deps.ensureActiveWorktree));
  if (!wt) throw new TaskFlowError('no-worktree', 'No worktree to run this phase in.');

  const spec = PHASE_META[phase];
  // Build the prompt (which may search for context) BEFORE flipping status, so
  // the board never shows a task as running while its session is still being prepared.
  const prompt = phasePrompt(phase, task, await deps.prefetchContext?.(wt, task));
  // Never write `phase` here: it names the phase to run NEXT, and only a
  // phase session that actually finished its work may advance it. Writing
  // the phase we are launching would make `phase:'plan'` mean the same as
  // `phase:null` ("no plan exists yet") and offer to re-plan a planned
  // task. Status is the honest signal that a session is live.
  if (task.status === 'open') await updateTask(key, task.id, { status: 'in-progress' });
  await deps.onPhaseStart?.(wt, task.id, phase);
  await deps.sessionMgr.create('claude', wt, undefined, {
    title: `${spec.label}: ${task.title}`.slice(0, 80),
    icon: spec.icon,
    // Settings can override the phase's built-in model, globally or per worktree.
    model: deps.sessionMgr.resolvePhaseModel(wt, phase),
    prompt,
    ...(spec.effort != null ? { effort: spec.effort } : {}),
    boundTask: { id: task.id, phase },
  });
}

/** Progress toast while a phase session is prepared (context prefetch can take seconds). */
function withPreparing<T>(work: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Preparing phase session…' },
    work,
  );
}

/** Overall budget for a batch's prefetch: searches run concurrently, and
 *  whatever has not finished by the deadline is simply left out. */
const PREFETCH_BUDGET_MS = 8000;

/** Prefetch context for every task of a batch, concurrently and under one
 *  shared deadline (each result is already size-capped). */
async function prefetchAll(
  deps: TaskFlowDeps,
  wt: string,
  tasks: Task[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!deps.prefetchContext) return out;
  const prefetch = deps.prefetchContext;
  const all = Promise.all(
    tasks.map(async (t) => {
      const text = await prefetch(wt, t).catch(() => '');
      if (text) out[t.id] = text;
    }),
  );
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    all,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PREFETCH_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  return { ...out };
}

/** Outcome of a bulk start: one entry per task we actually tried to start.
 *  Tasks skipped as stale (deleted, or already in-progress when the user chose
 *  not to include those) appear in neither list — they are not failures. */
export interface BulkStartResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/** Spawn ONE session that runs `phase` over `tasks`, strictly sequentially.
 *  All of them must live in `wt` — a phase edits the working
 *  tree, so a batch can only span tasks that share one. */
async function startTaskPhaseBatch(
  deps: TaskFlowDeps,
  key: string,
  wt: string,
  tasks: Task[],
  phase: TaskPhase,
): Promise<void> {
  const spec = PHASE_META[phase];
  const title =
    tasks.length === 1
      ? `${spec.label}: ${tasks[0].title}`
      : `${spec.label}: ${tasks.length} tasks`;
  // Prefetch under one deadline BEFORE flipping status, so the board never
  // shows tasks as running while their session is still being prepared.
  const prompt = phasePromptBulk(phase, tasks, await prefetchAll(deps, wt, tasks));
  // Flip status before spawning, for the same reason as the single-task path:
  // status — not `phase` — is what says a session is live on this task.
  for (const t of tasks) {
    if (t.status === 'open') await updateTask(key, t.id, { status: 'in-progress' });
  }
  // One baseline per task would mean N full scans over one shared tree; only a
  // lone task gets gated (the same rule as binding a session to it).
  if (tasks.length === 1) await deps.onPhaseStart?.(wt, tasks[0].id, phase);
  await deps.sessionMgr.create('claude', wt, undefined, {
    title: title.slice(0, 80),
    icon: spec.icon,
    model: deps.sessionMgr.resolvePhaseModel(wt, phase),
    prompt,
    ...(spec.effort != null ? { effort: spec.effort } : {}),
    // A multi-task batch has no single task for hooks/usage to track, so only
    // bind a lone one; the batch binding is what lets autopilot advance each
    // member once the session reports done.
    ...(tasks.length === 1
      ? { boundTask: { id: tasks[0].id, phase } }
      : { boundBatch: { ids: tasks.map((t) => t.id), phase } }),
  });
}

/** Start `phase` for every id in as FEW sessions as possible: one chat per
 *  worktree, working its tasks one after another. "Start all" means one agent
 *  with a queue, not N agents racing over the same working tree — sessions in a
 *  shared worktree would interleave edits and produce diffs nobody can review.
 *
 *  The ids come from the board's snapshot, so re-read the live status and drop
 *  anything that has since been deleted, finished, or picked up by another
 *  session (unless the user explicitly asked to include in-progress tasks). */
export async function startTaskPhaseBulk(
  deps: TaskFlowDeps,
  key: string,
  repoRoot: string,
  ids: string[],
  phase: TaskPhase,
  includeInProgress: boolean,
): Promise<BulkStartResult> {
  // De-dupe: a stale board snapshot listing a task twice must not double-queue.
  const unique = [...new Set(ids)];
  const live = new Map((await listTasks(key)).map((t) => [t.id, t]));
  const runnable = unique
    .map((id) => live.get(id))
    .filter((t): t is Task => {
      if (!t || t.status === 'done') return false;
      return includeInProgress || t.status === 'open';
    });

  const result: BulkStartResult = { succeeded: [], failed: [] };

  // Group by the worktree each task resolves to. Tasks assigned to different
  // worktrees cannot share a session; unassigned ones fall back to the active
  // worktree and so batch together.
  const byWorktree = new Map<string, Task[]>();
  for (const task of runnable) {
    const wt = await resolveTaskWorktree(repoRoot, task.worktree, deps.ensureActiveWorktree);
    if (!wt) {
      result.failed.push({ id: task.id, error: 'No worktree to run this phase in.' });
      continue;
    }
    const group = byWorktree.get(wt);
    if (group) group.push(task);
    else byWorktree.set(wt, [task]);
  }

  for (const [wt, tasks] of byWorktree) {
    try {
      await startTaskPhaseBatch(deps, key, wt, tasks, phase);
      result.succeeded.push(...tasks.map((t) => t.id));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err ?? '');
      result.failed.push(...tasks.map((t) => ({ id: t.id, error })));
    }
  }
  return result;
}

/** The tasks a session was spawned to run: a lone bound task, or every member
 *  of a multi-task batch. Both bindings carry the phase that was launched. */
function sessionMembers(s: SavedSession): { ids: string[]; phase: TaskPhase } | undefined {
  if (s.boundTask) return { ids: [s.boundTask.id], phase: s.boundTask.phase };
  if (s.boundBatch) return { ids: s.boundBatch.ids, phase: s.boundBatch.phase };
  return undefined;
}

/** Autopilot: when a phase session reports done/needs_input, re-read its
 *  task(s) and — for each that opted in via `autoRun` and handed off — start
 *  the next phase. Members of a batch that share a next phase start again as
 *  ONE batch in the same worktree, for the same reason "Start all" batches:
 *  one agent with a queue, never N agents editing one tree. The per-task
 *  decision itself lives in phaseAutopilot.ts. */
export function registerAutopilot(ctx: vscode.ExtensionContext, deps: TaskFlowDeps): void {
  // Each session gets one verdict: a later chat turn in the same terminal must
  // not re-trigger a phase that has since been started or advanced.
  const handled = new Set<string>();
  ctx.subscriptions.push(
    deps.sessionMgr.onNotify(({ sessionId, kind }) => {
      if (kind === 'info' || handled.has(sessionId)) return;
      const session = deps.sessionMgr.list().find((s) => s.id === sessionId);
      if (session?.boundTask?.autopilotHandled || session?.boundBatch?.autopilotHandled) return;
      const members = session && sessionMembers(session);
      const key = deps.getRepoKey();
      const repoRoot = deps.getRepoRoot();
      if (!session || !members || !key || !repoRoot) return;
      const ranPhase = members.phase;
      // needs_input is not final: the session continues once the user answers.
      if (kind === 'done') {
        handled.add(sessionId);
        void deps.sessionMgr.markAutopilotHandled(sessionId);
      }
      void (async () => {
        if (kind === 'done') {
          for (const id of members.ids) {
            await deps.onPhaseDone?.(session.worktreePath, id, ranPhase).catch(() => {});
          }
        }
        const all = await listTasks(key);
        const byPhase = new Map<TaskPhase, Task[]>();
        for (const id of members.ids) {
          const task = all.find((t) => t.id === id);
          if (!task?.autoRun) continue;
          const decision = decideNextPhase({
            task,
            subtasks: all.filter((t) => t.parentId === task.id),
            event: kind,
            ranPhase,
          });
          if ('stop' in decision) {
            void vscode.window.showInformationMessage(
              `Autopilot stopped for "${task.title}": ${describeStop(decision.stop)}.`,
            );
            continue;
          }
          // Guard double-start: another live session already runs this phase.
          const dup = deps.sessionMgr.list().some((s) => {
            if (s.id === sessionId || !deps.sessionMgr.isOpen(s.id)) return false;
            const m = sessionMembers(s);
            return !!m && m.phase === decision.start && m.ids.includes(task.id);
          });
          if (dup) continue;
          const group = byPhase.get(decision.start);
          if (group) group.push(task);
          else byPhase.set(decision.start, [task]);
        }
        for (const [phase, tasks] of byPhase) {
          const what =
            tasks.length === 1 ? `"${tasks[0].title}"` : `${tasks.length} tasks`;
          void vscode.window.showInformationMessage(
            `Autopilot: starting ${PHASE_META[phase].label} for ${what}`,
          );
          try {
            // Same worktree the finished session ran in — never the active one.
            await startTaskPhaseBatch(deps, key, session.worktreePath, tasks, phase);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err ?? '');
            void vscode.window.showErrorMessage(
              `Autopilot could not start the next phase: ${msg}`,
            );
          }
        }
      })();
    }),
  );
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
          await withPreparing(() => startTaskPhase(deps, key, repoRoot, taskId, phase));
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
    // Live, unfinished sessions bound to a task, for the Tasks panel's "running
    // in" chip. One per task — the newest — so a stale earlier-phase terminal
    // never shadows the current run; sessions that reported done are over even
    // though their terminal usually stays open.
    vscode.commands.registerCommand('codeWorkbench.tasks.activeSessions', () => {
      const newest = new Map<string, { session: SavedSession; phase: TaskPhase }>();
      for (const s of deps.sessionMgr.list()) {
        const members = sessionMembers(s);
        if (!members || !deps.sessionMgr.isOpen(s.id) || deps.sessionMgr.isFinished(s.id)) {
          continue;
        }
        for (const id of members.ids) {
          const cur = newest.get(id);
          if (!cur || s.created > cur.session.created) {
            newest.set(id, { session: s, phase: members.phase });
          }
        }
      }
      return [...newest].map(([taskId, { session, phase }]) => ({
        taskId,
        sessionId: session.id,
        phase,
      }));
    }),
    // Aggregated token usage for the task detail pane (null when nothing ran).
    vscode.commands.registerCommand('codeWorkbench.tasks.usage', (taskId?: string) => {
      if (!taskId) return null;
      const u = deps.sessionMgr.getTaskUsage(taskId);
      const total = usageTotal(u);
      return total > 0 ? { label: formatTokens(total), detail: usageDetail(u) } : null;
    }),
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
        return withPreparing(() =>
          startTaskPhaseBulk(deps, key, repoRoot, ids, phase, includeInProgress),
        );
      },
    ),
  );
}
