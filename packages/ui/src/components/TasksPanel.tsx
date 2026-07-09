import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { PaneHeader } from './primitives';
import type { WorkspaceTask, NewWorkspaceTask, TasksApi, TaskPhase } from '../types';

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

// Stable reference for "no subtasks" so memoized TaskRows don't re-render just
// because `childMap.get(id) ?? []` produced a fresh empty array each render.
const NO_SUBTASKS: WorkspaceTask[] = [];

/** localStorage key for the page-mode list-column width the user dragged. */
const LIST_WIDTH_KEY = 'cwTaskPageListWidth';

function buildChildMap(tasks: WorkspaceTask[]): Map<string, WorkspaceTask[]> {
  const map = new Map<string, WorkspaceTask[]>();
  for (const t of tasks) {
    if (t.parentId) {
      if (!map.has(t.parentId)) map.set(t.parentId, []);
      map.get(t.parentId)!.push(t);
    }
  }
  return map;
}

function groupByEpic(
  tasks: WorkspaceTask[],
): Array<{ epic: string | null; tasks: WorkspaceTask[] }> {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, WorkspaceTask[]>();
  for (const t of tasks) {
    const key = t.epic ?? null;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(t);
  }
  order.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  return order.map((epic) => ({ epic, tasks: buckets.get(epic)! }));
}

function groupByWorktree(
  tasks: WorkspaceTask[],
): Array<{ worktree: string | null; tasks: WorkspaceTask[] }> {
  const map = new Map<string | null, WorkspaceTask[]>();
  for (const t of tasks) {
    const key = t.worktree ? worktreeKey(t.worktree) : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([worktree, wtTasks]) => ({ worktree, tasks: wtTasks }));
}

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── SubtaskRow ────────────────────────────────────────────────────────────────

