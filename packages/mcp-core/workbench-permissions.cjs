// Canonical MCP permission allowlist for Code Workbench's own tools. This is
// the single source of truth for which `mcp__cw-code__*` tool calls are safe
// to auto-approve — the task board, architecture wiki, code search, scan and
// notification tools the phase flow and skills fire constantly, none of them
// destructive on their own. `task_delete` and `arch_delete` are deliberately
// excluded: deletion is destructive, so both stay gated.
//
// workbench-permissions.mjs re-exports this for ESM consumers — one list.

"use strict";

const WORKBENCH_PERMISSIONS = [
  // tasks
  "mcp__cw-code__task_list",
  "mcp__cw-code__task_create",
  "mcp__cw-code__task_update",
  "mcp__cw-code__task_find_similar",
  // architecture wiki
  "mcp__cw-code__arch_list",
  "mcp__cw-code__arch_get",
  "mcp__cw-code__arch_search",
  "mcp__cw-code__arch_upsert",
  "mcp__cw-code__arch_audit",
  // code intelligence
  "mcp__cw-code__search_code",
  "mcp__cw-code__ast_query",
  "mcp__cw-code__get_file_outline",
  "mcp__cw-code__get_symbol_source",
  "mcp__cw-code__find_duplicates",
  "mcp__cw-code__detect_dead_code",
  "mcp__cw-code__detect_type_escapes",
  // scan acknowledgements and exclusions
  "mcp__cw-code__acknowledge_duplicate",
  "mcp__cw-code__acknowledge_dead_code",
  "mcp__cw-code__acknowledge_type_escape",
  "mcp__cw-code__exclude_directory",
  "mcp__cw-code__exclude_dead_code_dir",
  "mcp__cw-code__exclude_type_escape_dir",
  // notifications
  "mcp__cw-code__notify_chat_title",
  "mcp__cw-code__notify_done",
  "mcp__cw-code__notify_info",
  "mcp__cw-code__notify_needs_input",
];

module.exports = { WORKBENCH_PERMISSIONS };
