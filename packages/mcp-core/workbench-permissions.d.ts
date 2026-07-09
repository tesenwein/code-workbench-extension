/**
 * `permissions.allow` entries for Code Workbench's own `mcp__cw-code__*` tools
 * that are safe to auto-approve — read/write task-board calls the phase flow
 * fires constantly. Destructive or rarely-direct tools (`task_delete`,
 * `task_find_similar`) are deliberately excluded.
 */
export const WORKBENCH_PERMISSIONS: string[];
