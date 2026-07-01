// Task file handling for the extension is delegated entirely to the shared
// @code-workbench/mcp-core task-store. The Electron app, this extension, and
// the MCP tasks server therefore all read and write task files through one
// implementation and can never disagree on the on-disk layout, the subtask
// rules, or the cascade semantics.

export {
  tasksDir,
  taskFilePath,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  clearTaskWorktree,
} from '@code-workbench/mcp-core/task-store';

// `.code-workbench` directory layout constants. Not task-file handling —
// used by workspace init and global prefs — so they stay local to the
// extension rather than living in the shared task-store.
export const DOT_DIR = '.code-workbench';
export const LOCAL_SUBDIR = 'local';
