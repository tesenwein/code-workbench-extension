// The single source of truth for task `.md` file handling.
//
// Every consumer — the Electron app's main process, the VS Code extension,
// and the standalone MCP tasks server — reads and writes task files through
// this module, so the on-disk layout, the subtask rules, and the cascade
// semantics can never drift between them.
//
// Task files live at:
//   ~/.code-workbench/repos/<bucket>/tasks/<id>.md
// where <bucket> is derived from a machine-independent repo key (see
// repo-key.cjs). The implementation is CommonJS so both CJS consumers (the
// extension and the Electron main process) and the spawned `.mjs` MCP servers
// (via the task-store.mjs shim) share exactly one copy.

"use strict";

const { promises: fs } = require("node:fs");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  serializeTask,
  parseTask,
  sortTasks,
  worktreeKey,
} = require("./task-format.cjs");

const DOT_DIR = ".code-workbench";
const REPOS_SUBDIR = "repos";
const TASKS_SUBDIR = "tasks";

// Absolute path to the directory holding every repo's task bucket.
//
// Normally rooted at the user's home. When this module runs inside the tasks
// MCP server spawned in a WSL distro, `os.homedir()` is the *Linux* home — a
// different directory than the workbench app's Windows home, which would split
// the shared board in two. The host app then passes CODE_WORKBENCH_HOME (its
// own home, translated to a WSL path) so both sides resolve the same bucket.
function reposRoot() {
  const override = process.env.CODE_WORKBENCH_HOME;
  const home = override && override.trim() ? override.trim() : os.homedir();
  return path.join(home, DOT_DIR, REPOS_SUBDIR);
}

// Absolute path to a repo's task directory.
//
// `repoKey` is the bucket folder name — the sanitized checkout folder basename,
// e.g. `code-workbench-monorepo` (see repo-key.cjs).
function tasksDir(repoKey) {
  return path.join(reposRoot(), repoKey, TASKS_SUBDIR);
}

/** Absolute path to one task's `.md` file. */
function taskFilePath(repoKey, id) {
  return path.join(tasksDir(repoKey), `${id}.md`);
}

// Parsed-task cache keyed by absolute file path. A list stats each file and
// re-reads + re-parses only those whose mtime or size changed since last time;
// unchanged files (the bulk of a large board) reuse their cached parse. Writes
// go through this module and bump the file mtime, and external edits change it
// too, so the stat is self-invalidating — there is no cache to bust by hand.
const parseCache = new Map();

// Read+parse every `.md` in a directory. Returns parsed tasks plus a count of
// files that could not be read/parsed, so callers can surface "(N unreadable)"
// instead of silently dropping bad files.
async function readDir(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { tasks: [], unreadable: 0 };
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
  const present = new Set();
  // Stat every file concurrently and parse only the changed ones. Per-file I/O
  // dominates the cost of a list, and on slow filesystems (WSL 9p, network
  // mounts) sequential awaits serialize that latency across hundreds of small
  // files. Each entry resolves to a parsed task or null (unreadable).
  const results = await Promise.all(
    files.map(async (e) => {
      const file = path.join(dir, e.name);
      present.add(file);
      let stat;
      try {
        stat = await fs.stat(file);
      } catch (err) {
        console.error(
          `[task-store] failed to stat task file ${file}: ${err?.message ?? err}`,
        );
        return null;
      }
      const cached = parseCache.get(file);
      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size
      ) {
        return cached.task;
      }
      try {
        const t = parseTask(await fs.readFile(file, "utf8"));
        if (t) {
          parseCache.set(file, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            task: t,
          });
          return t;
        }
        console.error(
          `[task-store] failed to parse task file (bad frontmatter): ${file}`,
        );
        parseCache.delete(file);
        return null;
      } catch (err) {
        console.error(
          `[task-store] failed to read task file ${file}: ${err?.message ?? err}`,
        );
        parseCache.delete(file);
        return null;
      }
    }),
  );
  // Drop cache entries for files that disappeared from this dir so the cache
  // can't grow without bound as tasks are deleted over a long session.
  if (parseCache.size > present.size) {
    const prefix = dir + path.sep;
    for (const key of parseCache.keys()) {
      if (key.startsWith(prefix) && !present.has(key)) parseCache.delete(key);
    }
  }
  const tasks = results.filter(Boolean);
  return { tasks, unreadable: results.length - tasks.length };
}

/** All tasks for a repo, unsorted, with an unreadable-file count. */
async function readTasks(repoKey) {
  return readDir(tasksDir(repoKey));
}

/** All tasks for a repo, sorted (priority, then status, subtasks under parents). */
async function listTasks(repoKey) {
  return sortTasks((await readDir(tasksDir(repoKey))).tasks);
}

// Resolve a possibly-abbreviated id to a full id. Returns the full id, or
// `{ ambiguous: [...] }` when a prefix matches several tasks, or null.
async function resolveTaskId(repoKey, id) {
  if (!id) return null;
  const dir = tasksDir(repoKey);
  try {
    if (fsSync.existsSync(path.join(dir, `${id}.md`))) return id;
  } catch {
    /* ignore */
  }
  try {
    const matches = (await fs.readdir(dir))
      .filter((n) => n.endsWith(".md") && n.startsWith(id))
      .map((n) => n.slice(0, -3));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { ambiguous: matches };
  } catch {
    /* ignore */
  }
  return null;
}

