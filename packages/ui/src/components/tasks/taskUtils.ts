import type { WorkspaceTask, TaskPhase } from '../../types';

/** Get the value for `key`, inserting `init()` first when absent. */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = init();
    map.set(key, v);
  }
  return v;
}

/* Platform-independent worktree identifier — last path segment, lowercased.
 * Mirrors worktreeKey() in @code-workbench/mcp-core/task-format. */
export function worktreeKey(p: string | null | undefined): string {
  if (!p) return '';
  const seg =
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  return seg.toLowerCase();
}

export const PRIORITY_COLORS: Record<WorkspaceTask['priority'], string> = {
  high: '#e05c5c',
  medium: '#d4942a',
  low: '#5c9de0',
};

export const STATUS_LABELS: Record<WorkspaceTask['status'], string> = {
  open: 'open',
  'in-progress': 'in progress',
  done: 'done',
};

// Stable reference for "no subtasks" so memoized TaskRows don't re-render just
// because `childMap.get(id) ?? []` produced a fresh empty array each render.
export const NO_SUBTASKS: WorkspaceTask[] = [];

/** localStorage key for the page-mode list-column width the user dragged. */
export const LIST_WIDTH_KEY = 'cwTaskPageListWidth';

// Sibling-group comparator: lower `order` first, null/undefined `order` sorts
// last and falls back to `created` order among themselves. Mirrors
// `siblingCmp` in packages/mcp-core/task-format.cjs — keep both in sync.
export function siblingCmp(a: WorkspaceTask, b: WorkspaceTask): number {
  const ao = a.order ?? null;
  const bo = b.order ?? null;
  if (ao !== null && bo !== null) {
    if (ao !== bo) return ao - bo;
    return a.created.localeCompare(b.created);
  }
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  return a.created.localeCompare(b.created);
}

export function buildChildMap(tasks: WorkspaceTask[]): Map<string, WorkspaceTask[]> {
  const map = new Map<string, WorkspaceTask[]>();
  for (const t of tasks) {
    if (t.parentId) getOrCreate(map, t.parentId, () => []).push(t);
  }
  for (const children of map.values()) children.sort(siblingCmp);
  return map;
}

export function groupByEpic(
  tasks: WorkspaceTask[],
): Array<{ epic: string | null; tasks: WorkspaceTask[] }> {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, WorkspaceTask[]>();
  for (const t of tasks) {
    const key = t.epic ?? null;
    if (!buckets.has(key)) order.push(key);
    getOrCreate(buckets, key, () => []).push(t);
  }
  order.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  return order.map((epic) => ({ epic, tasks: getOrCreate(buckets, epic, () => []) }));
}

export function groupByWorktree(
  tasks: WorkspaceTask[],
): Array<{ worktree: string | null; tasks: WorkspaceTask[] }> {
  const map = new Map<string | null, WorkspaceTask[]>();
  for (const t of tasks) {
    const key = t.worktree ? worktreeKey(t.worktree) : null;
    getOrCreate(map, key, () => []).push(t);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([worktree, wtTasks]) => ({ worktree, tasks: wtTasks }));
}

export function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Ordered phase flow — used both to render the stepper and to know which
 *  phase a "start" click on an unset task should begin at. */
export const PHASE_FLOW: TaskPhase[] = ['plan', 'implement', 'review', 'fix', 'ship'];
export const PHASE_LABELS: Record<TaskPhase, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  fix: 'Fix',
  ship: 'Ship',
};

export const BLANK_TASK: WorkspaceTask = {
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

export type GroupBy = 'worktree' | 'epic' | 'none';
export type StatusFilter = 'active' | 'all' | 'session' | TaskStatusValue;
export type TaskStatusValue = WorkspaceTask['status'];

const PRIORITIES: readonly WorkspaceTask['priority'][] = ['high', 'medium', 'low'];
const STATUSES: readonly TaskStatusValue[] = ['open', 'in-progress', 'done'];

export function isPriority(v: string): v is WorkspaceTask['priority'] {
  return PRIORITIES.some((p) => p === v);
}
export function isStatus(v: string): v is TaskStatusValue {
  return STATUSES.some((s) => s === v);
}
/** A phase, or '' for "no phase". */
export function isPhaseOrNone(v: string): v is TaskPhase | '' {
  return v === '' || PHASE_FLOW.some((p) => p === v);
}
export function isGroupBy(v: string): v is GroupBy {
  return v === 'worktree' || v === 'epic' || v === 'none';
}
export function isStatusFilter(v: string): v is StatusFilter {
  return v === 'active' || v === 'all' || v === 'session' || isStatus(v);
}
