export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "open" | "in-progress" | "done";

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  worktree: string | null;
  parentId: string | null;
  parallel: boolean;
  dueDate: string | null;
  epic: string | null;
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

/** Platform-independent worktree identifier (last path segment, lowercased). */
export function worktreeKey(p: string | null | undefined): string;

/** Serialize a task to its `.md` file representation. */
export function serializeTask(task: Task): string;

/** Parse a task `.md` file. Returns null if the frontmatter is invalid. */
export function parseTask(raw: string): Task | null;

/** Sort tasks by priority, then status, with subtasks grouped under parents. */
export function sortTasks<T extends Task>(tasks: T[]): T[];
