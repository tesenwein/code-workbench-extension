// Robust `git worktree remove`, shared by the Electron app and the VS Code
// extension. Caller injects `runGit` (so the same cwd/runtime quirks apply as
// the rest of their codebase) and optionally a `pendingDeletions` store for
// the Windows "directory still locked" rescue path.
//
// The caller is responsible for pre-cleanup (closing watchers, killing
// terminals inside the worktree) and post-cleanup (invalidating their cache,
// refreshing the UI). This module only owns the git+filesystem dance.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const GIT_TIMEOUT_MS = 15_000;

const LOCK_PATTERNS = ['Permission denied', 'failed to delete', 'EBUSY', 'EPERM', 'ENOTEMPTY'];

const RETRY_DELAYS_MS = [0, 200, 500, 1000, 2000, 3000, 4000, 4000];

/**
 * Remove a linked worktree, falling back to manual rm-with-retry on Windows
 * lock errors and to "force detach + queue for later" if the directory is
 * stuck for good. Idempotent on already-gone worktrees.
 *
 * @param {object} opts
 * @param {string} opts.worktreePath  absolute path to the worktree
 * @param {(args: string[], gitOpts?: { timeoutMs?: number }) => Promise<string>} opts.runGit
 *        git runner, already bound to the repo's cwd
 * @param {{ add(p: string): Promise<void> }} [opts.pendingDeletions]
 *        when supplied and the directory is still locked after retry, the
 *        path is queued so the caller can retry on next launch (Windows only)
 * @param {boolean} [opts.detachOnLock=true]
 *        when true, a Windows-locked directory triggers `forceDetachWorktree`
 *        + pendingDeletions instead of throwing. Set false for distro/WSL
 *        worktrees whose registry isn't readable from the host fs.
 * @param {(msg: string) => void} [opts.log=console.warn]
 */
export async function removeWorktreeRobust(opts) {
  const {
    worktreePath,
    runGit,
    pendingDeletions,
    detachOnLock = true,
    log = (msg) => console.warn(msg),
  } = opts;

  // Capture git's registry path for this worktree BEFORE any deletion runs:
  // the worktree's own `.git` file points at <repo>/.git/worktrees/<id>, and
  // deleting the worktree directory destroys that pointer. Kept so the
  // lock fallback can still detach the worktree from git's registry.
  const gitdirMeta = detachOnLock ? await readWorktreeGitdir(worktreePath) : null;

  try {
    // Cap the git call so a wedged `worktree remove` (file lock, stuck helper
    // process, hung fsmonitor) doesn't freeze the UI — on timeout we drop to
    // the manual-rm fallback below.
    await runGit(['worktree', 'remove', '--force', worktreePath], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNotWorktree = msg.includes('is not a working tree');
    const isTimeout = msg.startsWith('Timed out after');
    const isLocked = LOCK_PATTERNS.some((p) => msg.includes(p));
    if (!isLocked && !isNotWorktree && !isTimeout) throw err;

    // Remove the directory ourselves if it still exists (true for both lock
    // failures and orphaned worktrees that lost their git registration).
    if (await pathExists(worktreePath)) {
      try {
        await rmWithRetry(worktreePath);
      } catch (rmErr) {
        // The directory is still locked by a stray handle — typically an
        // orphaned subprocess that outlived its terminal and keeps the
        // worktree as its working directory. We can't delete it now, but we
        // can still make it disappear: detach it from git's registry (so it
        // leaves `git worktree list` and the branch is reusable) and queue
        // the directory for deletion at the next launch.
        if (process.platform === 'win32' && detachOnLock && pendingDeletions && gitdirMeta) {
          await forceDetachWorktree(runGit, gitdirMeta);
          await pendingDeletions.add(worktreePath);
          log(
            `[worktree] ${worktreePath} is locked; detached from git and queued for cleanup on next launch.`,
          );
        } else {
          throw rmErr;
        }
      }
    }
    await runGit(['worktree', 'prune'], { timeoutMs: GIT_TIMEOUT_MS }).catch(() => {});
  }
}

/**
 * Best-effort recursive remove with backoff. Windows releases directory
 * handles (chokidar's recursive watch, a just-killed PTY's cwd, a finishing
 * `git status`) asynchronously after the owning process/handle is gone, so an
 * EBUSY is usually transient. Retry with a backoff long enough to outlast
 * those releases (~15s total).
 */
export async function rmWithRetry(target) {
  let lastErr;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      await fs.rm(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/EBUSY|EPERM|ENOTEMPTY|Permission denied/.test(msg)) throw err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Worktree directory is locked (${msg}). Close any open terminals, editors, or file watchers inside the worktree and try again.`,
  );
}

/**
 * Resolve git's registry directory for a linked worktree by reading the
 * `gitdir:` line of the worktree's own `.git` file. Returns the absolute
 * path to <repo>/.git/worktrees/<id>, or null if it can't be determined.
 */
export async function readWorktreeGitdir(worktreeFsPath) {
  try {
    const raw = await fs.readFile(path.join(worktreeFsPath, '.git'), 'utf8');
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
    if (!m) return null;
    // The recorded path points at <id>/.git inside the registry; the registry
    // entry to drop is its parent directory.
    return path.dirname(path.resolve(worktreeFsPath, m[1]));
  } catch {
    return null;
  }
}

/**
 * Detach a worktree from git without deleting its (locked) directory: drop
 * the <repo>/.git/worktrees/<id> registry entry so `git worktree list` no
 * longer reports it and the branch is freed for reuse, then prune leftovers.
 */
export async function forceDetachWorktree(runGit, gitdirMeta) {
  if (gitdirMeta && (await pathExists(gitdirMeta))) {
    await fs.rm(gitdirMeta, { recursive: true, force: true }).catch(() => {});
  }
  await runGit(['worktree', 'prune'], { timeoutMs: GIT_TIMEOUT_MS }).catch(() => {});
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
