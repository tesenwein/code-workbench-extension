#!/usr/bin/env node
// MCP stdio server that gives Claude access to workspace task files.
// Task files live in ~/.code-workbench/repos/<bucket>/tasks/<id>.md.
// The repo key (a root-commit-derived identity) is injected via
// CODE_WORKBENCH_REPO_KEY, the repo path via CODE_WORKBENCH_REPO_PATH,
// and the active worktree via CODE_WORKBENCH_WORKTREE_PATH when Claude is
// spawned.

import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recordToolUse } from "./usage-log.mjs";
import {
  sortTasks,
  VALID_PRIORITIES as VALID_PRIORITY_LIST,
  VALID_STATUSES as VALID_STATUS_LIST,
  VALID_PHASES as VALID_PHASE_LIST,
  worktreeKey,
} from "./task-format.mjs";
import { tokenize, bm25Rank } from "./text-rank.mjs";
import { buildRepoKey, repoNameFromCommonDir } from "./repo-key.mjs";
import {
  readTasks,
  createTask,
  updateTask,
  deleteTask,
  resolveTaskId,
  wouldCycle,
} from "./task-store.mjs";

const VALID_PRIORITIES = new Set(VALID_PRIORITY_LIST);
const VALID_STATUSES = new Set(VALID_STATUS_LIST);
const VALID_PHASES = new Set(VALID_PHASE_LIST);

const DOT_DIR = ".code-workbench";

function git(repoPath, args) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = err?.stderr?.trim();
    if (stderr)
      process.stderr.write(`[tasks-server] git ${args[0]} error: ${stderr}\n`);
    throw err;
  }
}

// Resolve a working-tree path to its task-bucket name (the sanitized checkout
// folder basename). Every worktree of the same repo agrees because we use the
// git common-dir parent. Returns null when not a git working tree.
// Only used when CODE_WORKBENCH_REPO_KEY isn't injected by the host app.
function findRepoKeyFromCwd(repoPath) {
  try {
    const common = git(repoPath, ["rev-parse", "--git-common-dir"]);
    const commonAbs = common
      ? path.isAbsolute(common)
        ? common
        : path.resolve(repoPath, common)
      : "";
    const name = repoNameFromCommonDir(common, repoPath);
    return buildRepoKey(name) ?? (commonAbs || repoPath || null);
  } catch {
    /* not a git working tree */
  }
  return null;
}

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

function findRepoRootFromCwd() {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (hasDotDir(dir)) return dir;
    const mainRepo = resolveMainRepoFromWorktree(dir);
    if (mainRepo && hasDotDir(mainRepo)) return mainRepo;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

// The *worktree* root for the cwd — the nearest ancestor with a `.git` entry
// (a directory for the main repo, a file for a linked worktree). Unlike
// `findRepoRootFromCwd`, this does NOT resolve a worktree back to the main
// repo, so its basename is the key of the worktree the session runs in.
function findWorktreeRootFromCwd() {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fsSync.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

const REPO_PATH = process.env.CODE_WORKBENCH_REPO_PATH || findRepoRootFromCwd();

const REPO_KEY =
  process.env.CODE_WORKBENCH_REPO_KEY || findRepoKeyFromCwd(REPO_PATH);

// Stable key of the worktree this server was spawned in. When set, task_list
// is scoped strictly to tasks assigned to this worktree. Resolved from the
// cwd's worktree root — never from REPO_PATH, which is deliberately resolved
// to the *main* repo and would mis-scope a worktree session to the main repo.
const WORKTREE_KEY = worktreeKey(
  process.env.CODE_WORKBENCH_WORKTREE_PATH || findWorktreeRootFromCwd(),
);

// Throws a clear error when the repo key couldn't be resolved, so handlers
// surface that instead of silently reading an empty task bucket.
function requireRepoKey() {
  if (!REPO_KEY) {
    throw new Error(
      "repo key could not be resolved — set CODE_WORKBENCH_REPO_KEY or run from within a git working tree.",
    );
  }
  return REPO_KEY;
}

// --- BM25 similar-task scoring (tokenize + bm25Rank imported from text-rank.mjs) ---

const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fn())
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    });
  locks.set(key, next);
  return next;
}

