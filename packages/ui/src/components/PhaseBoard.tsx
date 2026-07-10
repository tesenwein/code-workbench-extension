/* Phase Board — the task-bound phase flow as a kanban board.
 *
 * One column per stage of Plan → Implement → Review → Fix. A task's `phase`
 * field names the phase to run NEXT, so the column a card sits in is exactly
 * the phase its Start button launches: the board is the state machine, and
 * the button is the only way to advance it. A root task with no explicit
 * `phase` is inferred: already having plan-step subtasks means it was
 * planned already (Implement), otherwise it hasn't been planned yet (Plan).
 * Each Start spawns a Claude session bound to that one task on the model the
 * phase calls for (Plan runs on opus, the rest sonnet).
 *
 * Subtasks never appear as cards — the flow only applies to root tasks — but
 * their progress is summarized on the parent's card. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PaneHeader } from './primitives';
import type { PhaseModelMap, TaskPhase, TasksApi, WorkspaceTask } from '../types';

/* Platform-independent worktree identifier — last path segment, lowercased.
 * Mirrors worktreeKey() in @code-workbench/mcp-core/task-format. */
function worktreeKey(p: string | null | undefined): string {
  if (!p) return '';
  const seg =
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  return seg.toLowerCase();
}

const PRIORITY_COLORS: Record<WorkspaceTask['priority'], string> = {
  high: '#e05c5c',
  medium: '#d4942a',
  low: '#5c9de0',
};

const STATUS_LABELS: Record<WorkspaceTask['status'], string> = {
  open: 'open',
  'in-progress': 'in progress',
  done: 'done',
};

type ColumnKey = TaskPhase;

const COLUMNS: ColumnKey[] = ['plan', 'implement', 'review', 'fix'];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  fix: 'Fix',
};

const COLUMN_HINTS: Record<ColumnKey, string> = {
  plan: 'Explores the code, writes a memo, files plan-step subtasks.',
  implement: 'Works the plan-step subtasks until lint, typecheck and tests pass.',
  review: 'Reviews the diff and files review-finding subtasks.',
  fix: 'Fixes the review-finding subtasks, then re-runs the checks.',
};

/** Which column a task belongs in — `null` for anything the board ignores
 *  (subtasks, and finished tasks that already left the flow). A root task
 *  with no explicit `phase` is inferred from its subtasks: already having
 *  plan-step subtasks means planning happened, so it belongs in Implement;
 *  otherwise it hasn't been planned yet. */
export function columnFor(task: WorkspaceTask, children: WorkspaceTask[]): ColumnKey | null {
  if (task.parentId) return null;
  // Done wins over a lingering `phase`: marking a task done from the Task
  // Board doesn't clear `phase`, and a done task must never keep a live
  // "Start <phase>" card on the board.
  if (task.status === 'done') return null;
  if (task.phase) return task.phase;
  return children.some((c) => c.tags?.includes('plan-step')) ? 'implement' : 'plan';
}

interface SubtaskProgress {
  done: number;
  total: number;
}

function subtaskProgress(children: WorkspaceTask[], tag: string): SubtaskProgress | null {
  const tagged = children.filter((c) => c.tags?.includes(tag));
  if (tagged.length === 0) return null;
  return { done: tagged.filter((c) => c.status === 'done').length, total: tagged.length };
}

