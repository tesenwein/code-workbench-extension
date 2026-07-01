// ESM re-export shim for repo-key.cjs — the single repo → task-bucket mapping.
// The implementation is CommonJS so CJS consumers (the VS Code extension and
// the Electron main process, both compiled to CJS) can `require` it; this file
// lets the spawned `.mjs` MCP servers import it unchanged. One implementation.
// Keep this file plain ESM with no non-builtin imports.

export { buildRepoKey, repoNameFromCommonDir } from "./repo-key.cjs";
