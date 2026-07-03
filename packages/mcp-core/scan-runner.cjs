"use strict";

// Shared scan execution for dead-code and duplicate detection.
//
// Spawns the detector .mjs scripts (dead-code-detect.mjs / clone-detect.mjs)
// via caller-supplied nodeBin + scriptPath, parses + validates stdout, and
// returns typed result arrays. Host-specific path/binary resolution stays with
// the caller (Electron app or VS Code extension).
//
// Also exports groupFingerprint, previously duplicated in
// app/main/duplicates.ts and ast-server.mjs.

const { execFile, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { writeFindings } = require("./findings-store.cjs");

/**
 * Stable SHA-1 fingerprint for a duplicate clone group, used for ack persistence.
 *
 * Identity is content-based: a group is hashed from its members' normalized-token
 * hashes (`normHash`), not their line positions, so an acknowledgement survives
 * edits made elsewhere in the file. Hashes are deduplicated, so adding another
 * identical copy to an exact/renamed group does not invalidate the ack.
 *
 * Legacy callers that pass members without `normHash` fall back to `file:name`,
 * with paths normalized to forward slashes so the fingerprint is platform-
 * independent (a WSL repo scanned from the desktop pane vs. the cw-ast MCP).
 *
 * @param {{ cloneType: string; members: Array<{ file: string; name: string; startLine: number; normHash?: string }> }} group
 * @returns {string}
 */
function groupFingerprint(group) {
  const ids = group.members.map((m) =>
    m.normHash
      ? `h:${m.normHash}`
      : `p:${String(m.file).replace(/\\/g, "/")}:${m.name}`,
  );
  const key = group.cloneType + ":" + [...new Set(ids)].sort().join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/**
 * @param {string} nodeBin
 * @param {string[]} cliArgs
 * @param {string} label
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<unknown[]>}
 */
function spawnDetector(nodeBin, cliArgs, label, env) {
  return new Promise((resolve, reject) => {
    execFile(
      nodeBin,
      cliArgs,
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000, env: env ?? process.env },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr && stderr.trim()) || err.message;
          return reject(new Error(err.killed ? "Scan timed out" : msg));
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch {
          reject(new Error(`Failed to parse ${label} output`));
        }
      },
    );
  });
}

/**
 * Run dead-code-detect.mjs and return validated DeadCodeItem[].
 *
 * When `persistTo` is set, the unfiltered result is written to
 * `<persistTo>/.code-workbench/dead-code-findings.json` after a successful
 * scan. Acks are NOT applied at write time — they are applied at read time
 * so toggling an ack does not invalidate the findings.
 *
 * @param {{ nodeBin: string; scriptPath: string; root: string; excludeDirs?: string[]; categories?: string[]; env?: NodeJS.ProcessEnv; persistTo?: string }} opts
 */
async function runDeadCodeScan({
  nodeBin,
  scriptPath,
  root,
  excludeDirs = [],
  categories = [],
  env,
  persistTo,
}) {
  const cliArgs = [scriptPath, "--root", root];
  if (excludeDirs.length) cliArgs.push("--exclude-dirs", excludeDirs.join(","));
  if (categories.length) cliArgs.push("--categories", categories.join(","));

  const raw = await spawnDetector(nodeBin, cliArgs, "dead-code-detect", env);
  const items = raw
    .filter(
      (i) =>
        typeof i.kind === "string" &&
        typeof i.file === "string" &&
        typeof i.name === "string" &&
        typeof i.startLine === "number" &&
        typeof i.fingerprint === "string",
    )
    .map((i) => ({
      kind: i.kind,
      file: i.file,
      name: i.name,
      startLine: i.startLine,
      detail: i.detail ?? "",
      fingerprint: i.fingerprint,
    }));

  if (persistTo) {
    await writeFindings(persistTo, "dead-code", { root, items });
  }
  return items;
}

