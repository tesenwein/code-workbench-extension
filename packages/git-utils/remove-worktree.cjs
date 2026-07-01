'use strict';

const { promises: fs } = require('node:fs');
const path = require('node:path');

const GIT_TIMEOUT_MS = 15_000;

const LOCK_PATTERNS = ['Permission denied', 'failed to delete', 'EBUSY', 'EPERM', 'ENOTEMPTY'];

const RETRY_DELAYS_MS = [0, 200, 500, 1000, 2000, 3000, 4000, 4000];

async function removeWorktreeRobust(opts) {
  const {
    worktreePath,
    runGit,
    pendingDeletions,
    detachOnLock = true,
    log = (msg) => console.warn(msg),
  } = opts;

  const gitdirMeta = detachOnLock ? await readWorktreeGitdir(worktreePath) : null;

  try {
    await runGit(['worktree', 'remove', '--force', worktreePath], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNotWorktree = msg.includes('is not a working tree');
    const isTimeout = msg.startsWith('Timed out after');
    const isLocked = LOCK_PATTERNS.some((p) => msg.includes(p));
    if (!isLocked && !isNotWorktree && !isTimeout) throw err;

    if (await pathExists(worktreePath)) {
      try {
        await rmWithRetry(worktreePath);
      } catch (rmErr) {
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

async function rmWithRetry(target) {
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

async function readWorktreeGitdir(worktreeFsPath) {
  try {
    const raw = await fs.readFile(path.join(worktreeFsPath, '.git'), 'utf8');
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
    if (!m) return null;
    return path.dirname(path.resolve(worktreeFsPath, m[1]));
  } catch {
    return null;
  }
}

async function forceDetachWorktree(runGit, gitdirMeta) {
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

module.exports = {
  removeWorktreeRobust,
  rmWithRetry,
  readWorktreeGitdir,
  forceDetachWorktree,
};
