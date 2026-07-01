export interface GitRunOptions {
  timeoutMs?: number;
}

export type RunGit = (args: string[], opts?: GitRunOptions) => Promise<string>;

export interface PendingDeletionStore {
  /** Persist a worktree path that couldn't be deleted in this session, so the
   *  caller can retry on next launch once the locking process has exited. */
  add(worktreePath: string): Promise<void>;
}

export interface RemoveWorktreeOptions {
  /** Absolute path of the worktree to remove. */
  worktreePath: string;
  /** Git runner already bound to the repo cwd. */
  runGit: RunGit;
  /** Win32 rescue: queue a still-locked directory for cleanup on next launch.
   *  When omitted, a persistent lock bubbles up as an error. */
  pendingDeletions?: PendingDeletionStore;
  /** When true (default), a Windows-locked directory triggers detach-from-git
   *  + pendingDeletions. Set false for distro/WSL worktrees whose registry
   *  path isn't readable from the host filesystem. */
  detachOnLock?: boolean;
  /** Optional logger for the "detached and queued" rescue path. */
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