/**
 * Run clone-detect.mjs and return validated DuplicateGroup[].
 *
 * When `persistTo` is set, the unfiltered result is written to
 * `<persistTo>/.code-workbench/duplicates-findings.json` after a successful
 * scan. Acks are NOT applied at write time.
 *
 * @param {{ nodeBin: string; scriptPath: string; root: string; excludeDirs?: string[]; env?: NodeJS.ProcessEnv; persistTo?: string }} opts
 */
async function runDuplicateScan({
  nodeBin,
  scriptPath,
  root,
  excludeDirs = [],
  env,
  persistTo,
}) {
  const cliArgs = [scriptPath, "--root", root];
  if (excludeDirs.length) cliArgs.push("--exclude-dirs", excludeDirs.join(","));

  const raw = await spawnDetector(nodeBin, cliArgs, "clone-detect", env);
  const groups = raw
    .filter(
      (g) =>
        typeof g.cloneType === "string" &&
        typeof g.similarity === "number" &&
        typeof g.count === "number" &&
        Array.isArray(g.members),
    )
    .map((g) => ({
      cloneType: g.cloneType,
      similarity: g.similarity,
      count: g.count,
      // Fingerprint first (needs normHash), then drop it from the public shape.
      fingerprint: groupFingerprint(g),
      members: g.members.map(({ normHash, ...m }) => m),
    }));

  if (persistTo) {
    await writeFindings(persistTo, "duplicates", { root, groups });
  }
  return groups;
}

/**
 * Run type-escape-detect.mjs and return validated TypeEscapeItem[].
 *
 * When `persistTo` is set, the unfiltered result is written to
 * `<persistTo>/.code-workbench/type-escapes-findings.json` after a successful
 * scan. Acks are NOT applied at write time — they are applied at read time
 * so toggling an ack does not invalidate the findings.
 *
 * @param {{ nodeBin: string; scriptPath: string; root: string; excludeDirs?: string[]; categories?: string[]; env?: NodeJS.ProcessEnv; persistTo?: string }} opts
 */
async function runTypeEscapeScan({
  nodeBin,
  scriptPath,
  root,
  excludeDirs = [],
  categories = [],
  env,
  persistTo,
}) {
  const cliArgs = [scriptPath, "--root", root];
  if (excludeDirs.length) cliArgs.push("--exclude-dirs", excludeDirs.join(","));
  if (categories.length) cliArgs.push("--categories", categories.join(","));

  const raw = await spawnDetector(nodeBin, cliArgs, "type-escape-detect", env);
  const items = raw
    .filter(
      (i) =>
        typeof i.kind === "string" &&
        typeof i.file === "string" &&
        typeof i.name === "string" &&
        typeof i.startLine === "number" &&
        typeof i.fingerprint === "string",
    )
    .map((i) => ({
      kind: i.kind,
      file: i.file,
      name: i.name,
      startLine: i.startLine,
      detail: i.detail ?? "",
      content: i.content ?? "",
      fingerprint: i.fingerprint,
    }));

  if (persistTo) {
    await writeFindings(persistTo, "type-escapes", { root, items });
  }
  return items;
}

/**
 * Run code-search.mjs and return ranked symbol matches for `query`.
 * Mirrors the QuickBar `search-code` command's AST-search half: hybrid
 * BM25 + optional semantic rerank over AST-extracted symbols.
 * @param {{ nodeBin: string; scriptPath: string; roots: string[]; query: string; limit?: number; langs?: string[]; env?: NodeJS.ProcessEnv }} opts
 */
