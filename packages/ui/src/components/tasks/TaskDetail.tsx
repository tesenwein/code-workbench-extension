import React, { useState, useRef, useEffect } from 'react';
import { columnFor } from '../PhaseBoard';
import type { WorkspaceTask, NewWorkspaceTask, TaskPhase, TaskUsageSummary } from '../../types';
import {
  worktreeKey,
  PRIORITY_COLORS,
  STATUS_LABELS,
  isPriority,
  PHASE_FLOW,
  PHASE_LABELS,
  BLANK_TASK,
} from './taskUtils';
import { SubtaskRow, InlineAddSubtask, TaskEditForm } from './TaskRow';
import { useTaskForm } from './useTaskForm';

/** Plan → Implement → Review → Fix stepper for a root task's detail pane.
 *
 *  A task's `phase` names the phase to run NEXT — the Plan session hands off by
 *  setting phase:'implement', and startPhase re-writes the same value when it
 *  launches. The pending phase is resolved by the SAME `columnFor` the Phase
 *  Board uses (including the plan-step-subtask inference for tasks whose Plan
 *  session filed subtasks but never advanced `phase`), so the two surfaces
 *  can't disagree about what "next" means. */
export function PhaseStepper({
  task,
  subtasks,
  onStartPhase,
  onToggleAutoRun,
}: {
  task: WorkspaceTask;
  subtasks: WorkspaceTask[];
  onStartPhase: (id: string, phase: TaskPhase) => Promise<void>;
  /** Toggle autopilot ("run through"). Omitted → the toggle is hidden. */
  onToggleAutoRun?: (on: boolean) => Promise<void>;
}) {
  const [starting, setStarting] = useState<TaskPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingPhase = columnFor(task, subtasks);
  const pendingIdx = pendingPhase ? PHASE_FLOW.indexOf(pendingPhase) : PHASE_FLOW.length;

  const start = async (phase: TaskPhase) => {
    setStarting(phase);
    setError(null);
    try {
      await onStartPhase(task.id, phase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="task-phase-stepper">
      <div className="task-phase-steps">
        {PHASE_FLOW.map((phase, i) => {
          const state = i < pendingIdx ? 'done' : i === pendingIdx ? 'active' : 'upcoming';
          return (
            <React.Fragment key={phase}>
              {i > 0 && <span className="task-phase-arrow">→</span>}
              <span className={`task-phase-step task-phase-${state}`}>
                {state === 'done' ? '✓ ' : ''}
                {PHASE_LABELS[phase]}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {pendingPhase && (
        <button
          className="task-action-btn task-phase-start"
          disabled={starting !== null}
          onClick={() => void start(pendingPhase)}
          title={`Spawn a Claude session to run the ${PHASE_LABELS[pendingPhase]} phase for this task`}
        >
          {starting === pendingPhase ? 'Starting…' : `Start ${PHASE_LABELS[pendingPhase]}`}
        </button>
      )}
      {onToggleAutoRun && (
        <label
          className="task-phase-autorun"
          title="Start the next phase automatically when a phase session finishes and hands off. Stops on needs-input, a blocked phase, or high-priority review findings."
        >
          <input
            type="checkbox"
            checked={!!task.autoRun}
            onChange={(e) => {
              setError(null);
              onToggleAutoRun(e.target.checked).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            }}
          />
          Run through
        </label>
      )}
      {error && <div className="task-phase-error">{error}</div>}
    </div>
  );
}

// ── TaskDetailPane ────────────────────────────────────────────────────────────

/** Full-width task editor for page mode — replaces "open the .md file" as the
 *  primary way to work on a task. Always editable; subtasks inline below. */
/** "Tokens: 12.3k" line under the phase stepper; hidden while loading or empty. */
function TaskUsageLine({
  taskId,
  updated,
  loadUsage,
}: {
  taskId: string;
  /** Re-fetch whenever the task changes (sessions touch it as they work). */
  updated: string;
  loadUsage: (id: string) => Promise<TaskUsageSummary | null>;
}) {
  const [usage, setUsage] = useState<TaskUsageSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadUsage(taskId)
      .then((u) => !cancelled && setUsage(u))
      .catch(() => !cancelled && setUsage(null));
    return () => {
      cancelled = true;
    };
  }, [taskId, updated, loadUsage]);
  if (!usage) return null;
  return (
    <div className="task-usage" title={usage.detail}>
      Tokens used by bound sessions: {usage.label}
    </div>
  );
}

export function TaskDetailPane({
  task,
  subtasks,
  parent,
  worktrees,
  onUpdate,
  onDelete,
  onCreateSubtask,
  onOpenInEditor,
  onOpenTask,
  onStartPhase,
  loadUsage,
  onClose,
}: {
  task: WorkspaceTask;
  subtasks: WorkspaceTask[];
  /** Parent task when `task` is a subtask — rendered as a backlink. */
  parent?: WorkspaceTask | null;
  worktrees: string[];
  onUpdate: (id: string, patch: Partial<WorkspaceTask>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateSubtask: (parentId: string, title: string) => Promise<void>;
  onOpenInEditor?: (id: string) => void;
  /** Switch this pane to another task (a clicked subtask / the parent). */
  onOpenTask?: (id: string) => void;
  /** Start (or restart) a phase for this task — spawns a bound Claude session.
   *  Omitted entirely when the host can't spawn sessions (the stepper hides). */
  onStartPhase?: (id: string, phase: TaskPhase) => Promise<void>;
  /** Fetch aggregated token usage for this task. Omitted → no usage line. */
  loadUsage?: (id: string) => Promise<TaskUsageSummary | null>;
  onClose: () => void;
}) {
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const parentId = task.parentId;

  return (
    <div className="task-detail-pane">
      <div className="task-detail-inner">
        <div className="task-detail-header">
          <span
            className="task-priority-dot"
            title={`${task.priority} priority`}
            style={{ background: PRIORITY_COLORS[task.priority] }}
          />
          <span className={`task-status-chip task-status-${task.status}`}>
            {STATUS_LABELS[task.status]}
          </span>
          <span className="task-detail-id" title={`Task ${task.id}`}>
            {task.id.slice(0, 8)}
          </span>
          {saved && <span className="task-detail-saved">✓ saved</span>}
          {onOpenInEditor && (
            <button
              className="task-icon-btn"
              title="Open backing .md file"
              onClick={() => onOpenInEditor(task.id)}
            >
              ↗
            </button>
          )}
          <button
            className="task-delete-btn"
            title="Delete task"
            onClick={() => {
              void onDelete(task.id);
              onClose();
            }}
          >
            🗑
          </button>
          <button className="task-icon-btn" title="Close editor" onClick={onClose}>
            ✕
          </button>
        </div>
        {onStartPhase && !task.parentId && (
          <PhaseStepper
            task={task}
            subtasks={subtasks}
            onStartPhase={onStartPhase}
            onToggleAutoRun={(on) => onUpdate(task.id, { autoRun: on })}
          />
        )}
        {task.issueNumber && <div className="task-usage">GitHub issue #{task.issueNumber}</div>}
        {task.prUrl && (
          <div className="task-usage">
            Pull request:{' '}
            <a href={task.prUrl} title={task.prUrl}>
              {task.prUrl.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}
        {loadUsage && !task.parentId && (
          <TaskUsageLine taskId={task.id} updated={task.updated} loadUsage={loadUsage} />
        )}
        <TaskEditForm
          key={task.id}
          task={task}
          worktrees={worktrees}
          onSave={async (patch) => {
            await onUpdate(task.id, patch);
            setSaved(true);
            clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSaved(false), 1500);
          }}
          onCancel={onClose}
        />
        {parentId ? (
          /* Subtasks can't nest, so instead of a dead Subtasks section a subtask
           links back up to its parent. */
          <div className="task-detail-subtasks">
            <div className="task-detail-subhead">
              <span>Part of</span>
            </div>
            <button
              className="task-detail-parent-link"
              onClick={() => onOpenTask?.(parentId)}
              title="Open parent task"
            >
              ↑ {parent?.title ?? parentId}
            </button>
          </div>
        ) : (
          <div className="task-detail-subtasks">
            <div className="task-detail-subhead">
              <span>Subtasks</span>
              <button className="task-action-btn" onClick={() => setAddingSubtask((x) => !x)}>
                + Subtask
              </button>
            </div>
            {subtasks.length === 0 && !addingSubtask && (
              <div className="cw-empty">No subtasks.</div>
            )}
            {subtasks.map((sub) => (
              <SubtaskRow
                key={sub.id}
                task={sub}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onOpen={onOpenTask}
              />
            ))}
            {addingSubtask && (
              <InlineAddSubtask
                parentId={task.id}
                onCreateSubtask={onCreateSubtask}
                onClose={() => setAddingSubtask(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TaskCreatePane ────────────────────────────────────────────────────────────

/** New-task editor rendered in the detail column (page mode) — same chrome as
 *  TaskDetailPane so creating and editing feel like one surface. */
export function TaskCreatePane({
  worktrees,
  defaultWorktree,
  onCreate,
  onClose,
}: {
  worktrees: string[];
  defaultWorktree: string | null;
  onCreate: (task: NewWorkspaceTask) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="task-detail-pane">
      <div className="task-detail-inner">
        <div className="task-detail-header">
          <span className="task-detail-title">New task</span>
          <button className="task-icon-btn" title="Cancel" onClick={onClose}>
            ✕
          </button>
        </div>
        <TaskEditForm
          task={{ ...BLANK_TASK, worktree: defaultWorktree }}
          worktrees={worktrees}
          submitLabel="Create task"
          onSave={async (patch) => {
            await onCreate({
              title: patch.title ?? '',
              description: patch.description ?? '',
              memo: patch.memo ?? '',
              priority: patch.priority ?? 'medium',
              status: patch.status ?? 'open',
              worktree: patch.worktree ?? null,
              parentId: null,
              epic: patch.epic ?? null,
              tags: patch.tags ?? [],
            });
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

/** Placeholder shown in the detail column when nothing is selected. */
export function TaskDetailEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="task-detail-pane task-detail-empty">
      <div className="task-detail-empty-inner">
        <div className="task-detail-empty-icon">✎</div>
        <p className="task-detail-empty-text">Select a task to view and edit it.</p>
        <button className="task-action-btn task-action-primary" onClick={onCreate}>
          + New task
        </button>
      </div>
    </div>
  );
}

// ── NewTaskForm ───────────────────────────────────────────────────────────────

export function NewTaskForm({
  worktrees,
  onSubmit,
  onCancel,
}: {
  worktrees: string[];
  onSubmit: (task: NewWorkspaceTask) => Promise<void>;
  onCancel: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const {
    title,
    setTitle,
    description,
    setDescription,
    priority,
    setPriority,
    worktree,
    setWorktree,
    epic,
    setEpic,
    tagsInput,
    setTagsInput,
    submitting,
    handleSubmit,
  } = useTaskForm<NewWorkspaceTask>({
    initial: {},
    build: (f) => ({
      title: f.title,
      description: f.description,
      memo: '',
      priority: f.priority,
      status: 'open',
      worktree: f.worktree || null,
      parentId: null,
      epic: f.epic || null,
      tags: f.tags,
    }),
    onSubmit,
  });

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      className="task-new-form"
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <input
        ref={titleRef}
        className="task-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
      />
      <textarea
        className="task-textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
      />
      <div className="task-edit-row">
        <input
          className="task-input"
          value={epic}
          onChange={(e) => setEpic(e.target.value)}
          placeholder="Epic (optional)"
        />
        <input
          className="task-input"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Tags (comma-separated)"
        />
      </div>
      <div className="task-edit-row">
        <select
          className="task-select"
          value={priority}
          onChange={(e) => {
            if (isPriority(e.target.value)) setPriority(e.target.value);
          }}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          className="task-select"
          value={worktree}
          onChange={(e) => setWorktree(e.target.value)}
        >
          <option value="">Unassigned</option>
          {worktrees.map((wt) => (
            <option key={wt} value={worktreeKey(wt)}>
              {wt.split(/[/\\]/).pop() ?? wt}
            </option>
          ))}
        </select>
      </div>
      <div className="task-edit-row">
        <button
          type="submit"
          className="task-action-btn task-action-primary"
          disabled={submitting || !title.trim()}
        >
          {submitting ? 'Adding…' : 'Add task'}
        </button>
        <button type="button" className="task-action-btn" disabled={submitting} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── TasksPanel ────────────────────────────────────────────────────────────────
