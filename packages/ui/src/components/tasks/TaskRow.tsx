import React, { useState, useRef, useEffect } from 'react';
import type { WorkspaceTask, TaskPhase } from '../../types';
import { useTaskForm } from './useTaskForm';
import {
  isPriority,
  isStatus,
  isPhaseOrNone,
  worktreeKey,
  PRIORITY_COLORS,
  STATUS_LABELS,
} from './taskUtils';

// ── SubtaskRow ────────────────────────────────────────────────────────────────

export const SubtaskRow = React.memo(function SubtaskRow({
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
            title={
              onOpen ? 'Open task · double-click to rename' : 'Click to view · double-click to edit'
            }
            style={onOpen ? { cursor: 'pointer' } : undefined}
          >
            {task.title}
          </span>
        )}
        {typeof task.order === 'number' && (
          <span className="task-order-chip" title={`Sequence position ${task.order}`}>
            #{task.order}
          </span>
        )}
        {task.parallel && (
          <span
            className="task-parallel-chip"
            title="Safe to run in parallel with sibling parallel subtasks at the same order"
          >
            ∥
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

export function AddSubtaskForm({
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

/** AddSubtaskForm wired to create under `parentId` and close itself afterwards. */
export function InlineAddSubtask({
  parentId,
  onCreateSubtask,
  onClose,
}: {
  parentId: string;
  onCreateSubtask: (parentId: string, title: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <AddSubtaskForm
      onSubmit={async (t) => {
        await onCreateSubtask(parentId, t);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

export function TaskEditForm({
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
  const [memo, setMemo] = useState(task.memo ?? '');
  const [status, setStatus] = useState(task.status);
  const [phase, setPhase] = useState<TaskPhase | ''>(task.phase ?? '');
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
    submitting: saving,
    handleSubmit,
  } = useTaskForm({
    initial: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      worktree: worktreeKey(task.worktree),
      epic: task.epic ?? '',
      tags: task.tags,
    },
    build: (f) => ({
      title: f.title,
      description: f.description,
      memo,
      priority: f.priority,
      status,
      ...(task.parentId ? {} : { phase: phase || null }),
      worktree: f.worktree || null,
      epic: f.epic || null,
      tags: f.tags,
    }),
    onSubmit: onSave,
  });

  return (
    <form className="task-edit-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="task-field">
        <span className="task-field-label">Title</span>
        <input
          className="task-input task-input-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          autoFocus
        />
      </label>
      <div className="task-edit-row task-edit-row-text">
        <label className="task-field">
          <span className="task-field-label">Description</span>
          <textarea
            className="task-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details, acceptance criteria…"
            rows={5}
          />
        </label>
        <label className="task-field">
          <span className="task-field-label">Memo</span>
          <textarea
            className="task-textarea"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Agent notes, findings, blockers…"
            rows={5}
          />
        </label>
      </div>
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
            onChange={(e) => {
              if (isPriority(e.target.value)) setPriority(e.target.value);
            }}
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
            onChange={(e) => {
              if (isStatus(e.target.value)) setStatus(e.target.value);
            }}
          >
            <option value="open">Open</option>
            <option value="in-progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </label>
        {!task.parentId && (
          <label className="task-field">
            <span className="task-field-label">Phase</span>
            <select
              className="task-select"
              value={phase}
              onChange={(e) => {
                if (isPhaseOrNone(e.target.value)) setPhase(e.target.value);
              }}
            >
              <option value="">None</option>
              <option value="plan">Plan</option>
              <option value="implement">Implement</option>
              <option value="review">Review</option>
              <option value="fix">Fix</option>
            </select>
          </label>
        )}
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

export const TaskRow = React.memo(function TaskRow({
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
        <InlineAddSubtask
          parentId={task.id}
          onCreateSubtask={onCreateSubtask}
          onClose={() => setAddingSubtask(false)}
        />
      )}
    </div>
  );
});
