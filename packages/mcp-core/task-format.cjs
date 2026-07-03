// Shared task file (de)serialization — the CommonJS implementation. Consumed
// by task-store.cjs and, via the `require` export condition, by CJS callers.
// The `.mjs` file is a thin re-export shim; keep behaviour identical.

"use strict";

// Stable, platform-independent worktree identifier. The same logical worktree
// gets a different absolute path on Windows vs Mac, and those paths get
// committed into task .md files. Collapsing to the last path segment keeps
// equality checks working across a cross-machine git sync.
function worktreeKey(p) {
  if (p == null) return "";
  const s = String(p).replace(/[\\/]+$/, "");
  if (!s) return "";
  const parts = s.split(/[\\/]/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

// Agents creating tasks via the MCP sometimes emit HTML entities in the title
// (e.g. `&amp;` for `&`), which then render literally in the task board. Decode
// the common entities so stored titles hold the real character. `&amp;` is
// decoded last so an already-encoded `&amp;lt;` doesn't collapse in one pass.
function decodeEntities(s) {
  if (s == null || s.indexOf("&") === -1) return s;
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const STATUS_ORDER = { open: 0, "in-progress": 1, done: 2 };
const VALID_PRIORITIES = ["high", "medium", "low"];
const VALID_STATUSES = ["open", "in-progress", "done"];

function serializeTask(task) {
  const safeTitle = decodeEntities(String(task.title))
    .replace(/\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const tagsVal =
    task.tags && task.tags.length > 0
      ? task.tags
          .map(
            (tag) =>
              '"' +
              String(tag).replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
              '"',
          )
          .join(",")
      : "";
  const lines = [
    "---",
    `id: ${task.id}`,
    `title: "${safeTitle}"`,
    `priority: ${task.priority}`,
    `status: ${task.status}`,
    `worktree: ${task.worktree ?? "null"}`,
    `parentId: ${task.parentId ?? "null"}`,
    `parallel: ${task.parallel ? "true" : "false"}`,
    `dueDate: ${task.dueDate ?? "null"}`,
    `epic: ${task.epic ?? "null"}`,
    `tags: ${tagsVal}`,
    `created: ${task.created}`,
    `updated: ${task.updated}`,
    "---",
    "",
    task.description ?? "",
  ];
  if (task.memo) {
    lines.push("", "<!-- memo -->", task.memo);
  }
  return lines.join("\n");
}

// Frontmatter field matchers, compiled once per field name and reused. Parsing
// a large board otherwise recompiled the same ~12 regexes for every file
// (hundreds of files × a dozen fields = thousands of needless RegExp compiles
// per list).
const FIELD_REGEX = new Map();
function fieldRegex(key) {
  let re = FIELD_REGEX.get(key);
  if (!re) {
    re = new RegExp(`^${key}:[ \t]*(.*)$`, "m");
    FIELD_REGEX.set(key, re);
  }
  return re;
}

function parseTask(raw) {
  // Split on CRLF or LF. Task files are plain `.md` files the user may sync
  // through git; on Windows that rewrites LF→CRLF, which would otherwise leave
  // `lines[0]` as `'---\r'` and make every such file fail to parse.
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) return null;
  const front = lines.slice(1, closingIdx).join("\n");
  const description = lines
    .slice(closingIdx + 1)
    .join("\n")
    .trimStart();
  const get = (key) => {
    const m = front.match(fieldRegex(key));
    const result = m ? m[1].trim() : "";
    return result;
  };
  const id = get("id");
  const rawTitle = get("title");
  const title = decodeEntities(
    rawTitle.startsWith('"') && rawTitle.endsWith('"')
      ? rawTitle.slice(1, -1).replace(/\\(.)/g, "$1")
      : rawTitle,
  );
  if (!id || !title) return null;
  const rawPriority = get("priority");
  const rawStatus = get("status");
  const priority = VALID_PRIORITIES.includes(rawPriority)
    ? rawPriority
    : "medium";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "open";
  const rawWorktree = get("worktree");
  const rawParentId = get("parentId");
  const rawParallel = get("parallel");
  const rawDueDate = get("dueDate");
  const rawEpic = get("epic");
  const rawTags = get("tags");
  const MEMO_SENTINEL = "\n<!-- memo -->\n";
  // Prepend a newline so the sentinel also matches when the description is
  // empty (trimStart left the marker at index 0) — otherwise the memo would
  // bleed into the description and be lost on the next round-trip.
  const padded = "\n" + description;
  const memoIdx = padded.lastIndexOf(MEMO_SENTINEL);
  const descriptionBody =
    memoIdx >= 0 ? padded.slice(1, memoIdx).trimEnd() : description.trimEnd();
  const memo =
    memoIdx >= 0 ? padded.slice(memoIdx + MEMO_SENTINEL.length) : "";
  const tags = (() => {
    if (!rawTags || rawTags === "null") return [];
    const result = [];
    const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
    let m;
    while ((m = re.exec(rawTags)) !== null) {
      const val =
        m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2].trim();
      if (val) result.push(val);
    }
    return result;
  })();
  return {
    id,
    title,
    priority,
    status,
    worktree: rawWorktree === "null" || !rawWorktree ? null : rawWorktree,
    parentId: rawParentId === "null" || !rawParentId ? null : rawParentId,
    parallel: rawParallel === "true",
    dueDate:
      rawDueDate === "null" || !/^\d{4}-\d{2}-\d{2}$/.test(rawDueDate)
        ? null
        : rawDueDate,
    epic: rawEpic === "null" || !rawEpic ? null : rawEpic,
    tags,
    description: descriptionBody,
    memo,
    created: get("created") || new Date().toISOString(),
    updated: get("updated") || new Date().toISOString(),
  };
}

function taskCmp(a, b) {
  const pd =
    (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
  if (pd !== 0) return pd;
  const sd = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
  if (sd !== 0) return sd;
  return a.created.localeCompare(b.created);
}

function sortTasks(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parentId);
  const childMap = new Map();
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      if (!childMap.has(t.parentId)) childMap.set(t.parentId, []);
      childMap.get(t.parentId).push(t);
    }
  }
  roots.sort(taskCmp);
  const result = [];
  for (const r of roots) {
    result.push(r);
    const children = childMap.get(r.id) ?? [];
    children.sort(taskCmp);
    result.push(...children);
  }
  // orphaned subtasks (parent deleted) appended at end
  for (const t of tasks) {
    if (t.parentId && !ids.has(t.parentId)) result.push(t);
  }
  return result;
}

module.exports = {
  worktreeKey,
  PRIORITY_ORDER,
  STATUS_ORDER,
  VALID_PRIORITIES,
  VALID_STATUSES,
  serializeTask,
  parseTask,
  sortTasks,
};
