// CommonJS implementation of the repo → task-bucket mapping. repo-key.mjs
// re-exports it for the spawned `.mjs` MCP servers — exactly one implementation.
//
// A repo's tasks live in a bucket folder under ~/.code-workbench/repos/,
// named after the local checkout folder (e.g. `code-workbench-monorepo`).
// The name is sanitized but carries no hash — it is cosmetic and human-readable.
//
// The bucket name is derived from the git common-dir parent so that every
// worktree of the same repo resolves to the same bucket.

"use strict";

const path = require("node:path");

// Build a bucket name from a display name (the checkout folder basename).
// Returns null when displayName is empty/nullish.
function buildRepoKey(displayName) {
  const name =
    String(displayName ?? "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 64) || null;
  return name;
}

// Derive the bucket display name from git's common-dir output and a fallback
// working-tree path. Every worktree of the same repo produces the same name
// because they all share one common-dir parent.
//
//   commonDir  — raw output of `git rev-parse --git-common-dir` (may be
//                relative, absolute, or empty)
//   cwdPath    — absolute path of the working tree; used as fallback when
//                commonDir is empty or not resolvable
//
// Returns null when no name can be derived.
function repoNameFromCommonDir(commonDir, cwdPath) {
  const common = String(commonDir ?? "").trim();
  if (common) {
    const commonAbs = path.isAbsolute(common)
      ? common
      : path.resolve(cwdPath, common);
    const name = path.basename(path.dirname(commonAbs));
    if (name && name !== ".") return name;
  }
  return path.basename(cwdPath) || null;
}

module.exports = { buildRepoKey, repoNameFromCommonDir };
