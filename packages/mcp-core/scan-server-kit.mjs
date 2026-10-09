/**
 * scan-server-kit  —  shared scaffolding for the scan-style MCP servers.
 *
 * dead-code-server.mjs and type-safety-server.mjs are near-identical: same root
 * resolution, same `.code-workbench/<feature>-{ack,exclude}.json` persistence,
 * the same fingerprint-ack and directory-exclude tools, and an identical
 * JSON-RPC dispatcher. This module holds that common ground so each server keeps
 * only what actually differs (its detector, categories, and result shaping).
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readFindings, writeFindings } from "./findings-store.mjs";
import { recordToolUse } from "./usage-log.mjs";

export const STALE_MS = 24 * 60 * 60 * 1000;

// ── Allowed roots ─────────────────────────────────────────────────────────────

// Resolve the scan root(s) from env, mirroring the AST server: an explicit repo
// path wins, else the AST roots list, else the cwd. Callers use roots[0].
export function resolveRoots() {
  const env = process.env.CODE_WORKBENCH_REPO_PATH;
  if (env) return [path.resolve(env)];
  const astEnv = process.env.CODE_WORKBENCH_AST_ROOTS;
  const roots = astEnv
    ? astEnv.split(path.delimiter).filter(Boolean)
    : [process.cwd()];
  return roots.map((r) => path.resolve(r));
}

// ── Persistence helpers (shared with desktop UI) ──────────────────────────────

export function readJsonArray(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeJsonArray(file, items) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(items, null, 2));
}

/** Coalesce a single fingerprint and/or a fingerprints array into a unique, trimmed list. */
export function normalizeFingerprints(fingerprint, fingerprints) {
  const raw = [];
  if (typeof fingerprint === "string") raw.push(fingerprint);
  else if (Array.isArray(fingerprint)) raw.push(...fingerprint);
  if (Array.isArray(fingerprints)) raw.push(...fingerprints);
  else if (typeof fingerprints === "string") raw.push(fingerprints);
  return [
    ...new Set(
      raw.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean),
    ),
  ];
}

// ── Tool factories ────────────────────────────────────────────────────────────

// The "acknowledge <finding>" tool: add/remove fingerprints from the ack file.
// `ackFilePath` is a getter so the root is resolved once at server import.
export function makeAcknowledgeTool(ackFilePath) {
  return function acknowledge({ fingerprint, fingerprints, unack }) {
    const list = normalizeFingerprints(fingerprint, fingerprints);
    if (list.length === 0) {
      throw new Error("fingerprint (or fingerprints) is required");
    }
    const set = new Set(readJsonArray(ackFilePath()));
    if (unack) {
      for (const f of list) set.delete(f);
    } else {
      for (const f of list) set.add(f);
    }
    const updated = [...set];
    writeJsonArray(ackFilePath(), updated);
    return { acknowledged: updated, count: updated.length };
  };
}

// The "exclude a directory basename" tool, persisted to the exclude file.
export function makeExcludeDirTool(excludeFilePath) {
  return function excludeDir({ dir, unexclude }) {
    if (typeof dir !== "string" || !dir.trim()) {
      throw new Error("dir is required");
    }
    const name = dir.trim();
    const current = readJsonArray(excludeFilePath());
    const updated = unexclude
      ? current.filter((d) => d !== name)
      : current.includes(name)
        ? current
        : [...current, name];
    writeJsonArray(excludeFilePath(), updated);
    return { excludeDirs: updated, count: updated.length };
  };
}

/** Stored exclude dirs merged with any extra dirs passed by the caller. */
export function mergeExcludeDirs(excludeFilePath, extra) {
  const extraExcludes = Array.isArray(extra) ? extra : [];
  return [...new Set([...readJsonArray(excludeFilePath()), ...extraExcludes])];
}

// The "detect <findings>" tool: force_scan runs the detector inline (always with
// every category, so the persisted file is the full set) and persists it;
// otherwise the persisted findings are read. Category filtering and ack hiding
// happen at read time so toggling either never requires a rescan.
//   categoryOf(item)  – category an item belongs to; undefined keeps the item
//   extraShape(items) – extra fields spliced into the response after `total`
export function makeDetectTool({
  root,
  feature,
  allCategories,
  categoryOf,
  ackFilePath,
  excludeFilePath,
  loadDetector,
  extraShape = () => ({}),
  noScanMessage,
}) {
  function filterAndShape(allItems, cats, ackedSet, generatedAt) {
    const wanted = new Set(cats);
    const filteredByCategory = allItems.filter((i) => {
      const cat = categoryOf(i);
      return cat === undefined ? true : wanted.has(cat);
    });
    const visible = filteredByCategory.filter(
      (i) => !ackedSet.has(i.fingerprint),
    );
    return {
      root,
      generatedAt,
      stale: generatedAt > 0 ? Date.now() - generatedAt > STALE_MS : false,
      total: visible.length,
      ...extraShape(visible),
      acknowledgedHidden: filteredByCategory.length - visible.length,
      items: visible,
    };
  }

  return async function detect({ categories, exclude_dirs, force_scan }) {
    const cats =
      Array.isArray(categories) && categories.length
        ? categories
        : allCategories;
    const acked = new Set(readJsonArray(ackFilePath()));

    if (force_scan) {
      const detector = await loadDetector();
      const items = await detector(root, {
        excludeDirs: mergeExcludeDirs(excludeFilePath, exclude_dirs),
        categories: allCategories,
      });
      await writeFindings(root, feature, { root, items });
      return filterAndShape(items, cats, acked, Date.now());
    }

    const findings = await readFindings(root, feature);
    if (!findings || !Array.isArray(findings.items)) {
      return { error: noScanMessage };
    }
    return filterAndShape(findings.items, cats, acked, findings.generatedAt);
  };
}

// ── MCP JSON-RPC dispatcher ─────────────────────────────────────────────────────

// Build the `handle(req)` dispatcher shared by every scan server. `tools` is the
// TOOLS array; `handlers` maps tool name → async fn; usage is logged under
// `usageKey` (e.g. "cw-dead-code").
export function makeHandle({ serverName, usageKey, tools, handlers }) {
  return async function handle(req) {
    const { method, params } = req;

    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version: "1.0.0" },
        };

      case "tools/list":
        return { tools };

      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name) recordToolUse(usageKey, name);
        const handler = handlers[name];
        if (!handler) {
          return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
        }
        const result = await handler(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return {};

      default:
        return {
          _error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  };
}