// Every descendant id reachable from rootId (children, grandchildren, ...).
function collectDescendants(allTasks, rootId) {
  const byParent = new Map();
  for (const t of allTasks) {
    if (!t.parentId) continue;
    if (!byParent.has(t.parentId)) byParent.set(t.parentId, []);
    byParent.get(t.parentId).push(t.id);
  }
  const out = [];
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    for (const childId of byParent.get(id) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.push(childId);
      stack.push(childId);
    }
  }
  return out;
}

// True if re-parenting `taskId` under `newParentId` would create a cycle.
function wouldCycle(allTasks, taskId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === taskId) return true;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const seen = new Set();
  let cur = byId.get(newParentId);
  while (cur) {
    if (cur.id === taskId) return true;
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
  }
  return false;
}

// Build a complete task record from caller-supplied fields, applying every
// invariant (a subtask never owns a worktree; worktrees collapse to a stable
// key). Pure — does not touch disk.
function makeTask(input) {
  const now = new Date().toISOString();
  const parentId = input.parentId ?? null;
  return {
    id: randomUUID(),
    title: String(input.title),
    description: input.description ?? "",
    memo: input.memo ?? "",
    priority: input.priority ?? "medium",
    status: input.status ?? "open",
    // A subtask inherits its worktree from the root task — never its own.
    worktree: parentId || !input.worktree ? null : worktreeKey(input.worktree),
    parentId,
    parallel: input.parallel ?? false,
    order: input.order ?? null,
    dueDate: input.dueDate ?? null,
    epic: input.epic ?? null,
    phase: input.phase ?? null,
    tags: input.tags ?? [],
    created: now,
    updated: now,
  };
}

/** Create a task and write its file. Returns the created task. */
async function createTask(repoKey, input) {
  const dir = tasksDir(repoKey);
  await fs.mkdir(dir, { recursive: true });
  const task = makeTask(input);
  await fs.writeFile(
    path.join(dir, `${task.id}.md`),
    serializeTask(task),
    "utf8",
  );
  return task;
}

// Apply a partial patch to an existing task. Returns the updated task, or null
// if it doesn't exist. Worktree values are normalized; a subtask is forced to
// have no worktree of its own. Cycle/cross-field validation is the caller's
// job (use wouldCycle + resolveTaskId).
async function updateTask(repoKey, id, patch) {
  const file = taskFilePath(repoKey, id);
  let existing;
  try {
    existing = parseTask(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  if (!existing) return null;
  const next = { ...patch };
  if (patch.worktree !== undefined) {
    next.worktree = patch.worktree ? worktreeKey(patch.worktree) : null;
  }
  const effectiveParentId =
    next.parentId !== undefined ? next.parentId : existing.parentId;
  if (effectiveParentId) next.worktree = null;
  const updated = {
    ...existing,
    ...next,
    id,
    updated: new Date().toISOString(),
  };
  await fs.writeFile(file, serializeTask(updated), "utf8");
  return updated;
}

// Delete a task and its whole subtree. Returns the ids actually removed
// (parent first). Missing files are ignored.
async function deleteTask(repoKey, id) {
  const dir = tasksDir(repoKey);
  const { tasks } = await readDir(dir);
  const ids = [id, ...collectDescendants(tasks, id)];
  const removed = [];
  for (const tid of ids) {
    try {
      await fs.unlink(path.join(dir, `${tid}.md`));
      removed.push(tid);
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
  }
  return removed;
}

// Drop the worktree assignment from every OPEN task pointing at `worktreePath`,
// so they stay actionable after the worktree is gone. Completed tasks keep
// their worktree pointer — they remain archived under the removed worktree.
// Matches by worktreeKey so paths stored on another machine still clear.
async function clearTaskWorktree(repoKey, worktreePath) {
  const targetKey = worktreeKey(worktreePath);
  if (!targetKey) return;
  const dir = tasksDir(repoKey);
  const { tasks } = await readDir(dir);
  const now = new Date().toISOString();
  await Promise.all(
    tasks
      .filter(
        (t) => worktreeKey(t.worktree) === targetKey && t.status !== "done",
      )
      .map((t) =>
        fs.writeFile(
          path.join(dir, `${t.id}.md`),
          serializeTask({ ...t, worktree: null, updated: now }),
          "utf8",
        ),
      ),
  );
}

// Reassign tasks (by id) to a worktree. With shared per-repo storage this is
// just a field update — source and target share one bucket.
async function copyTasksToWorktree(repoKey, taskIds, targetWorktreePath) {
  const key = worktreeKey(targetWorktreePath);
  const updated = [];
  for (const id of taskIds) {
    const t = await updateTask(repoKey, id, { worktree: key });
    if (t) updated.push(t.id);
  }
  return updated;
}

module.exports = {
  tasksDir,
  taskFilePath,
  readTasks,
  listTasks,
  resolveTaskId,
  collectDescendants,
  wouldCycle,
  makeTask,
  createTask,
  updateTask,
  deleteTask,
  clearTaskWorktree,
  copyTasksToWorktree,
};
