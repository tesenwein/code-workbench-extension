// Shared bundled-workflow definitions, used by the Electron app and the VS
// Code extension. The implementation lives in `workflows.cjs` so CommonJS
// consumers can `require` it; this `.mjs` is a thin re-export shim for ESM
// consumers.

export { BUNDLED_WORKFLOWS } from "./workflows.cjs";
