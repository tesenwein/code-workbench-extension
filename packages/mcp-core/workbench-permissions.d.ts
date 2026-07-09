/**
 * `permissions.allow` entries for Code Workbench's own `mcp__cw-code__*` tools
 * that are safe to auto-approve — task board, architecture wiki, code search,
 * scan and notification calls the phase flow fires constantly. Destructive
 * tools (`task_delete`, `arch_delete`) are deliberately excluded.
 */
export const WORKBENCH_PERMISSIONS: string[];
