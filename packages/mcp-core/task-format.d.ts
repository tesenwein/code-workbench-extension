export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "open" | "in-progress" | "done";
export type TaskPhase = "plan" | "implement" | "review" | "fix";

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  worktree: string | null;
  parentId: string | null;
  parallel: boolean;
  /** Sibling-group sort key (lower first). Null siblings sort last, falling
   *  back to `created` order among themselves. */
  order: number | null;
  dueDate: string | null;
  epic: string | null;
  /** Workflow phase this (root) task is being driven through, or null. */
  phase: TaskPhase | null;
  tags: string[];
  description: string;
  memo: string;
  created: string;
  updated: string;
}

export const PRIORITY_ORDER: Record<TaskPriority, number>;
export const STATUS_ORDER: Record<TaskStatus, number>;
export const VALID_PRIORITIES: TaskPriority[];
export const VALID_STATUSES: TaskStatus[];
export const VALID_PHASES: TaskPhase[];

/** Platform-independent worktree identifier (last path segment, lowercased). */
export function worktreeKey(p: string | null | undefined): string;

/** Serialize a task to its `.md` file representation. */
export function serializeTask(task: Task): string;

/** Parse a task `.md` file. Returns null if the frontmatter is invalid. */
export function parseTask(raw: string): Task | null;

/** Sort tasks by priority, then status, with subtasks grouped under parents. */
export function sortTasks<T extends Task>(tasks: T[]): T[];

/** Sibling-group comparator: lower `order` first, null `order` sorts last and
 *  falls back to `created` order among themselves. */
export function siblingCmp<T extends Pick<Task, "order" | "created">>(
  a: T,
  b: T,
): number;
