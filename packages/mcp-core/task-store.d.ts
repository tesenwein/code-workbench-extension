import type { Task } from "./task-format";

/** Fields accepted when creating a task; the rest are derived/defaulted. */
export interface TaskInput {
  title: string;
  description?: string;
  memo?: string;
  priority?: Task["priority"];
  status?: Task["status"];
  worktree?: string | null;
  parentId?: string | null;
  parallel?: boolean;
  dueDate?: string | null;
  epic?: string | null;
  tags?: string[];
}

/** Result of resolving an id prefix that matched more than one task. */
export interface AmbiguousId {
  ambiguous: string[];
}

/** Absolute path to a repo's task directory. */
export function tasksDir(repoKey: string): string;

/** Absolute path to one task's `.md` file. */
export function taskFilePath(repoKey: string, id: string): string;

/** All tasks for a repo, unsorted, with a count of unreadable files. */
export function readTasks(
  repoKey: string,
): Promise<{ tasks: Task[]; unreadable: number }>;

/** All tasks for a repo, sorted (priority, then status, subtasks under parents). */
export function listTasks(repoKey: string): Promise<Task[]>;

/** Resolve a possibly-abbreviated id to a full id. */
export function resolveTaskId(
  repoKey: string,
  id: string,
): Promise<string | AmbiguousId | null>;

/** Every descendant id reachable from `rootId`. */
export function collectDescendants(allTasks: Task[], rootId: string): string[];

/** True if re-parenting `taskId` under `newParentId` would create a cycle. */
export function wouldCycle(
  allTasks: Task[],
  taskId: string,
  newParentId: string | null,
): boolean;

/** Build a complete task record from caller-supplied fields. Pure. */
export function makeTask(input: TaskInput): Task;

/** Create a task and write its file. */
export function createTask(repoKey: string, input: TaskInput): Promise<Task>;

/** Apply a partial patch to an existing task. Returns null if it doesn't exist. */
export function updateTask(
  repoKey: string,
  id: string,
  patch: Partial<Task>,
): Promise<Task | null>;

/** Delete a task and its whole subtree. Returns the ids actually removed. */
export function deleteTask(repoKey: string, id: string): Promise<string[]>;

/** Drop the worktree assignment from every open task pointing at `worktreePath`.
 *  Completed tasks keep their pointer (archived under the removed worktree). */
export function clearTaskWorktree(
  repoKey: string,
  worktreePath: string,
): Promise<void>;

/** Reassign tasks (by id) to a worktree. Returns the ids updated. */
export function copyTasksToWorktree(
  repoKey: string,
  taskIds: string[],
  targetWorktreePath: string,
): Promise<string[]>;
