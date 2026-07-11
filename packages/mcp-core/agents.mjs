// Shared bundled-agent definitions, used by the Electron app and the VS Code
// extension. The implementation lives in `agents.cjs` so CommonJS consumers can
// `require` it; this `.mjs` is a thin re-export shim for ESM consumers.

export { BUNDLED_AGENTS, LEGACY_AGENT_NAMES } from "./agents.cjs";
