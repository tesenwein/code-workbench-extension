"use strict";

// Shared ack/exclude state for dead-code, duplicate-detection, and
// type-escape scans. Each feature stores JSON arrays in <repoPath>/.code-workbench/:
//   dead-code    → dead-code-ack.json    / dead-code-exclude.json
//   duplicates   → duplicates-ack.json   / duplicates-exclude.json
//   type-escapes → type-escapes-ack.json / type-escapes-exclude.json
//
// Consumed by the Electron app's main process and the VS Code extension via
// scan-state.mjs (ESM shim). One implementation, no duplication.

const { promises: fsp } = require("node:fs");
const path = require("node:path");

/** @param {'dead-code'|'duplicates'|'type-escapes'} feature */
function ackFilePath(repoPath, feature) {
  return path.join(repoPath, ".code-workbench", `${feature}-ack.json`);
}

/** @param {'dead-code'|'duplicates'|'type-escapes'} feature */
function excludeFilePath(repoPath, feature) {
  return path.join(repoPath, ".code-workbench", `${feature}-exclude.json`);
}

async function readJsonArray(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray(file, items) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // tmp + rename: an interrupted write must not truncate the file — a torn
  // ack list silently parses as [] and un-hides every acknowledged finding.
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(items, null, 2));
  await fsp.rename(tmp, file);
}

/** Read acknowledged fingerprints for a feature. */
function readAcks(repoPath, feature) {
  return readJsonArray(ackFilePath(repoPath, feature));
}

/** Persist acknowledged fingerprints for a feature. */
function writeAcks(repoPath, feature, fingerprints) {
  return writeJsonArray(ackFilePath(repoPath, feature), fingerprints);
}

/** Read excluded directory names for a feature. */
function readExcludeDirs(repoPath, feature) {
  return readJsonArray(excludeFilePath(repoPath, feature));
}

/** Persist excluded directory names for a feature. */
function writeExcludeDirs(repoPath, feature, dirs) {
  return writeJsonArray(excludeFilePath(repoPath, feature), dirs);
}

module.exports = {
  ackFilePath,
  excludeFilePath,
  readAcks,
  writeAcks,
  readExcludeDirs,
  writeExcludeDirs,
};
