/**
 * server-env  —  cwd-based repo discovery shared by the stdio MCP servers.
 *
 * Used when the host did not pass CODE_WORKBENCH_REPO_PATH explicitly.
 */

import fsSync from "node:fs";
import path from "node:path";

const DOT_DIR = ".code-workbench";

function hasDotDir(dir) {
  try {
    return fsSync.statSync(path.join(dir, DOT_DIR)).isDirectory();
  } catch {
    return false;
  }
}

// Worktrees have a `.git` *file* (not directory) whose contents are
// `gitdir: /path/to/main/.git/worktrees/<name>`. Following that back two
// levels yields the main repo's `.git`, and one more its working tree —
// which is where `.code-workbench/` lives.
function resolveMainRepoFromWorktree(dir) {
  try {
    const gitPath = path.join(dir, ".git");
    const stat = fsSync.statSync(gitPath);
    if (!stat.isFile()) return "";
    const contents = fsSync.readFileSync(gitPath, "utf8");
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(contents);
    if (!match) return "";
    const gitdir = path.resolve(dir, match[1]);
    // .../main/.git/worktrees/<name> -> .../main
    const mainGitDir = path.dirname(path.dirname(gitdir));
    if (path.basename(mainGitDir) !== ".git") return "";
    return path.dirname(mainGitDir);
  } catch {
    return "";
  }
}

/** Walk up from the cwd and return the first directory `pick` accepts, or "". */
function walkUpFromCwd(pick) {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const hit = pick(dir);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

/**
 * The *worktree* root for the cwd — the nearest ancestor with a `.git` entry
 * (a directory for the main repo, a file for a linked worktree). Does NOT
 * resolve a worktree back to the main repo, so its basename is the key of the
 * worktree the session runs in.
 */
export function findWorktreeRootFromCwd() {
  return walkUpFromCwd((dir) =>
    fsSync.existsSync(path.join(dir, ".git")) ? dir : "",
  );
}

/**
 * The repo root for the cwd — the nearest ancestor holding `.code-workbench/`,
 * resolving linked worktrees back to the main repo's working tree.
 */
export function findRepoRootFromCwd() {
  return walkUpFromCwd((dir) => {
    if (hasDotDir(dir)) return dir;
    const mainRepo = resolveMainRepoFromWorktree(dir);
    return mainRepo && hasDotDir(mainRepo) ? mainRepo : "";
  });
}
