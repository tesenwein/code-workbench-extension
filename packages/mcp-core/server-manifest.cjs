"use strict";

const MCP_SERVER_FILES = {
  notify: "notify-server.mjs",
  tasks: "tasks-server.mjs",
  arch: "arch-server.mjs",
  ast: "ast-server.mjs",
  "dead-code": "dead-code-server.mjs",
  "type-safety": "type-safety-server.mjs",
  // Unified aggregator — exposes every tool above behind one stdio endpoint.
  code: "code-server.mjs",
};

// The single endpoint registered into a `.claude.json`. See the .mjs twin.
const STATIC_MCP_SERVERS = [{ key: "cw-code", file: MCP_SERVER_FILES.code }];

module.exports = { MCP_SERVER_FILES, STATIC_MCP_SERVERS };
