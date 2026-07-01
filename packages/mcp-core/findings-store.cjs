"use strict";

// Persisted scan findings for dead-code and duplicate-detection.
//
// The host UI (Electron app or VS Code extension) runs scans and writes the
// raw, unfiltered result here. MCP tools read this file and apply current
// acks at read time, so toggling an ack does not invalidate the findings.
//
// Layout (mirrors scan-state):
//   <repo>/.code-workbench/dead-code-findings.json
//   <repo>/.code-workbench/duplicates-findings.json

const { promises: fsp } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;

/** @param {'dead-code'|'duplicates'} feature */
function findingsFilePath(repoPath, feature) {
  return path.join(repoPath, ".code-workbench", `${feature}-findings.json`);
}

/**
 * Read persisted findings for a feature. Returns null when the file is
 * missing or malformed. Schema-mismatched files also return null so callers
 * treat them as "no scan yet".
 *
 * @param {string} repoPath
 * @param {'dead-code'|'duplicates'} feature
 * @returns {Promise<{ schemaVersion: number; generatedAt: number; root: string; items?: unknown[]; groups?: unknown[] } | null>}
 */
async function readFindings(repoPath, feature) {
  try {
    const raw = await fsp.readFile(findingsFilePath(repoPath, feature), "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      typeof parsed.generatedAt !== "number" ||
      typeof parsed.root !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write findings atomically (tmp + rename). `payload` must contain either
 * `items` (dead-code) or `groups` (duplicates) plus `root`. `schemaVersion`
 * and `generatedAt` are filled in by this function.
 *
 * @param {string} repoPath
 * @param {'dead-code'|'duplicates'} feature
 * @param {{ root: string; items?: unknown[]; groups?: unknown[] }} payload
 */
async function writeFindings(repoPath, feature, payload) {
  const file = findingsFilePath(repoPath, feature);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const body = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: Date.now(),
    root: payload.root,
  };
  if (payload.items !== undefined) body.items = payload.items;
  if (payload.groups !== undefined) body.groups = payload.groups;
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(body, null, 2));
  await fsp.rename(tmp, file);
}

module.exports = {
  SCHEMA_VERSION,
  findingsFilePath,
  readFindings,
  writeFindings,
};
