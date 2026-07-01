/**
 * Build a repo's task-bucket name from a display name (the checkout folder
 * basename). Returns null when displayName is empty/nullish.
 */
export function buildRepoKey(displayName: string): string | null;

/**
 * Derive the bucket display name from the raw output of
 * `git rev-parse --git-common-dir` and a fallback absolute working-tree path.
 * Every worktree of the same repo produces the same name because they all
 * share one common-dir parent.
 */
export function repoNameFromCommonDir(
  commonDir: string,
  cwdPath: string,
): string | null;