export const TOOLS = [
  {
    name: "task_list",
    description:
      "Show the task board for this repo, scoped to the current worktree. By default returns tasks assigned to the worktree this session runs in PLUS unassigned tasks (the shared backlog, shown as [unassigned]), sorted high→low priority, then by status. Use this first when picking up work or to check whether something is already tracked. Pass an explicit `worktree` (folder name) to view exactly that worktree (excludes the unassigned backlog), or filter with `status` (open|in-progress|done).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in-progress", "done"],
          description: "Filter by status.",
        },
        worktree: {
          type: "string",
          description:
            "Filter by worktree name (basename of the worktree path; matching is case-insensitive).",
        },
        limit: {
          type: "number",
          description: "Cap number of tasks returned. Defaults to 200.",
        },
      },
    },
  },
  {
    name: "task_create",
    description:
      'Add a new task to this repo\'s shared board. Tasks persist across sessions and are visible to both you and the user in the VS Code Claude Workbench panel. Always use this tool — do not write task files by hand. Example: {"title":"Fix login redirect","description":"401 after SSO callback","priority":"high","worktree":"feature-auth"}.',
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title." },
        description: {
          type: "string",
          description: "Detailed description or notes (markdown).",
        },
        memo: {
          type: "string",
          description:
            "Free-form agent memo — use this to log findings, blockers, or detailed notes without overwriting the description.",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: 'Task priority. Defaults to "medium".',
        },
        worktree: {
          type: "string",
          description:
            "Worktree path to assign this task to (relative to repo root). Omit for unassigned.",
        },
        parentId: {
          type: "string",
          description:
            "Parent task ID. Set to create a subtask nested under an existing task.",
        },
        parallel: {
          type: "boolean",
          description:
            "Mark this subtask as safe to execute in parallel with its sibling parallel subtasks. cw-work will dispatch parallel-flagged subtasks of the same parent concurrently via subagents. Only meaningful on subtasks (parentId set).",
        },
        order: {
          type: "number",
          description:
            "Sibling-group sort key (lower runs first). Use it to sequence subtasks under the same parent — adjacent subtasks that share the same order (and are both parallel) form a concurrent wave. Omit to sort last, after any ordered siblings.",
        },
        epic: {
          type: "string",
          description:
            'Epic this task belongs to (a short label, e.g. "auth-revamp").',
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Free-form tags for categorisation (e.g. ["bug", "frontend"]).',
        },
        phase: {
          type: "string",
          enum: ["plan", "implement", "review", "fix"],
          description:
            "Workflow phase to start this task in, if it's driven by the Code Workbench phase flow (Plan → Implement → Review → Fix). Root tasks created by a planning skill or workflow should set this — e.g. 'implement' once a plan is approved — so the Phase Board files it correctly.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "task_update",
    description:
      'Change a field on an existing task — typically `status` ("in-progress" when you start, "done" when finished) or `memo` (notes for future agents). Only the fields you pass are touched; everything else stays as-is. Always use this tool — never hand-edit .md files. Example: {"id":"a1b2c3d4","status":"in-progress","memo":"Reproduced via curl, fix is in middleware.ts"}.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID." },
        title: {
          type: "string",
          description: "New task title (replaces the existing title).",
        },
        description: {
          type: "string",
          description:
            "New description text (replaces the existing description).",
        },
        memo: {
          type: "string",
          description:
            "Free-form agent memo. Replaced each update. Use to log findings, blockers, or progress notes.",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "New priority.",
        },
        status: {
          type: "string",
          enum: ["open", "in-progress", "done"],
          description: "New status.",
        },
        phase: {
          type: "string",
          // "" is a legal value: the Review/Fix procedures clear the phase with
          // it, so it must pass schema validation, not just the handler.
          enum: ["plan", "implement", "review", "fix", ""],
          description:
            'Workflow phase this task is in (set by the Code Workbench phase flow — Plan → Implement → Review → Fix). Advance it when your phase\'s work is handed off to the next one. Pass an empty string to clear it.',
        },
        worktree: {
          type: "string",
          description:
            "Reassign (claim) the task to a worktree — pass its folder name; the value is normalized to its lowercased basename. Pass an empty string to unassign.",
        },
        parentId: {
          type: "string",
          description:
            "Set to a task ID to make this a subtask. Set to empty string to promote to top-level.",
        },
        parallel: {
          type: "boolean",
          description:
            "Toggle the parallel-execution flag. See task_create for semantics.",
        },
        order: {
          type: "number",
          description:
            "Set the sibling-group sort key. See task_create for semantics.",
        },
        epic: {
          type: "string",
          description: "Set or clear the epic (pass empty string to clear).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replace the full tags array.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "task_delete",
    description:
      'Permanently remove a task and all of its subtasks from the board. Use sparingly — prefer marking "done" so the history stays. Example: {"id":"a1b2c3d4"}.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "task_find_similar",
    description:
      'Search prior tasks for ones similar to the work you are about to do, ranked by BM25 over title + description + memo. Use this as task memory: before starting a non-trivial task, call this with the task title + description as `query` to surface how similar problems were handled before — including the memo notes left by past agents (blockers, file paths, decisions). Recommended workflow: (1) when you pick up a task, call task_find_similar with query="<title>. <description>", status="done", excludeId=<current task id>, limit=5; (2) read the matches and any relevant memos; (3) reuse the prior approach when applicable instead of redesigning from scratch. Also useful before creating a task to check for duplicates. Returns top-K matches with id, score, status, title, and first description line.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text query — typically the current task title and/or description.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return. Defaults to 5.",
        },
        status: {
          type: "string",
          enum: ["open", "in-progress", "done"],
          description:
            'Restrict the pool before ranking (e.g. "done" to find prior solutions).',
        },
        excludeId: {
          type: "string",
          description:
            "Task id (full or 8-char prefix) to exclude — usually the current task.",
        },
      },
      required: ["query"],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export async function handle(req) {
  const { method, params } = req;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "code-workbench-tasks", version: "0.1.0" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name) recordToolUse("cw-tasks", name);

      if (name === "task_list") {
        const { tasks: rawTasks, unreadable } =
          await readTasks(requireRepoKey());
        let tasks = sortTasks(rawTasks);
        if (args.status) tasks = tasks.filter((t) => t.status === args.status);
        // Scope to this worktree by default; an explicit `worktree` arg
        // overrides the spawn-time worktree. Unassigned tasks (the shared
        // backlog not yet claimed by any worktree) are always surfaced in the
        // default scope so cw-work can SEE — but, per its skill, not auto-start
        // — them. An explicit `worktree` arg is a deliberate narrowing, so it
        // returns exactly that worktree without the unassigned backlog.
        const explicitWorktree = args.worktree != null;
        const wantKey = explicitWorktree
          ? worktreeKey(args.worktree)
          : WORKTREE_KEY;
        if (wantKey) {
          // Subtasks carry no worktree of their own — scope them by the
          // worktree of their root ancestor.
          const byId = new Map(rawTasks.map((t) => [t.id, t]));
          const rootWorktree = (t) => {
            let cur = t;
            const seen = new Set();
            while (
              cur.parentId &&
              byId.has(cur.parentId) &&
              !seen.has(cur.id)
            ) {
              seen.add(cur.id);
              cur = byId.get(cur.parentId);
            }
            return cur.worktree;
          };
          tasks = tasks.filter((t) => {
            const k = worktreeKey(rootWorktree(t));
            if (k === wantKey) return true;
            // Include the unassigned backlog only in the default worktree
            // scope, never when a specific worktree was explicitly requested.
            return !explicitWorktree && k === "";
          });
        }
        // The renderer only descends from root tasks, so a subtask whose parent
        // didn't survive the status/worktree filters (or an orphan whose parent
        // is gone) can never render. Drop those before counting so they don't
        // inflate `total` or consume `limit` slots and skew the truncation
        // footer. Render-invariant — it only removes already-unrenderable tasks.
        // Loops to a fixed point so deeper broken chains are pruned too.
        for (let pruned = true; pruned; ) {
          const present = new Set(tasks.map((t) => t.id));
          const next = tasks.filter(
            (t) => !t.parentId || present.has(t.parentId),
          );
          pruned = next.length !== tasks.length;
          tasks = next;
        }
        const limit = Math.max(1, Math.min(1000, Number(args.limit) || 200));
        const total = tasks.length;
        const truncated = total > limit;
        if (truncated) tasks = tasks.slice(0, limit);
        const footer = [];
        if (truncated)
          footer.push(`(${total - limit} more — pass limit to expand)`);
        if (unreadable > 0)
          footer.push(
            `(${unreadable} task file(s) unreadable — see server logs or fix frontmatter)`,
          );
        // Group root tasks by epic, then render each group with a header.
        const rootTasks = tasks.filter((t) => !t.parentId);
        const childMap = new Map();
        for (const t of tasks) {
          if (t.parentId) {
            if (!childMap.has(t.parentId)) childMap.set(t.parentId, []);
            childMap.get(t.parentId).push(t);
          }
        }
        const epicOrder = [];
        const epicBuckets = new Map();
        for (const t of rootTasks) {
          const key = t.epic ?? "";
          if (!epicBuckets.has(key)) {
            epicBuckets.set(key, []);
            epicOrder.push(key);
          }
          epicBuckets.get(key).push(t);
        }
        const renderTask = (t, depth) => {
          const indent = depth > 0 ? "  ↳ " : "";
          // Mark root tasks with no worktree as [unassigned] so cw-work can
          // tell the shared backlog apart from its own queue. Subtasks inherit
          // their root's worktree and never own one, so they stay unmarked.
          const wt = t.worktree
            ? ` [${t.worktree}]`
            : depth === 0
              ? " [unassigned]"
              : "";
          const par = t.parallel ? " [∥]" : "";
          const orderLabel =
            depth > 0 && typeof t.order === "number" ? ` (#${t.order})` : "";
          const epicLabel = depth === 0 && t.epic ? ` {${t.epic}}` : "";
          const phaseLabel = depth === 0 && t.phase ? ` <${t.phase}>` : "";
          const tagsLabel =
            t.tags && t.tags.length ? " #" + t.tags.join(" #") : "";
          const desc = t.description
            ? "\n  " + t.description.split("\n")[0]
            : "";
          const memo = t.memo ? "\n  memo: " + t.memo.split("\n")[0] : "";
          const line = `${indent}[${t.id.slice(0, 8)}] [${t.priority}] [${t.status}]${par}${orderLabel}${wt}${epicLabel}${phaseLabel}${tagsLabel} ${t.title}${desc}${memo}`;
          const childLines = (childMap.get(t.id) ?? []).map((c) =>
            renderTask(c, depth + 1),
          );
          return [line, ...childLines].join("\n");
        };
        const lines = [];
        for (const epicKey of epicOrder) {
          if (epicKey) lines.push(`\n## Epic: ${epicKey}`);
          for (const t of epicBuckets.get(epicKey)) {
            lines.push(renderTask(t, 0));
          }
        }
        const body =
          lines.length === 0 ? "No tasks found." : lines.join("\n").trimStart();
        const text = footer.length ? `${body}\n${footer.join(" ")}` : body;
        return { content: [{ type: "text", text }] };
      }

      if (name === "task_create") {
        if (!args.title)
          return {
            content: [{ type: "text", text: "Error: title is required." }],
          };
        if (!REPO_PATH) {
          return {
            content: [
              {
                type: "text",
                text: "Error: repo path could not be resolved — set CODE_WORKBENCH_REPO_PATH or run from within a workspace directory.",
              },
            ],
          };
        }
        if (args.priority != null && !VALID_PRIORITIES.has(args.priority)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: invalid priority "${args.priority}". Use high, medium, or low.`,
              },
            ],
          };
        }
        const key = requireRepoKey();
        let parentId = null;
        if (args.parentId) {
          const resolvedParent = await resolveTaskId(key, args.parentId);
          if (!resolvedParent) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: parent task ${args.parentId} not found.`,
                },
              ],
            };
          }
          if (typeof resolvedParent === "object" && resolvedParent.ambiguous) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: parentId "${args.parentId}" is ambiguous, matches: ${resolvedParent.ambiguous.map((m) => m.slice(0, 8)).join(", ")}. Use a longer prefix.`,
                },
              ],
            };
          }
          parentId = resolvedParent;
        }
        // The store applies the "a subtask never owns a worktree" rule and
        // normalizes the worktree key — pass the raw worktree through.
        const task = await createTask(key, {
          title: String(args.title),
          description: String(args.description ?? ""),
          memo: String(args.memo ?? ""),
          priority: args.priority || "medium",
          status: "open",
          worktree: args.worktree ?? null,
          parentId,
          parallel: args.parallel === true,
          order: typeof args.order === "number" ? args.order : null,
          epic: args.epic || null,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          phase: args.phase && VALID_PHASES.has(args.phase) ? args.phase : null,
        });
        return {
          content: [
            {
              type: "text",
              text: `Task created: [${task.id.slice(0, 8)}] ${task.title}`,
            },
          ],
        };
      }

      if (name === "task_update") {
        if (!args.id)
          return {
            content: [{ type: "text", text: "Error: id is required." }],
          };
        if (args.priority != null && !VALID_PRIORITIES.has(args.priority)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: invalid priority "${args.priority}". Use high, medium, or low.`,
              },
            ],
          };
        }
        if (args.status != null && !VALID_STATUSES.has(args.status)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: invalid status "${args.status}". Use open, in-progress, or done.`,
              },
            ],
          };
        }
        if (
          args.phase != null &&
          args.phase !== "" &&
          !VALID_PHASES.has(args.phase)
        ) {
          return {
            content: [
              {
                type: "text",
                text: `Error: invalid phase "${args.phase}". Use plan, implement, review, or fix.`,
              },
            ],
          };
        }
        const key = requireRepoKey();
        // Resolve before locking: the mutex must key on the FULL id, otherwise
        // a caller using an 8-char prefix and one using the full id for the
        // same task take different locks and race the read-modify-write.
        const resolved = await resolveTaskId(key, args.id);
        if (!resolved)
          return {
            content: [
              { type: "text", text: `Error: task ${args.id} not found.` },
            ],
          };
        if (typeof resolved === "object" && resolved.ambiguous) {
          return {
            content: [
              {
                type: "text",
                text: `Error: id "${args.id}" is ambiguous, matches: ${resolved.ambiguous.map((m) => m.slice(0, 8)).join(", ")}. Use a longer prefix.`,
              },
            ],
          };
        }
        const fullId = resolved;
        return await withLock(`${key}:${fullId}`, async () => {
          const patch = {};
          if (args.title != null) patch.title = args.title;
          if (args.description != null) patch.description = args.description;
          if (args.memo != null) patch.memo = args.memo;
          if (args.priority != null) patch.priority = args.priority;
          if (args.status != null) patch.status = args.status;
          if (args.phase != null) patch.phase = args.phase === "" ? null : args.phase;
          if (args.worktree != null)
            patch.worktree =
              args.worktree === "" ? null : worktreeKey(args.worktree);
          if (args.parallel != null) patch.parallel = args.parallel === true;
          if (args.order != null)
            patch.order = typeof args.order === "number" ? args.order : null;
          if (args.epic != null)
            patch.epic = args.epic === "" ? null : args.epic;
          if (args.tags != null)
            patch.tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
          if (args.parentId != null) {
            if (args.parentId === "") {
              patch.parentId = null;
            } else {
              const resolvedParent = await resolveTaskId(key, args.parentId);
              if (!resolvedParent) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: parent task ${args.parentId} not found.`,
                    },
                  ],
                };
              }
              if (
                typeof resolvedParent === "object" &&
                resolvedParent.ambiguous
              ) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: parentId "${args.parentId}" is ambiguous, matches: ${resolvedParent.ambiguous.map((m) => m.slice(0, 8)).join(", ")}. Use a longer prefix.`,
                    },
                  ],
                };
              }
              const { tasks: allTasks } = await readTasks(key);
              if (wouldCycle(allTasks, fullId, resolvedParent)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Error: that parentId would create a cycle.",
                    },
                  ],
                };
              }
              patch.parentId = resolvedParent;
            }
          }
          // The store enforces the subtask worktree rule and writes the file.
          const updated = await updateTask(key, fullId, patch);
          if (!updated)
            return {
              content: [
                { type: "text", text: `Error: task ${args.id} not found.` },
              ],
            };
          return {
            content: [
              {
                type: "text",
                text: `Task updated: [${updated.id.slice(0, 8)}] ${updated.title} → status: ${updated.status}`,
              },
            ],
          };
        });
      }

      if (name === "task_delete") {
        if (!args.id)
          return {
            content: [{ type: "text", text: "Error: id is required." }],
          };
        const key = requireRepoKey();
        // Resolve before locking so the mutex keys on the full id (see
        // task_update above).
        const resolved = await resolveTaskId(key, args.id);
        if (!resolved)
          return {
            content: [
              { type: "text", text: `Error: task ${args.id} not found.` },
            ],
          };
        if (typeof resolved === "object" && resolved.ambiguous) {
          return {
            content: [
              {
                type: "text",
                text: `Error: id "${args.id}" is ambiguous, matches: ${resolved.ambiguous.map((m) => m.slice(0, 8)).join(", ")}. Use a longer prefix.`,
              },
            ],
          };
        }
        const fullId = resolved;
        return await withLock(`${key}:${fullId}`, async () => {
          // The store deletes the task and its whole subtree in one call.
          const removed = await deleteTask(key, fullId);
          if (removed.length === 0)
            return {
              content: [
                { type: "text", text: `Error: task ${args.id} not found.` },
              ],
            };
          const descendantCount = removed.length - 1;
          const shortId = fullId.slice(0, 8);
          const msg =
            descendantCount > 0
              ? `Task ${shortId} deleted (${descendantCount} descendant(s) removed).`
              : `Task ${shortId} deleted.`;
          return { content: [{ type: "text", text: msg }] };
        });
      }

      if (name === "task_find_similar") {
        if (!args.query || !String(args.query).trim()) {
          return {
            content: [{ type: "text", text: "Error: query is required." }],
          };
        }
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 5));
        let pool = (await readTasks(requireRepoKey())).tasks;
        if (args.status) pool = pool.filter((t) => t.status === args.status);
        if (args.excludeId) {
          const ex = String(args.excludeId);
          pool = pool.filter((t) => t.id !== ex && !t.id.startsWith(ex));
        }
        const docs = pool.map((t) => ({
          task: t,
          // Title tokens repeated 2× for a cheap title boost.
          tokens: [
            ...tokenize(t.title),
            ...tokenize(t.title),
            ...tokenize(t.description),
            ...tokenize(t.memo),
          ],
        }));
        const ranked = bm25Rank(docs, String(args.query)).slice(0, limit);
        if (ranked.length === 0) {
          return { content: [{ type: "text", text: "No matches." }] };
        }
        const text = ranked
          .map(({ task, score }) => {
            const firstLine = (task.description || "").split("\n")[0];
            const desc = firstLine ? ` — ${firstLine}` : "";
            return `[${task.id.slice(0, 8)}] score=${score.toFixed(2)} [${task.status}] ${task.title}${desc}`;
          })
          .join("\n");
        return { content: [{ type: "text", text }] };
      }

      return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    default:
      return {
        _error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
