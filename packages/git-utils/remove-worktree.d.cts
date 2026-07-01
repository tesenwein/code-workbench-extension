export interface GitRunOptions {
  timeoutMs?: number;
}

export type RunGit = (args: string[], opts?: GitRunOptions) => Promise<string>;

export interface PendingDeletionStore {
  add(worktreePath: string): Promise<void>;
}

export interface RemoveWorktreeOptions {
  worktreePath: string;
  runGit: RunGit;
  pendingDeletions?: PendingDeletionStore;
  detachOnLock?: boolean;
  log?: (msg: string) => void;
}

export function removeWorktreeRobust(
  opts: RemoveWorktreeOptions,
): Promise<void>;
export function rmWithRetry(target: string): Promise<void>;
export function readWorktreeGitdir(
  worktreeFsPath: string,
): Promise<string | null>;
export function forceDetachWorktree(
  runGit: RunGit,
  gitdirMeta: string | null,
): Promise<void>;
