// ESM re-export shim for task-store.cjs — the single task-file CRUD module.
// The implementation is CommonJS so CJS consumers can `require` it; this file
// lets the spawned `.mjs` MCP servers import it unchanged. One implementation.

export {
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
} from "./task-store.cjs";