function TaskCard({
  task,
  subtasks,
  column,
  model,
  starting,
  onStart,
  onOpen,
}: {
  task: WorkspaceTask;
  subtasks: WorkspaceTask[];
  column: ColumnKey;
  /** Resolved model for this column — a settings override may replace the default. */
  model: string;
  starting: boolean;
  onStart: () => void;
  onOpen?: (id: string) => void;
}) {
  const planSteps = subtaskProgress(subtasks, 'plan-step');
  const findings = subtaskProgress(subtasks, 'review-finding');
  const phase = column;

  return (
    <div className="phase-card">
      <div className="phase-card-head">
        <span
          className="phase-card-priority"
          style={{ background: PRIORITY_COLORS[task.priority] }}
          title={`${task.priority} priority`}
        />
        <button
          type="button"
          className="phase-card-title"
          disabled={!onOpen}
          onClick={() => onOpen?.(task.id)}
          title={onOpen ? 'Open this task on the Task Board' : task.title}
        >
          {task.title}
        </button>
      </div>

      <div className="phase-card-meta">
        <span className="phase-card-id">{task.id.slice(0, 8)}</span>
        <span className={`task-status-chip task-status-${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
        {task.worktree && <span className="phase-card-chip">{task.worktree}</span>}
        {task.epic && <span className="phase-card-chip">{task.epic}</span>}
        {planSteps && (
          <span className="phase-card-chip" title="plan-step subtasks done / total">
            steps {planSteps.done}/{planSteps.total}
          </span>
        )}
        {findings && (
          <span className="phase-card-chip" title="review-finding subtasks done / total">
            findings {findings.done}/{findings.total}
          </span>
        )}
      </div>

      <button
        type="button"
        className="task-action-btn phase-card-start"
        disabled={starting}
        onClick={onStart}
        title={`Spawn a${model ? ` ${model}` : ''} Claude session running the ${COLUMN_LABELS[phase]} phase for this task`}
      >
        {starting ? 'Starting…' : `Start ${COLUMN_LABELS[phase]}`}
        {model && <span className="phase-card-model">{model}</span>}
      </button>
    </div>
  );
}

export interface PhaseBoardProps {
  api: TasksApi;
  /** Bumped by the host when the task files change. */
  reloadKey?: number;
  /** Resolved phase→model per worktree, so a card shows the model its Start
   *  button will actually launch. Omitted → the model chip is hidden. */
  phaseModels?: PhaseModelMap;
  /** Open a task elsewhere (the Task Board page). Omitted → titles are inert. */
  onOpenTask?: (id: string) => void;
}

export function PhaseBoard({ api, reloadKey = 0, phaseModels, onOpenTask }: PhaseBoardProps) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [bulkStarting, setBulkStarting] = useState<ColumnKey | null>(null);
  /* Kept apart from `error` on purpose. A bulk start marks its tasks
   * in-progress, the host's watcher fires `tasks-changed`, `reloadKey` bumps,
   * and the load effect's success branch calls setError(null) — which would
   * wipe a partial-failure summary within a few seconds of showing it. The
   * load effect never touches `bulkError`, so it survives that reload and is
   * cleared only by the next bulk click or an all-success batch. */
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.list();
        if (!cancelled) {
          setTasks(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  const childMap = useMemo(() => {
    const map = new Map<string, WorkspaceTask[]>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const siblings = map.get(t.parentId);
      if (siblings) siblings.push(t);
      else map.set(t.parentId, [t]);
    }
    return map;
  }, [tasks]);

  const columns = useMemo(() => {
    const buckets = new Map<ColumnKey, WorkspaceTask[]>(COLUMNS.map((c) => [c, []]));
    for (const task of tasks) {
      const column = columnFor(task, childMap.get(task.id) ?? []);
      if (column) buckets.get(column)!.push(task);
    }
    return buckets;
  }, [tasks, childMap]);

  /** Model the phase will run on for the worktree this task is assigned to;
   *  unassigned tasks run in the active worktree, hence the fallback. */
  const modelFor = useCallback(
    (task: WorkspaceTask, column: ColumnKey): string => {
      if (!phaseModels) return '';
      const key = worktreeKey(task.worktree);
      const resolved = phaseModels.byWorktreeKey[key] ?? phaseModels.fallback;
      return resolved[column] ?? '';
    },
    [phaseModels],
  );

  const start = useCallback(
    async (task: WorkspaceTask, column: ColumnKey) => {
      if (!api.startPhase) return;
      setStarting(task.id);
      try {
        await api.startPhase(task.id, column);
        // The card stays in this column: `phase` names the phase to run next, and
        // only the spawned session may advance it once it has actually done the
        // work. startPhase marks the task in-progress, so re-list to pick that up
        // rather than waiting for the host's file watcher.
        setTasks(await api.list());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(null);
      }
    },
    [api],
  );

  const startColumn = useCallback(
    async (column: ColumnKey, items: WorkspaceTask[]) => {
      const confirmBulkStart = api.confirmBulkStart;
      if (!confirmBulkStart) return;
      const startableIds = items.filter((t) => t.status === 'open').map((t) => t.id);
      const inProgressIds = items.filter((t) => t.status === 'in-progress').map((t) => t.id);
      if (startableIds.length === 0 && inProgressIds.length === 0) return;

      setBulkStarting(column);
      setBulkError(null);
      try {
        const { succeeded, failed } = await confirmBulkStart(column, startableIds, inProgressIds);
        // Same reason as the single-card start: the cards stay in this column,
        // but they are now in-progress. Re-list rather than wait for the watcher.
        setTasks(await api.list());
        setError(null);
        if (failed.length > 0) {
          const total = succeeded.length + failed.length;
          const detail = failed.map((f) => `${f.id.slice(0, 8)}: ${f.error}`).join('; ');
          setBulkError(`${failed.length} of ${total} failed to start — ${detail}`);
        }
      } catch (err) {
        setBulkError(err instanceof Error ? err.message : String(err));
      } finally {
        setBulkStarting(null);
      }
    },
    [api],
  );

  if (!api.startPhase) {
    return (
      <div className="phase-board-empty">
        This host can&apos;t spawn Claude sessions, so the phase flow is unavailable.
      </div>
    );
  }

  return (
    <div className="phase-board">
      <PaneHeader title="Phase Board" />
      {error && <div className="phase-board-error">{error}</div>}
      {bulkError && <div className="phase-board-error">{bulkError}</div>}
      {loading ? (
        <div className="phase-board-empty">Loading…</div>
      ) : (
        <div className="phase-board-columns">
          {COLUMNS.map((column) => {
            const items = columns.get(column) ?? [];
            const startable = items.filter((t) => t.status === 'open').length;
            const inProgress = items.filter((t) => t.status === 'in-progress').length;
            return (
              <section key={column} className={`phase-column phase-column-${column}`}>
                <header className="phase-column-head" title={COLUMN_HINTS[column]}>
                  <span className="phase-column-title">{COLUMN_LABELS[column]}</span>
                  <span className="phase-column-count">{items.length}</span>
                </header>
                <div className="phase-column-body">
                  {items.length === 0 ? (
                    <p className="phase-column-empty">Nothing here.</p>
                  ) : (
                    items.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        subtasks={childMap.get(task.id) ?? []}
                        column={column}
                        model={modelFor(task, column)}
                        starting={starting === task.id}
                        onStart={() => void start(task, column)}
                        onOpen={onOpenTask}
                      />
                    ))
                  )}
                </div>
                {api.confirmBulkStart && (startable > 0 || inProgress > 0) && (
                  <footer className="phase-column-footer">
                    <button
                      type="button"
                      className="task-action-btn phase-column-start"
                      disabled={bulkStarting !== null}
                      onClick={() => void startColumn(column, items)}
                      title={
                        startable > 0
                          ? `Spawn one Claude session per startable task in this column, all running the ${COLUMN_LABELS[column]} phase`
                          : `Restart the ${COLUMN_LABELS[column]} phase for all in-progress tasks in this column`
                      }
                    >
                      {bulkStarting === column
                        ? 'Starting…'
                        : `Start all ${COLUMN_LABELS[column]} (${startable + inProgress})`}
                    </button>
                  </footer>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
