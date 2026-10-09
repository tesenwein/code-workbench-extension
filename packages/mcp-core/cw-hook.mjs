// Claude Code hook entry for Code Workbench sessions.
//
//   node cw-hook.mjs --event <PreToolUse|Stop|SessionStart> \
//     --repo-key K --worktree P [--task-id ID] [--phase PHASE]
//
// Enforces the board rules deterministically (an edit needs an in-progress
// task; a phase session may not stop without handing off or noting a blocker)
// so they need not be spelled out in prompt text. Reads the hook payload as
// JSON on stdin and answers with the JSON the hooks contract expects. Every
// failure path ALLOWS: a broken hook must never wedge a session.
//
// Context comes from argv, not env — hooks run in the Claude CLI's own
// environment, which does not carry the MCP server's CODE_WORKBENCH_* vars.

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCliEntry } from "./cli-entry.mjs";
import { listTasks } from "./task-store.mjs";
import { worktreeKey } from "./task-format.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Board files and the session scratchpad are never "work on a task".
// The scratchpad lives under a `claude-<uid>` temp root, so repo source that
// merely has a `scratchpad/` directory is still guarded.
const SCRATCHPAD_PATH = /[\\/]claude-[^\\/]+[\\/](?:.+[\\/])?scratchpad[\\/]/;
// A blocker note must be explicit — "code block"/"unblocked" must not match.
const BLOCKED_NOTE = /^\s*blocked:/im;

function isAlwaysAllowed(filePath, worktree) {
  if (!filePath) return false;
  const p = path.resolve(String(filePath));
  const under = (root) => p.startsWith(path.resolve(root) + path.sep);
  if (worktree && under(path.join(worktree, ".code-workbench"))) return true;
  if (under(path.join(os.homedir(), ".code-workbench"))) return true;
  return SCRATCHPAD_PATH.test(p);
}

const deny = (reason) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});

/** PreToolUse: block file edits while no task is in-progress for this session. */
export function decidePreToolUse(payload, tasks, ctx) {
  if (!EDIT_TOOLS.has(payload?.tool_name)) return null;
  const filePath = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? "";
  if (isAlwaysAllowed(filePath, ctx.worktree)) return null;

  if (ctx.taskId) {
    const bound = tasks.find((t) => t.id === ctx.taskId);
    // A deleted bound task cannot be fixed by the agent — don't trap it.
    if (!bound || bound.status === "in-progress") return null;
    return deny(
      `Task ${ctx.taskId.slice(0, 8)} is not in-progress. Call task_update (status: "in-progress") before editing files.`,
    );
  }
  const wt = worktreeKey(ctx.worktree);
  const active = tasks.some(
    (t) =>
      t.status === "in-progress" &&
      (!worktreeKey(t.worktree) || worktreeKey(t.worktree) === wt),
  );
  if (active) return null;
  return deny(
    "No task is in-progress. Call task_list, then task_create (or task_update status: \"in-progress\" on the matching task) before editing files.",
  );
}

/** Stop: a phase-bound session must hand off, or record why it is blocked. */
export function decideStop(payload, tasks, ctx) {
  // Already continued once because of this hook — never loop.
  if (payload?.stop_hook_active) return null;
  if (!ctx.taskId) return null;
  const task = tasks.find((t) => t.id === ctx.taskId);
  // A phase handoff resets status to open; done means the flow finished.
  if (!task || task.status !== "in-progress") return null;
  if (BLOCKED_NOTE.test(task.memo ?? "")) return null;
  return {
    decision: "block",
    reason:
      `Task ${ctx.taskId.slice(0, 8)} is still in-progress and this phase has not been handed off. ` +
      "Finish the phase and hand off by setting `phase` as instructed (never past the next phase). " +
      'If you cannot finish, write what blocks you into the task memo via task_update (memo: "blocked: ...") and leave `phase` unchanged, then stop.',
  };
}

/** SessionStart: remind a phase-bound session which task it owns. */
export function decideSessionStart(payload, tasks, ctx) {
  if (!ctx.taskId) return null;
  const task = tasks.find((t) => t.id === ctx.taskId);
  if (!task) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `This session is bound to board task ${task.id} ("${task.title}"${ctx.phase ? `, ${ctx.phase} phase` : ""}). Work only on that task.`,
    },
  };
}

const DECIDERS = {
  PreToolUse: decidePreToolUse,
  Stop: decideStop,
  SessionStart: decideSessionStart,
  // Activity-only events: they never decide anything.
  PostToolUse: () => null,
  Notification: () => null,
  UserPromptSubmit: () => null,
};

/** Live-state report for the Sessions view, or null if the event carries none.
 *  Stop and Notification mean the agent is idle / waiting on the user. */
export function activityFor(event, payload) {
  switch (event) {
    case "PreToolUse":
    case "PostToolUse":
      return { state: "running", tool: String(payload?.tool_name ?? "") };
    case "UserPromptSubmit":
      return { state: "running", tool: "" };
    case "Notification":
      return { state: "waiting", tool: "" };
    case "Stop":
      return { state: "idle", tool: "" };
    default:
      return null;
  }
}

/** Fire-and-forget one JSON line at the workbench notify server. The port is
 *  re-read from the port file so a workbench restart doesn't strand the hook. */
function sendActivity(args, activity) {
  return new Promise((resolve) => {
    try {
      const port = Number(fs.readFileSync(args["notify-port-file"], "utf8").trim());
      if (!port || !args.session) return resolve();
      const sock = net.createConnection({ port, host: "127.0.0.1" }, () => {
        sock.end(
          JSON.stringify({
            type: "activity",
            sessionId: args.session,
            taskId: args["task-id"] || undefined,
            ...activity,
            ts: Date.now(),
          }) + "\n",
        );
      });
      sock.on("error", () => resolve());
      sock.on("close", () => resolve());
      sock.setTimeout(500, () => {
        sock.destroy();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/** Parse `--key value` pairs. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const decide = DECIDERS[args.event];
  if (!decide || !args["repo-key"]) return;
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const activity = activityFor(args.event, payload);
  if (activity && args["notify-port-file"]) await sendActivity(args, activity);
  // Only the deciders that read the board pay for a full store read.
  const needsTasks =
    args.event === "Stop" ||
    args.event === "SessionStart" ||
    (args.event === "PreToolUse" && EDIT_TOOLS.has(payload?.tool_name));
  if (!needsTasks) return;
  const tasks = await listTasks(args["repo-key"]);
  const result = decide(payload, tasks, {
    taskId: args["task-id"] || "",
    phase: args.phase || "",
    worktree: args.worktree || "",
  });
  if (result) process.stdout.write(JSON.stringify(result) + "\n");
}

if (isCliEntry(import.meta.url, "cw-hook.mjs")) {
  main().catch(() => {
    /* fail open */
  });
}
