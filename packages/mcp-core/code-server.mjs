#!/usr/bin/env node
/**
 * code-workbench  —  unified MCP server.
 *
 * Aggregates every workbench MCP tool behind a SINGLE stdio endpoint (`cw-code`)
 * instead of spawning one `node <file>` process per concern. The individual
 * server modules (notify / tasks / arch / ast / dead-code / type-safety) each
 * export their `TOOLS` array and a `handle(req)` dispatcher; this entry merges
 * the tool lists and routes every `tools/call` to the module that owns the named
 * tool. Each sub-handler still calls recordToolUse() with its own key, so usage
 * logging is unchanged.
 *
 * Per-session context is passed exactly as before — the launcher sets the union
 * of env vars (notify port/session/token, repo path/key, worktree, AST roots) on
 * this one process, and each module reads the ones it cares about at import time.
 * Tools whose context is absent degrade gracefully (e.g. notify_* drop silently
 * when no port is set), so the same binary works for sessions launched outside
 * the workbench too.
 */

import { startStdioServer } from "./stdio-server.mjs";
import * as notify from "./notify-server.mjs";
import * as tasks from "./tasks-server.mjs";
import * as arch from "./arch-server.mjs";
import * as ast from "./ast-server.mjs";
import * as deadCode from "./dead-code-server.mjs";
import * as typeSafety from "./type-safety-server.mjs";

const MODULES = [
  { group: "notify", mod: notify },
  { group: "tasks", mod: tasks },
  { group: "arch", mod: arch },
  { group: "ast", mod: ast },
  { group: "dead-code", mod: deadCode },
  { group: "type-safety", mod: typeSafety },
];

// Optional opt-out: a comma-separated list of group names (the keys above) the
// launcher wants suppressed — used by the VS Code extension's per-feature
// toggles. Absent/empty means every group is exposed.
const DISABLED_GROUPS = new Set(
  (process.env.CODE_WORKBENCH_DISABLED_GROUPS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean),
);

// Merge tool lists and build a name -> owning-module-handle routing table. Tool
// names are unique across servers; first writer wins if that ever changes.
const TOOLS = [];
const HANDLER_BY_TOOL = new Map();
for (const { group, mod } of MODULES) {
  if (DISABLED_GROUPS.has(group)) continue;
  for (const tool of mod.TOOLS ?? []) {
    if (HANDLER_BY_TOOL.has(tool.name)) continue;
    HANDLER_BY_TOOL.set(tool.name, mod.handle);
    TOOLS.push(tool);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req) {
  const { method, params } = req;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "code-workbench", version: "1.0.0" },
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const name = params?.name;
      const owner = name ? HANDLER_BY_TOOL.get(name) : undefined;
      if (!owner) {
        return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      // Delegate to the owning module's dispatcher. It performs its own
      // recordToolUse + argument validation and returns the MCP content/_error
      // shape, which stdio-server forwards verbatim.
      return owner(req);
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return {};

    default:
      return {
        _error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

startStdioServer(handle, send);
