import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { buildRepoKey, repoNameFromCommonDir } from '@code-workbench/mcp-core/repo-key';

const pExecFile = promisify(execFile);

const INVALID_BRANCH_RE =
  /(^[-./])|([./]$)|(\.\.)|([\x00-\x20~^:?*\]\\])|(@\{)|(\/\/)|(\.lock(\/|$))/;

function validateBranchName(branch: string): void {
  if (!branch || !branch.trim()) throw new Error('Branch name cannot be empty.');
  if (branch.length > 250) throw new Error('Branch name is too long.');
  if (INVALID_BRANCH_RE.test(branch)) {
    throw new Error(
      `Invalid branch name «${branch}». Branch names cannot contain spaces, control chars, '..', '~', '^', ':', '?', '*', '[', '\\', or start/end with '.', '/', '-'.`,
    );
  }
}

function validateNewWorktreePath(newPath: string): void {
  if (!newPath || !newPath.trim()) throw new Error('Worktree path cannot be empty.');
  if (fs.existsSync(newPath)) {
    throw new Error(`Path «${newPath}» already exists. Choose a different location.`);
  }
  const parent = path.dirname(newPath);
  if (!fs.existsSync(parent)) {
    throw new Error(`Parent directory «${parent}» does not exist.`);
  }
}

export async function gitRaw(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const child = pExecFile('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs,
  });
  try {
    const { stdout } = await child;
    return stdout;
  } catch (err: unknown) {
    // execFile sets err.killed=true and signal='SIGTERM' on timeout. Surface a
    // message the shared worktree-removal helper recognises as a timeout so it
    // drops to the manual-rm fallback instead of bubbling.
    if (
      err &&
      typeof err === 'object' &&
      'killed' in err &&
      (err as { killed?: boolean }).killed &&
      opts.timeoutMs
    ) {
      throw new Error(`Timed out after ${opts.timeoutMs}ms: git ${args.join(' ')}`, {
        cause: err,
      });
    }
    throw err;
  }
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  uncommittedCount?: number;
  /** Commits the branch is ahead of its upstream. Undefined when no upstream. */
  ahead?: number;
  /** Commits the branch is behind its upstream. Undefined when no upstream. */
  behind?: number;
}

/** Count of files with uncommitted changes (staged, unstaged, or untracked). */
export async function countUncommitted(worktreePath: string): Promise<number> {
  try {
    const status = await gitRaw(worktreePath, ['status', '--porcelain']);
    return status.trim()
      ? new Set(
          status
            .trim()
            .split('\n')
            .map((l) => l.slice(3)),
        ).size
      : 0;
  } catch {
    return 0;
  }
}

/** Ahead/behind commit counts relative to the branch's upstream. Returns
 *  `undefined` for both when the branch has no upstream configured. */
export async function aheadBehind(
  worktreePath: string,
): Promise<{ ahead?: number; behind?: number }> {
  try {
    await gitRaw(worktreePath, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}',
    ]);
  } catch {
    return {};
  }
  try {
    const out = await gitRaw(worktreePath, [
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD',
    ]);
    const [behind, ahead] = out
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10));
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return {};
  }
}

export async function listWorktrees(repoPath: string): Promise<Worktree[]> {
  const raw = await gitRaw(repoPath, ['worktree', 'list', '--porcelain']);
  const blocks = raw.split('\n\n').filter(Boolean);
  const trees: Worktree[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    const entry: Partial<Worktree> = { isMain: i === 0 };
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.path = line.slice(9);
      else if (line.startsWith('HEAD ')) entry.head = line.slice(5);
      else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace('refs/heads/', '');
      else if (line === 'detached') entry.branch = '(detached)';
    }
    if (entry.path) {
      trees.push({
        path: entry.path,
        branch: entry.branch ?? '(unknown)',
        head: entry.head ?? '',
        isMain: entry.isMain ?? false,
      });
    }
  }
  await Promise.all(
    trees.map(async (wt) => {
      wt.uncommittedCount = await countUncommitted(wt.path);
      const { ahead, behind } = await aheadBehind(wt.path);
      wt.ahead = ahead;
      wt.behind = behind;
    }),
  );
  return trees;
}

