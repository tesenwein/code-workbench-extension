// Source-file discovery: recursive directory walk with skip rules.
//
// Kept dependency-free on purpose. The clone detector and code search both
// need to walk a repo, but clone detection must not transitively pull in the
// optional semantic-search ML stack (@xenova/transformers / onnxruntime).
// Anything that walks files imports from here, not from code-search.mjs.

import fsPromises from "node:fs/promises";
import path from "node:path";
import { EXT_TO_LANG } from "./ast-core.mjs";

export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "cdist",
  ".next",
  "out",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
  "vendor",
  "generated",
  "gen",
  "stubs",
]);

// File suffixes that indicate generated/compiled output — skip regardless of directory.
const SKIP_SUFFIXES = [
  ".d.ts",
  ".min.js",
  ".min.mjs",
  ".bundle.js",
  ".g.ts",
  ".generated.ts",
];

export const MAX_FILE_BYTES = 512 * 1024; // 512 KB
export const SUPPORTED_EXTS = new Set(Object.keys(EXT_TO_LANG));

const MAX_WALK_DEPTH = 40;

export async function* walkFiles(root, extraSkipDirs, _visited, _depth) {
  const skip =
    extraSkipDirs && extraSkipDirs.length
      ? new Set([...SKIP_DIRS, ...extraSkipDirs])
      : SKIP_DIRS;
  // Shared visited set tracks real (resolved) paths to detect symlink cycles.
  const visited = _visited ?? new Set();
  const depth = _depth ?? 0;
  if (depth > MAX_WALK_DEPTH) return;

  let realRoot;
  try {
    realRoot = await fsPromises.realpath(root);
  } catch {
    return;
  }
  if (visited.has(realRoot)) return;
  visited.add(realRoot);

  let entries;
  try {
    entries = await fsPromises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const fullPath = path.join(root, e.name);
    if (e.isSymbolicLink()) {
      // Resolve symlink and only follow if it points to a directory not yet visited.
      let real;
      try {
        real = await fsPromises.realpath(fullPath);
      } catch {
        continue;
      }
      if (visited.has(real)) continue;
      let stat;
      try {
        stat = await fsPromises.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!skip.has(e.name))
          yield* walkFiles(fullPath, extraSkipDirs, visited, depth + 1);
      } else if (stat.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        if (SKIP_SUFFIXES.some((s) => e.name.endsWith(s))) continue;
        yield fullPath;
      }
    } else if (e.isDirectory()) {
      if (!skip.has(e.name))
        yield* walkFiles(fullPath, extraSkipDirs, visited, depth + 1);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) continue;
      if (SKIP_SUFFIXES.some((s) => e.name.endsWith(s))) continue;
      yield fullPath;
    }
  }
}
