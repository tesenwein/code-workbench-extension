/**
 * Canonical list of MCP server entries shipped by mcp-core.
 *
 * Each entry maps a stable MCP key (used in .claude.json / MCP config) to
 * the filename that is resolved at runtime (app: from node_modules or
 * Resources; extension: from dist/mcp-server/).
 *
 * `static` servers need no per-session context (no port, no repo path injected
 * by the launcher) and can be registered once in .claude.json. Dynamic servers
 * (notify, tasks, arch) receive per-session env vars from the app/extension
 * launcher and must be wired separately.
 */

export const MCP_SERVER_FILES = {
  notify: "notify-server.mjs",
  tasks: "tasks-server.mjs",
  arch: "arch-server.mjs",
  ast: "ast-server.mjs",
  "dead-code": "dead-code-server.mjs",
  "type-safety": "type-safety-server.mjs",
  // Unified aggregator — exposes every tool above behind one stdio endpoint.
  code: "code-server.mjs",
};

/**
 * The single endpoint registered into a `.claude.json`. The unified `cw-code`
 * server bundles all tools; analysis tools (ast/dead-code/type-safety/arch) work
 * with just CODE_WORKBENCH_REPO_PATH, and the rest degrade gracefully when their
 * per-session context is absent.
 */
export const STATIC_MCP_SERVERS = [
  { key: "cw-code", file: MCP_SERVER_FILES.code },
];