export async function addWorktree(
  repoPath: string,
  branch: string,
  newPath: string,
  opts: { createBranch?: boolean; base?: string } = {},
): Promise<string> {
  validateBranchName(branch);
  validateNewWorktreePath(newPath);

  const local = (await gitRaw(repoPath, ['branch', '--format=%(refname:short)']))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const exists = local.includes(branch);
  const base = opts.base?.trim() || undefined;

  const existingWorktrees = await listWorktrees(repoPath);
  if (existingWorktrees.some((wt) => wt.branch === branch)) {
    throw new Error(`Branch «${branch}» is already checked out in another worktree.`);
  }

  if (base) validateBranchName(base);

  if (opts.createBranch) {
    if (exists) throw new Error(`Branch «${branch}» already exists.`);
    const cmd = ['worktree', 'add', '-b', branch, newPath];
    if (base) cmd.push(base);
    await gitRaw(repoPath, cmd);
  } else if (exists) {
    // Refresh the remote-tracking ref so the new worktree's ahead/behind count
    // is accurate. Best-effort — do not block worktree creation on a fetch
    // failure (offline, no remote). Does not touch the local branch ref.
    await gitRaw(repoPath, ['fetch', 'origin', branch]).catch(() => {});
    await gitRaw(repoPath, ['worktree', 'add', newPath, branch]);
  } else {
    const cmd = ['worktree', 'add', '-b', branch, newPath];
    if (base) cmd.push(base);
    await gitRaw(repoPath, cmd);
  }
  return newPath;
}

/** Local branch names that look like a project's integration branch, in
 *  priority order. A worktree branch merged into any of these is "stale". */
const BASE_BRANCH_CANDIDATES = ['main', 'master', 'develop'];

/** Subset of BASE_BRANCH_CANDIDATES that actually exist as local branches. */
async function resolveBaseBranches(repoPath: string): Promise<string[]> {
  let locals: string[];
  try {
    locals = (await gitRaw(repoPath, ['branch', '--format=%(refname:short)']))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
  return BASE_BRANCH_CANDIDATES.filter((b) => locals.includes(b));
}

/** Worktrees whose branch is fully merged into an integration branch
 *  (main/master/develop). Never includes the main worktree, detached heads,
 *  or the base branches themselves — those are the cleanup-safe candidates. */
export async function mergedWorktrees(repoPath: string): Promise<Worktree[]> {
  const bases = await resolveBaseBranches(repoPath);
  if (bases.length === 0) return [];
  const merged = new Set<string>();
  // Query each base branch concurrently — they're independent and there are
  // typically 2-3 (main/master/develop), so a sequential await chain just adds
  // process-spawn latency.
  const outputs = await Promise.all(
    bases.map((base) =>
      gitRaw(repoPath, ['branch', '--merged', base, '--format=%(refname:short)']).catch(
        () => '' /* base may be unreachable — skip it */,
      ),
    ),
  );
  for (const out of outputs) {
    for (const b of out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!bases.includes(b)) merged.add(b);
    }
  }
  if (merged.size === 0) return [];
  const trees = await listWorktrees(repoPath);
  return trees.filter((wt) => !wt.isMain && wt.branch !== '(detached)' && merged.has(wt.branch));
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  pendingDeletions?: { add(p: string): Promise<void> },
): Promise<void> {
  // Lazy require so the extension's esbuild bundle keeps a clean static import
  // graph regardless of node ESM/CJS interop quirks.
  const { removeWorktreeRobust } = await import('@code-workbench/git-utils/remove-worktree');
  await removeWorktreeRobust({
    worktreePath,
    runGit: (args: string[], opts?: { timeoutMs?: number }) => gitRaw(repoPath, args, opts),
    pendingDeletions,
  });
}

export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await gitRaw(cwd, ['rev-parse', '--show-toplevel']);
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** The repo's task-bucket name (the sanitized checkout folder basename).
 *  Every worktree of the same repo agrees because we use the git common-dir
 *  parent. Returns null when `cwd` isn't a git working tree. */
export async function findRepoKey(cwd: string): Promise<string | null> {
  try {
    const common = (await gitRaw(cwd, ['rev-parse', '--git-common-dir'])).trim();
    const commonAbs = common ? (path.isAbsolute(common) ? common : path.resolve(cwd, common)) : '';
    const name = repoNameFromCommonDir(common, cwd);
    return buildRepoKey(name ?? '') ?? (commonAbs || null);
  } catch {
    return null;
  }
}