const SubtaskRow = React.memo(function SubtaskRow({
  task,
  onUpdate,
  onDelete,
  onOpenInEditor,
  onOpen,
}: {
  task: WorkspaceTask;
  onUpdate: (id: string, patch: Partial<WorkspaceTask>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenInEditor?: (id: string) => void;
  /** When set, clicking the title opens the subtask in the host viewer (the
   *  page's detail editor / the sidebar's board page) — same as parent rows. */
  onOpen?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(task.title);
  const escapedRef = useRef(false);
  const hasDetail = Boolean(task.description || task.memo);

  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);

  const handleSave = async () => {
    if (escapedRef.current) {
      escapedRef.current = false;
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(task.title);
      setEditing(false);
      return;
    }
    await onUpdate(task.id, { title: trimmed });
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      escapedRef.current = true;
      setTitle(task.title);
      setEditing(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className={`task-subtask-row${task.status === 'done' ? ' task-row-done' : ''}`}>
      <div className="task-subtask-summary">
        <span
          className="task-subtask-expand"
          title={hasDetail ? (expanded ? 'Collapse' : 'View details') : 'No details'}
          onClick={(e) => {
            e.stopPropagation();
            if (hasDetail) setExpanded((x) => !x);
          }}
          style={{ visibility: hasDetail ? 'visible' : 'hidden' }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span
          className="task-subtask-check"
          title={task.status === 'done' ? 'Mark open' : 'Mark done'}
          onClick={(e) => {
            e.stopPropagation();
            void onUpdate(task.id, {
              status: task.status === 'done' ? 'open' : 'done',
            });
          }}
        >
          {task.status === 'done' ? '✓' : '○'}
        </span>
        {editing ? (
          <input
            className="task-input task-subtask-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onFocus={() => {
              escapedRef.current = false;
            }}
            onBlur={() => void handleSave()}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="task-subtask-title"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpen) onOpen(task.id);
              else if (hasDetail) setExpanded((x) => !x);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title={onOpen ? 'Open task · double-click to rename' : 'Click to view · double-click to edit'}
            style={onOpen ? { cursor: 'pointer' } : undefined}
          >
            {task.title}
          </span>
        )}
        <span className={`task-status-chip task-status-${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
        {onOpenInEditor && (
          <button
            className="task-icon-btn task-subtask-open"
            title="Open task file in editor"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInEditor(task.id);
            }}
          >
            ↗
          </button>
        )}
        <button
          className="task-delete-btn task-subtask-delete"
          title="Delete subtask"
          onClick={(e) => {
            e.stopPropagation();
            void onDelete(task.id);
          }}
        >
          ✕
        </button>
      </div>
      {expanded && hasDetail && (
        <div className="task-subtask-detail">
          {task.description && <p className="task-description">{task.description}</p>}
          {task.memo && (
            <div className="task-memo-block">
              <span className="task-memo-label">Memo</span>
              <pre className="task-memo-content">{task.memo}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ── AddSubtaskForm ────────────────────────────────────────────────────────────

function AddSubtaskForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onSubmit(title.trim());
    setTitle('');
  };

  return (
    <form
      className="task-subtask-add-form"
      onSubmit={(e) => {
        e.stopPropagation();
        void handleSubmit(e);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="task-subtask-indent" />
      <input
        ref={ref}
        className="task-input task-subtask-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Subtask title…"
      />
      <button type="submit" className="task-action-btn task-action-primary task-subtask-btn">
        Add
      </button>
      <button type="button" className="task-action-btn task-subtask-btn" onClick={onCancel}>
        ✕
      </button>
    </form>
  );
}

// ── TaskEditForm ──────────────────────────────────────────────────────────────

function TaskEditForm({
  task,
  worktrees,
  onSave,
  onCancel,
  submitLabel = 'Save',
}: {
  task: WorkspaceTask;
  worktrees: string[];
  onSave: (patch: Partial<WorkspaceTask>) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [memo, setMemo] = useState(task.memo ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [status, setStatus] = useState(task.status);
  const [worktree, setWorktree] = useState(worktreeKey(task.worktree));
  const [epic, setEpic] = useState(task.epic ?? '');
  const [tagsInput, setTagsInput] = useState((task.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description,
        memo,
        priority,
        status,
        worktree: worktree || null,
        epic: epic.trim() || null,
        tags: parseTags(tagsInput),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="task-edit-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="task-field">
        <span className="task-field-label">Title</span>
        <input
          className="task-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          autoFocus
        />
      </label>
      <label className="task-field">
        <span className="task-field-label">Description</span>
        <textarea
          className="task-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Details, acceptance criteria…"
          rows={4}
        />
      </label>
      <label className="task-field">
        <span className="task-field-label">Memo</span>
        <textarea
          className="task-textarea"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Agent notes, findings, blockers…"
          rows={4}
        />
      </label>
      <div className="task-edit-row">
        <label className="task-field">
          <span className="task-field-label">Epic</span>
          <input
            className="task-input"
            value={epic}
            onChange={(e) => setEpic(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="task-field">
          <span className="task-field-label">Tags</span>
          <input
            className="task-input"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="comma, separated"
          />
        </label>
      </div>
      <div className="task-edit-row">
        <label className="task-field">
          <span className="task-field-label">Priority</span>
          <select
            className="task-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as WorkspaceTask['priority'])}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="task-field">
          <span className="task-field-label">Status</span>
          <select
            className="task-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as WorkspaceTask['status'])}
          >
            <option value="open">Open</option>
            <option value="in-progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </label>
        {!task.parentId && (
          <label className="task-field">
            <span className="task-field-label">Worktree</span>
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
          </label>
        )}
      </div>
      <div className="task-edit-actions">
        <button
          type="submit"
          className="task-action-btn task-action-primary"
          disabled={saving || !title.trim()}
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="task-action-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

const TaskRow = React.memo(function TaskRow({
  task,
  subtasks,
  activeWorktree,
  worktrees,
  onDelete,
  onUpdate,
  onCreateSubtask,
  onOpenTask,
  onOpenInEditor,
}: {
  task: WorkspaceTask;
  subtasks: WorkspaceTask[];
  activeWorktree: string | null;
  worktrees: string[];
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<WorkspaceTask>) => Promise<void>;
  onCreateSubtask: (parentId: string, title: string) => Promise<void>;
  /** When set, clicking the summary defers to the host viewer instead of
   *  expanding the row inline. */
  onOpenTask?: (taskId: string) => void;
  /** When set, renders an "open in editor" affordance that opens the task's
   *  backing `.md` file in the host editor. */
  onOpenInEditor?: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);

  const isCurrentWorktree =
    activeWorktree && worktreeKey(task.worktree) === worktreeKey(activeWorktree);
  const doneSubtasks = subtasks.filter((s) => s.status === 'done').length;
  const subtaskProgress = subtasks.length > 0 ? `${doneSubtasks}/${subtasks.length}` : null;
  const shortWt = task.worktree ? (task.worktree.split(/[/\\]/).pop() ?? task.worktree) : null;

  const handleSummaryClick = () => {
    if (onOpenTask) onOpenTask(task.id);
    else setExpanded((x) => !x);
  };

  return (
    <div
      className={`task-row${isCurrentWorktree ? ' task-row-current' : ''}${task.status === 'done' ? ' task-row-done' : ''}`}
    >
      <div
        className="task-row-summary"
        onClick={handleSummaryClick}
        style={{ cursor: 'pointer' }}
        title={onOpenTask ? 'Open task viewer' : 'Expand task'}
      >
        <span
          className="task-priority-dot"
          title={task.priority}
          style={{ background: PRIORITY_COLORS[task.priority] }}
        />
        <span className="task-title">{task.title}</span>
        {subtaskProgress && (
          <span
            className="task-subtask-progress"
            title={`${doneSubtasks} of ${subtasks.length} subtasks done`}
          >
            {subtaskProgress}
          </span>
        )}
        <span className={`task-status-chip task-status-${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
        {task.tags && task.tags.length > 0 && (
          <span className="task-tags-row">
            {task.tags.map((tag) => (
              <span key={tag} className="task-tag-chip">
                #{tag}
              </span>
            ))}
          </span>
        )}
        {shortWt && (
          <span className="task-worktree-label" title={task.worktree ?? ''}>
            {shortWt}
          </span>
        )}
        {onOpenInEditor && (
          <button
            className="task-icon-btn"
            title="Open task file in editor"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInEditor(task.id);
            }}
          >
            ↗
          </button>
        )}
        <button
          className="task-delete-btn"
          title="Delete task"
          onClick={(e) => {
            e.stopPropagation();
            void onDelete(task.id);
          }}
        >
          ✕
        </button>
      </div>

      {expanded && !onOpenTask && (
        <div className="cw-accordion-detail">
          {editing ? (
            <TaskEditForm
              task={task}
              worktrees={worktrees}
              onSave={async (patch) => {
                await onUpdate(task.id, patch);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div style={{ padding: '8px 10px' }}>
              {task.description && <p className="task-description">{task.description}</p>}
              {task.memo && (
                <div className="task-memo-block">
                  <span className="task-memo-label">Memo</span>
                  <pre className="task-memo-content">{task.memo}</pre>
                </div>
              )}
              <div className="task-row-actions">
                <button className="task-action-btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="task-action-btn" onClick={() => setAddingSubtask((x) => !x)}>
                  + Subtask
                </button>
                {onOpenInEditor && (
                  <button className="task-action-btn" onClick={() => onOpenInEditor(task.id)}>
                    ↗ Open in editor
                  </button>
                )}
                {task.status !== 'done' && (
                  <button
                    className="task-action-btn"
                    onClick={() => {
                      const next = task.status === 'open' ? 'in-progress' : 'done';
                      void onUpdate(task.id, { status: next });
                    }}
                  >
                    {task.status === 'open' ? '▶ Start' : '✓ Done'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {subtasks.map((sub) => (
        <SubtaskRow
          key={sub.id}
          task={sub}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onOpenInEditor={onOpenInEditor}
          onOpen={onOpenTask}
        />
      ))}
      {addingSubtask && (
        <AddSubtaskForm
          onSubmit={async (t) => {
            await onCreateSubtask(task.id, t);
            setAddingSubtask(false);
          }}
          onCancel={() => setAddingSubtask(false)}
        />
      )}
    </div>
  );
});

// ── TaskDetailPane ────────────────────────────────────────────────────────────

/** Full-width task editor for page mode — replaces "open the .md file" as the
 *  primary way to work on a task. Always editable; subtasks inline below. */
/** Ordered phase flow — used both to render the stepper and to know which
 *  phase a "start" click on an unset task should begin at. */
const PHASE_FLOW: TaskPhase[] = ['plan', 'implement', 'review', 'fix'];
const PHASE_LABELS: Record<TaskPhase, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  fix: 'Fix',
};

/** Plan → Implement → Review → Fix stepper for a root task's detail pane.
 *
 *  A task's `phase` names the phase to run NEXT — the Plan session hands off by
 *  setting phase:'implement', and startPhase re-writes the same value when it
 *  launches. So the pending phase IS `task.phase`, everything before it is
 *  done, and an unset phase means the flow hasn't started. The board's columns
 *  read the field the same way. */
function PhaseStepper({
  task,
  onStartPhase,
}: {
  task: WorkspaceTask;
  onStartPhase: (id: string, phase: TaskPhase) => Promise<void>;
}) {
  const [starting, setStarting] = useState<TaskPhase | null>(null);
  const pendingIdx = task.phase ? PHASE_FLOW.indexOf(task.phase) : 0;
  const pendingPhase = PHASE_FLOW[pendingIdx];

  const start = async (phase: TaskPhase) => {
    setStarting(phase);
    try {
      await onStartPhase(task.id, phase);
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
      <button
        className="task-action-btn task-phase-start"
        disabled={starting !== null}
        onClick={() => void start(pendingPhase)}
        title={`Spawn a Claude session to run the ${PHASE_LABELS[pendingPhase]} phase for this task`}
      >
        {starting === pendingPhase ? 'Starting…' : `Start ${PHASE_LABELS[pendingPhase]}`}
      </button>
    </div>
  );
}

function TaskDetailPane({
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
  onClose: () => void;
}) {
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  return (
    <div className="task-detail-pane">
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
        <PhaseStepper task={task} onStartPhase={onStartPhase} />
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
      {task.parentId ? (
        /* Subtasks can't nest, so instead of a dead Subtasks section a subtask
           links back up to its parent. */
        <div className="task-detail-subtasks">
          <div className="task-detail-subhead">
            <span>Part of</span>
          </div>
          <button
            className="task-detail-parent-link"
            onClick={() => onOpenTask?.(task.parentId!)}
            title="Open parent task"
          >
            ↑ {parent?.title ?? task.parentId}
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
            <AddSubtaskForm
              onSubmit={async (t) => {
                await onCreateSubtask(task.id, t);
                setAddingSubtask(false);
              }}
              onCancel={() => setAddingSubtask(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── TaskCreatePane ────────────────────────────────────────────────────────────

const BLANK_TASK: WorkspaceTask = {
  id: '',
  title: '',
  priority: 'medium',
  status: 'open',
  worktree: null,
  description: '',
  memo: '',
  created: '',
  updated: '',
  parentId: null,
  epic: null,
  tags: [],
};

/** New-task editor rendered in the detail column (page mode) — same chrome as
 *  TaskDetailPane so creating and editing feel like one surface. */
function TaskCreatePane({
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
  );
}

/** Placeholder shown in the detail column when nothing is selected. */
function TaskDetailEmpty({ onCreate }: { onCreate: () => void }) {
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

function NewTaskForm({
  worktrees,
  onSubmit,
  onCancel,
}: {
  worktrees: string[];
  onSubmit: (task: NewWorkspaceTask) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkspaceTask['priority']>('medium');
  const [worktree, setWorktree] = useState('');
  const [epic, setEpic] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        memo: '',
        priority,
        status: 'open',
        worktree: worktree || null,
        parentId: null,
        epic: epic.trim() || null,
        tags: parseTags(tagsInput),
      });
    } finally {
      setSubmitting(false);
    }
  };

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
          onChange={(e) => setPriority(e.target.value as WorkspaceTask['priority'])}
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

interface TasksPanelProps {
  api: TasksApi;
  activeWorktree: string | null;
  worktrees: string[];
  /** Bump this to force a reload — hosts wire it to their task file watcher. */
  reloadKey?: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** When provided, clicking a task row defers to a host viewer (the app's
   *  focus mode) instead of expanding the row inline. */
  onOpenTask?: (taskId: string) => void;
  /** Render a drag-to-resize handle + fixed-height body (Electron app). */
  resizable?: boolean;
  /** Host-specific controls injected into the header, before the + button. */
  headerExtra?: React.ReactNode;
  /** Suppress the pane-header title when the host chrome already shows it. */
  hideHeaderTitle?: boolean;
  /** Suppress the in-panel + / ↻ buttons when the host chrome already
   *  provides Create/Refresh actions (e.g. a VS Code view title bar). */
  hideHeaderActions?: boolean;
  /** Full editor-tab board mode: clicking a task opens an inline detail
   *  editor pane (instead of the accordion/file), and a filter toolbar
   *  (group-by, status, tag) appears next to the search box. */
  pageMode?: boolean;
  /** Page mode: id of a task to open in the detail editor on mount / when the
   *  host requests focus (e.g. opened from the sidebar). */
  openTaskId?: string;
  /** Bumped by the host alongside `openTaskId` so re-requesting the same id
   *  re-opens its editor even if it is already the selection. */
  openTaskNonce?: number;
  /** Page mode: bump to open a blank new-task editor in the detail column
   *  (e.g. the host's "New task" command). */
  newTaskNonce?: number;
}

type GroupBy = 'worktree' | 'epic' | 'none';
type StatusFilter = 'active' | 'all' | TaskStatusValue;
type TaskStatusValue = WorkspaceTask['status'];

export function TasksPanel({
  api,
  activeWorktree,
  worktrees,
  reloadKey = 0,
  collapsed,
  onToggleCollapsed,
  onOpenTask,
  resizable = false,
  headerExtra,
  hideHeaderTitle,
  hideHeaderActions,
  pageMode = false,
  openTaskId,
  openTaskNonce,
  newTaskNonce,
}: TasksPanelProps) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('worktree');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(280);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  // Page mode: user-dragged list-column width (px); null = the default CSS
  // split (40% capped at 620px). Persisted so the board reopens as left.
  const [listWidth, setListWidth] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(LIST_WIDTH_KEY);
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  const layoutRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    // Last-write-wins: a burst of reloadKey bumps fires overlapping listTasks
    // calls; without this guard a slower earlier response could land after a
    // newer one and flash stale data. (Mirrors useTasks in the Electron app.)
    const id = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await api.list();
      if (id === requestIdRef.current) setTasks(result);
    } catch {
      // non-fatal — list stays as-is
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  // Page mode: open the detail editor for a task the host asks us to focus
  // (e.g. clicked in the sidebar). Keyed on the nonce so the same id re-opens.
  useEffect(() => {
    if (pageMode && openTaskId) {
      setCreating(false);
      setSelectedId(openTaskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, openTaskId, openTaskNonce]);

  // Page mode: host asked to start a new task — open a blank editor.
  useEffect(() => {
    if (pageMode && newTaskNonce) {
      setSelectedId(null);
      setCreating(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, newTaskNonce]);

  const createTask = useCallback(
    async (task: NewWorkspaceTask) => {
      await api.create(task);
      await reload();
    },
    [api, reload],
  );
  // Page mode: create then select the new task so it stays open for editing.
  const createAndOpen = useCallback(
    async (task: NewWorkspaceTask) => {
      const created = await api.create(task);
      await reload();
      setCreating(false);
      if (created?.id) setSelectedId(created.id);
    },
    [api, reload],
  );
  const updateTask = useCallback(
    async (id: string, patch: Partial<WorkspaceTask>) => {
      await api.update(id, patch);
      await reload();
    },
    [api, reload],
  );
  const deleteTask = useCallback(
    async (id: string) => {
      await api.remove(id);
      await reload();
    },
    [api, reload],
  );
  const openInEditor = useMemo(
    () => (api.openInEditor ? (id: string) => void api.openInEditor!(id) : undefined),
    [api],
  );
  const startPhase = useCallback(
    async (id: string, phase: TaskPhase) => {
      if (!api.startPhase) return;
      await api.startPhase(id, phase);
      await reload();
    },
    [api, reload],
  );

  const handleCreateSubtask = useCallback(
    async (parentId: string, title: string) => {
      const parent = tasks.find((t) => t.id === parentId);
      if (!parent || parent.parentId) return;
      await createTask({
        title,
        description: '',
        memo: '',
        priority: parent.priority,
        status: 'open',
        worktree: null,
        parentId,
      });
    },
    [tasks, createTask],
  );

  const handleResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { startY: e.clientY, startHeight: bodyHeight };
      document.body.style.cursor = 'row-resize';
      const onMove = (mv: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - mv.clientY;
        setBodyHeight(Math.max(80, Math.min(600, dragRef.current.startHeight + delta)));
      };
      const onUp = () => {
        dragRef.current = null;
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [bodyHeight],
  );

  // Page mode: drag the divider between the list column and the detail pane.
  const handleColResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const listEl = layoutRef.current?.querySelector('.task-list-col');
      let width = listWidth ?? (listEl instanceof HTMLElement ? listEl.offsetWidth : 480);
      const startX = e.clientX;
      const startWidth = width;
      document.body.style.cursor = 'col-resize';
      const onMove = (mv: MouseEvent) => {
        const container = layoutRef.current;
        // Keep both columns usable: the detail pane needs its min-width plus
        // some padding, the list stays readable at 260px.
        const max = Math.max(260, (container?.clientWidth ?? 1200) - 380);
        width = Math.max(260, Math.min(max, startWidth + (mv.clientX - startX)));
        setListWidth(width);
      };
      const onUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        try {
          localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(width)));
        } catch {
          /* persistence is best-effort */
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [listWidth],
  );
  const resetListWidth = useCallback(() => {
    setListWidth(null);
    try {
      localStorage.removeItem(LIST_WIDTH_KEY);
    } catch {
      /* persistence is best-effort */
    }
  }, []);

  const childMap = useMemo(() => buildChildMap(tasks), [tasks]);
  const rootTasks = useMemo(() => {
    const roots = tasks.filter((t) => !t.parentId);
    // The sidebar always hides done tasks; page mode filters by status.
    const status = pageMode ? statusFilter : 'active';
    return roots.filter((t) =>
      status === 'all' ? true : status === 'active' ? t.status !== 'done' : t.status === status,
    );
  }, [tasks, pageMode, statusFilter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [tasks]);

  const q = search.trim().toLowerCase();
  const filteredRoots = useMemo(() => {
    let roots = rootTasks;
    if (pageMode && tagFilter) roots = roots.filter((t) => (t.tags ?? []).includes(tagFilter));
    if (!q) return roots;
    return roots.filter((t) => {
      const subs = childMap.get(t.id) ?? [];
      const hay = [t.title, t.description, t.memo, ...(t.tags ?? []), ...subs.map((s) => s.title)]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rootTasks, childMap, q, pageMode, tagFilter]);

  /* Sections: worktree grouping keeps the nested epic headers; epic grouping
   * promotes epics to top level; none is one flat list. */
  const sections = useMemo(() => {
    const mode: GroupBy = pageMode ? groupBy : 'worktree';
    if (mode === 'worktree') {
      return groupByWorktree(filteredRoots).map(({ worktree, tasks: wtTasks }) => ({
        key: worktree ?? '__unassigned__',
        label: worktree ? (worktree.split(/[/\\]/).pop() ?? worktree) : 'Unassigned',
        labelKind: 'worktree' as const,
        epics: groupByEpic(wtTasks),
      }));
    }
    if (mode === 'epic') {
      return groupByEpic(filteredRoots).map(({ epic, tasks: epicTasks }) => ({
        key: epic ?? '__no_epic__',
        label: epic ?? 'No epic',
        labelKind: 'epic' as const,
        epics: [{ epic: null, tasks: epicTasks }],
      }));
    }
    return [
      {
        key: '__all__',
        label: null,
        labelKind: 'none' as const,
        epics: [{ epic: null, tasks: filteredRoots }],
      },
    ];
  }, [filteredRoots, pageMode, groupBy]);

  const selectedTask = useMemo(
    () => (pageMode && selectedId ? (tasks.find((t) => t.id === selectedId) ?? null) : null),
    [pageMode, selectedId, tasks],
  );

  return (
    <div className="cw-pane">
      {resizable && !collapsed && (
        <div
          className="cw-pane-resizer"
          title="Drag to resize the Tasks panel"
          onMouseDown={handleResizerMouseDown}
        />
      )}
      {/* Skip the header entirely when the host chrome already supplies the
          title, actions, and collapse control (e.g. the VS Code view bar). */}
      {!(hideHeaderTitle && hideHeaderActions && !onToggleCollapsed) && (
        <PaneHeader
          title="Tasks"
          hideTitle={hideHeaderTitle}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
        >
          {headerExtra}
          {!hideHeaderActions && (
            <>
              <button
                className="cw-add-btn"
                title="New task"
                onClick={(e) => {
                  e.stopPropagation();
                  setAdding((x) => !x);
                }}
              >
                +
              </button>
              <button
                className="cw-icon-btn"
                title="Refresh tasks"
                disabled={loading}
                onClick={(e) => {
                  e.stopPropagation();
                  void reload();
                }}
              >
                <span className={loading ? 'cw-spinning' : undefined}>↻</span>
              </button>
            </>
          )}
        </PaneHeader>
      )}

      {!collapsed && (
        <>
          <div className="task-search-row">
            <input
              className="task-search-input"
              type="search"
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {pageMode && (
              <>
                <select
                  className="task-select task-toolbar-select"
                  title="Group tasks by"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                >
                  <option value="worktree">By worktree</option>
                  <option value="epic">By epic</option>
                  <option value="none">Flat list</option>
                </select>
                <select
                  className="task-select task-toolbar-select"
                  title="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="active">Active</option>
                  <option value="all">All (incl. done)</option>
                  <option value="open">Open</option>
                  <option value="in-progress">In progress</option>
                  <option value="done">Done</option>
                </select>
                <select
                  className="task-select task-toolbar-select"
                  title="Filter by tag"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                >
                  <option value="">All tags</option>
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      #{tag}
                    </option>
                  ))}
                </select>
                <button
                  className="task-action-btn task-action-primary task-toolbar-new"
                  title="Create a new task"
                  onClick={() => {
                    setSelectedId(null);
                    setCreating(true);
                  }}
                >
                  + New task
                </button>
              </>
            )}
          </div>
          {/* display:contents keeps the sidebar layout identical — the wrapper
              only becomes a real flex row in page mode (list + detail pane). */}
          <div
            ref={layoutRef}
            className={pageMode ? 'task-page-layout' : undefined}
            style={pageMode ? undefined : { display: 'contents' }}
          >
            <div
              className={pageMode ? 'task-list-col' : undefined}
              style={
                resizable
                  ? { height: bodyHeight, overflowY: 'auto', flex: '0 0 auto' }
                  : pageMode
                    ? listWidth != null
                      ? { flex: '0 0 auto', width: listWidth, maxWidth: 'none' }
                      : undefined
                    : { flex: 1, overflowY: 'auto', minWidth: 0 }
              }
            >
              {adding && !pageMode && (
                <NewTaskForm
                  worktrees={worktrees}
                  onSubmit={async (t) => {
                    await createTask(t);
                    setAdding(false);
                  }}
                  onCancel={() => setAdding(false)}
                />
              )}

              {filteredRoots.length === 0 && !adding && (
                <div className="cw-empty">{q ? 'No matching tasks.' : 'No project tasks yet.'}</div>
              )}

              {sections.map((section) => (
                <React.Fragment key={section.key}>
                  {section.label != null && (
                    <div
                      className={
                        section.labelKind === 'epic'
                          ? 'task-epic-group-header'
                          : 'task-worktree-group-header'
                      }
                      title={section.label}
                    >
                      {section.label}
                    </div>
                  )}
                  {section.epics.map(({ epic, tasks: epicTasks }) => (
                    <React.Fragment key={epic ?? '__no_epic__'}>
                      {epic != null && (
                        <div className="task-epic-group-header" title={`Epic: ${epic}`}>
                          {epic}
                        </div>
                      )}
                      {epicTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          subtasks={childMap.get(task.id) ?? NO_SUBTASKS}
                          activeWorktree={activeWorktree}
                          worktrees={worktrees}
                          onUpdate={updateTask}
                          onDelete={deleteTask}
                          onCreateSubtask={handleCreateSubtask}
                          onOpenTask={pageMode ? setSelectedId : onOpenTask}
                          onOpenInEditor={pageMode ? undefined : openInEditor}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </div>
            {pageMode && (
              <div
                className="task-col-resizer"
                title="Drag to resize · double-click to reset"
                onMouseDown={handleColResizerMouseDown}
                onDoubleClick={resetListWidth}
              />
            )}
            {pageMode &&
              (creating ? (
                <TaskCreatePane
                  worktrees={worktrees}
                  defaultWorktree={activeWorktree}
                  onCreate={createAndOpen}
                  onClose={() => setCreating(false)}
                />
              ) : selectedTask ? (
                <TaskDetailPane
                  task={selectedTask}
                  subtasks={childMap.get(selectedTask.id) ?? NO_SUBTASKS}
                  parent={
                    selectedTask.parentId
                      ? (tasks.find((t) => t.id === selectedTask.parentId) ?? null)
                      : null
                  }
                  worktrees={worktrees}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                  onCreateSubtask={handleCreateSubtask}
                  onOpenInEditor={openInEditor}
                  onOpenTask={setSelectedId}
                  onStartPhase={api.startPhase ? startPhase : undefined}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <TaskDetailEmpty
                  onCreate={() => {
                    setSelectedId(null);
                    setCreating(true);
                  }}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
