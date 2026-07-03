// Shared CLI-entrypoint guard for the detector .mjs scripts.
//
// A detector must only run its CLI block when the file itself is the spawned
// entrypoint. Two subtleties make the naive `import.meta.url` comparison wrong:
// - pnpm installs via symlinks, so the spawned argv[1] path differs from
//   node's canonicalised import.meta.url — realpathSync resolves that.
// - When a detector is bundled into another script (e.g. ast-server),
//   import.meta.url resolves to the bundle's URL and would falsely match —
//   the basename check prevents stray stdout writes that corrupt the MCP
//   stdio protocol.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * True when the module whose `import.meta.url` is given is the process's
 * actual CLI entrypoint.
 *
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @param {string} filename the caller's expected basename, e.g. "code-search.mjs"
 * @returns {boolean}
 */
export function isCliEntry(importMetaUrl, filename) {
  const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
  return (
    Boolean(entry) &&
    path.basename(entry) === filename &&
    pathToFileURL(entry).href === importMetaUrl
  );
}
