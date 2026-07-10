// Shared task file (de)serialization, used by the Electron app, the VS Code
// extension, and the standalone MCP tasks server.
//
// The implementation lives in `task-format.cjs` so CommonJS consumers can
// `require` it; this `.mjs` is a thin re-export shim for ESM consumers (the
// spawned `.mjs` MCP servers). There is exactly ONE implementation.

export {
  worktreeKey,
  PRIORITY_ORDER,
  STATUS_ORDER,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_PHASES,
  serializeTask,
  parseTask,
  sortTasks,
  siblingCmp,
} from "./task-format.cjs";
