// Canonical MCP permission allowlist for Code Workbench's own tools. This is
// the single source of truth for which `mcp__cw-code__*` tool calls are safe
// to auto-approve — read/write task-board calls the phase flow and skills
// fire constantly, none of them destructive on their own. `task_delete` and
// `task_find_similar` are deliberately excluded: deletion is destructive and
// find_similar is rarely invoked directly by the user, so both stay gated.
//
// workbench-permissions.mjs re-exports this for ESM consumers — one list.

"use strict";

const WORKBENCH_PERMISSIONS = [
  "mcp__cw-code__task_list",
  "mcp__cw-code__task_create",
  "mcp__cw-code__task_update",
];

module.exports = { WORKBENCH_PERMISSIONS };
