import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { PaneHeader } from './primitives';
import type { WorkspaceTask, NewWorkspaceTask, TasksApi, TaskPhase } from '../types';
import {
  isGroupBy,
  isStatusFilter,
  NO_SUBTASKS,
  LIST_WIDTH_KEY,
  buildChildMap,
  groupByEpic,
  groupByWorktree,
  type GroupBy,
  type StatusFilter,
} from './tasks/taskUtils';
import { TaskRow } from './tasks/TaskRow';
import { TaskDetailPane, TaskCreatePane, TaskDetailEmpty, NewTaskForm } from './tasks/TaskDetail';

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
    <div className={`cw-pane${pageMode ? ' cw-pane-page' : ''}`}>
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
          <div className={`task-search-row${pageMode ? ' task-toolbar-row' : ''}`}>
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
                  onChange={(e) => {
                    if (isGroupBy(e.target.value)) setGroupBy(e.target.value);
                  }}
                >
                  <option value="worktree">By worktree</option>
                  <option value="epic">By epic</option>
                  <option value="none">Flat list</option>
                </select>
                <select
                  className="task-select task-toolbar-select"
                  title="Filter by status"
                  value={statusFilter}
                  onChange={(e) => {
                    if (isStatusFilter(e.target.value)) setStatusFilter(e.target.value);
                  }}
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
