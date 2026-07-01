// Shared bundled-skill definitions, used by the Electron app and the VS Code
// extension. The implementation lives in `skills.cjs` so CommonJS consumers can
// `require` it; this `.mjs` is a thin re-export shim for ESM consumers.

export { BUNDLED_SKILLS, LEGACY_SKILL_NAMES } from "./skills.cjs";