async function runCodeSearch({
  nodeBin,
  scriptPath,
  roots,
  query,
  limit,
  langs = [],
  env,
}) {
  if (!query || !roots || !roots.length) return [];
  const cliArgs = [scriptPath, "--query", query];
  for (const root of roots) cliArgs.push("--root", root);
  if (limit != null) cliArgs.push("--limit", String(limit));
  if (langs.length) cliArgs.push("--langs", langs.join(","));

  const raw = await spawnDetector(nodeBin, cliArgs, "code-search", env);
  return raw
    .filter(
      (r) =>
        typeof r.name === "string" &&
        typeof r.file === "string" &&
        typeof r.startLine === "number",
    )
    .map((r) => ({
      name: r.name,
      kind: typeof r.kind === "string" ? r.kind : "",
      file: r.file,
      startLine: r.startLine,
      endLine: typeof r.endLine === "number" ? r.endLine : r.startLine,
      score: typeof r.score === "number" ? r.score : 0,
      snippet: typeof r.snippet === "string" ? r.snippet : "",
    }));
}

/**
 * Run arch-search.mjs and return validated { slug, score } hits, best-first.
 * Returns [] when semantic search is unavailable (caller substring-filters).
 * @param {{ nodeBin: string; scriptPath: string; root: string; query: string; limit?: number; env?: NodeJS.ProcessEnv }} opts
 */
async function runArchSearch({ nodeBin, scriptPath, root, query, limit, env }) {
  if (!query || !root) return [];
  const cliArgs = [scriptPath, "--query", query, "--root", root];
  if (limit != null) cliArgs.push("--limit", String(limit));
  return validateArchHits(await spawnDetector(nodeBin, cliArgs, "arch-search", env));
}

/** Validate raw arch-search output into { slug, score } hits. */
function validateArchHits(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r && typeof r.slug === "string")
    .map((r) => ({
      slug: r.slug,
      score: typeof r.score === "number" ? r.score : 0,
    }));
}

/**
 * Long-lived arch-search worker for interactive (per-keystroke) queries.
 *
 * Spawns `arch-search.mjs --serve` once and keeps it alive so the embedding
 * model loads a single time instead of on every query (a one-shot spawn pays
 * node startup + a multi-second ONNX model load per call). Speaks JSON lines:
 * `{id, root, query, limit}` in, `{id, results}` or `{id, error}` out.
 * The child is spawned lazily on the first search and re-spawned on the next
 * search after a crash/exit.
 *
 * @param {{ nodeBin: string; scriptPath: string; env?: NodeJS.ProcessEnv }} opts
 * @returns {{ search(req: { root: string; query: string; limit?: number }): Promise<Array<{slug: string; score: number}>>; dispose(): void }}
 */
function createArchSearchWorker({ nodeBin, scriptPath, env }) {
  let child = null;
  let nextId = 1;
  let buf = "";
  const pending = new Map();

  function ensureChild() {
    if (child) return child;
    child = spawn(nodeBin, [scriptPath, "--serve"], {
      env: env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const req = pending.get(msg.id);
        if (!req) continue;
        pending.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) req.reject(new Error(msg.error));
        else req.resolve(validateArchHits(msg.results));
      }
    });
    // Surface model-load / embed diagnostics in the host's log.
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const cleanup = (reason) => {
      child = null;
      for (const req of pending.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(reason));
      }
      pending.clear();
    };
    // A failed spawn (bad nodeBin, ENOENT) emits 'error' with NO 'exit'
    // afterwards — without cleanup here the dead handle would be reused and
    // every request would hang until its timeout.
    child.on("error", (err) =>
      cleanup(`arch-search worker error: ${err.message}`),
    );
    child.on("exit", () => cleanup("arch-search worker exited"));
    return child;
  }

  return {
    search({ root, query, limit }) {
      if (!query || !root) return Promise.resolve([]);
      const proc = ensureChild();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("arch-search timed out"));
        }, 120_000);
        pending.set(id, { resolve, reject, timer });
        proc.stdin.write(JSON.stringify({ id, root, query, limit }) + "\n");
      });
    },
    dispose() {
      const proc = child;
      child = null;
      if (proc) proc.kill(); // 'exit' rejects anything still pending
    },
  };
}

module.exports = {
  groupFingerprint,
  runDeadCodeScan,
  runDuplicateScan,
  runTypeEscapeScan,
  runCodeSearch,
  runArchSearch,
  createArchSearchWorker,
};
