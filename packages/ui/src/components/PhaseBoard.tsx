/* Phase Board — the task-bound phase flow as a kanban board.
 *
 * One column per stage of Plan → Implement → Review → Fix, plus an Unstarted
 * column for root tasks not yet in the flow. A task's `phase` field names the
 * phase to run NEXT, so the column a card sits in is exactly the phase its
 * Start button launches: the board is the state machine, and the button is the
 * only way to advance it. Each Start spawns a Claude session bound to that one
 * task on the model the phase calls for (Plan runs on opus, the rest sonnet).
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

/** Sentinel column for root tasks with no `phase` yet. Starting one runs Plan. */
const UNSTARTED = 'unstarted';
type ColumnKey = typeof UNSTARTED | TaskPhase;

const COLUMNS: ColumnKey[] = [UNSTARTED, 'plan', 'implement', 'review', 'fix'];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  unstarted: 'Unstarted',
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  fix: 'Fix',
};

const COLUMN_HINTS: Record<ColumnKey, string> = {
  unstarted: 'Not in the flow yet. Starting one runs the Plan phase.',
  plan: 'Explores the code, writes a memo, files plan-step subtasks.',
  implement: 'Works the plan-step subtasks until lint, typecheck and tests pass.',
  review: 'Reviews the diff and files review-finding subtasks.',
  fix: 'Fixes the review-finding subtasks, then re-runs the checks.',
};

/** The phase a column's Start button launches. */
function phaseFor(column: ColumnKey): TaskPhase {
  return column === UNSTARTED ? 'plan' : column;
}

/** Which column a task belongs in — `null` for anything the board ignores
 *  (subtasks, and finished tasks that already left the flow). */
function columnFor(task: WorkspaceTask): ColumnKey | null {
  if (task.parentId) return null;
  if (task.phase) return task.phase;
  return task.status === 'done' ? null : UNSTARTED;
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
  const phase = phaseFor(column);

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
        {task.worktree && <span className="phase-card-chip">{task.worktree}</span>}
        {task.epic && <span className="phase-card-chip">{task.epic}</span>}
        {task.status === 'in-progress' && <span className="phase-card-chip">in progress</span>}
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
      const column = columnFor(task);
      if (column) buckets.get(column)!.push(task);
    }
    return buckets;
  }, [tasks]);

  /** Model the phase will run on for the worktree this task is assigned to;
   *  unassigned tasks run in the active worktree, hence the fallback. */
  const modelFor = useCallback(
    (task: WorkspaceTask, column: ColumnKey): string => {
      if (!phaseModels) return '';
      const key = worktreeKey(task.worktree);
      const resolved = phaseModels.byWorktreeKey[key] ?? phaseModels.fallback;
      return resolved[phaseFor(column)] ?? '';
    },
    [phaseModels],
  );

  const start = useCallback(
    async (task: WorkspaceTask, column: ColumnKey) => {
      if (!api.startPhase) return;
      setStarting(task.id);
      try {
        await api.startPhase(task.id, phaseFor(column));
        // startPhase writes the task's `phase`, so the card belongs in the next
        // column now. Re-list rather than waiting for the host's file watcher.
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
      {loading ? (
        <div className="phase-board-empty">Loading…</div>
      ) : (
        <div className="phase-board-columns">
          {COLUMNS.map((column) => {
            const items = columns.get(column) ?? [];
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
