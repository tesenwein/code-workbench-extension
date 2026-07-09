// Bundled Claude Workbench workflow scripts, shared by the Electron app and
// the VS Code extension. ONE source of truth — each consumer writes these
// out to disk (e.g. globalStorage) and invokes them via the Workflow tool's
// scriptPath.
//
// CommonJS implementation so synced consumers can `require` it; `workflows.mjs`
// is a thin ESM re-export shim.
//
// Each workflow lives in its own file under `./workflows/`; this module is
// just the index that assembles them. To add a workflow: create
// `./workflows/<name>.cjs` exporting `{ name, script }` and add it below.

"use strict";

const CODE_REVIEW = require("./workflows/code-review.cjs");

/** Every workflow the workbench bundles. */
const BUNDLED_WORKFLOWS = [CODE_REVIEW];

module.exports = { BUNDLED_WORKFLOWS };
