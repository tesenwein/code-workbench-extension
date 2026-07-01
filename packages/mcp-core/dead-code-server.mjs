#!/usr/bin/env node
/**
 * code-workbench-dead-code  —  MCP server exposing dead-code detection tools.
 *
 * Tools:
 *   detect_dead_code        – scan workspace for unused exports, locals, commented-out code
 *   acknowledge_dead_code   – mark a finding as reviewed so it stops reappearing
 *   exclude_dead_code_dir   – skip a directory basename from future scans
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recordToolUse } from "./usage-log.mjs";
import { readFindings, writeFindings } from "./findings-store.mjs";

const STALE_MS = 24 * 60 * 60 * 1000;

// Lazy-load the detector (pulls in the TypeScript compiler API, ~hundreds of ms)
// so MCP startup stays fast enough for Claude Code's init window.
let _detectDeadCode = null;
async function loadDetector() {
  if (!_detectDeadCode) {
    ({ detectDeadCode: _detectDeadCode } =
      await import("./dead-code-detect.mjs"));
  }
  return _detectDeadCode;
}

// ── Allowed roots ─────────────────────────────────────────────────────────────

const ALLOWED_ROOTS = (() => {
  const env = process.env.CODE_WORKBENCH_REPO_PATH;
  if (env) return [path.resolve(env)];
  const astEnv = process.env.CODE_WORKBENCH_AST_ROOTS;
  const roots = astEnv
    ? astEnv.split(path.delimiter).filter(Boolean)
    : [process.cwd()];
  return roots.map((r) => path.resolve(r));
})();

const ROOT = ALLOWED_ROOTS[0];

// ── Persistence helpers (shared with desktop UI) ──────────────────────────────

function ackFilePath() {
  return path.join(ROOT, ".code-workbench", "dead-code-ack.json");
}

function excludeFilePath() {
  return path.join(ROOT, ".code-workbench", "dead-code-exclude.json");
}

function readJsonArray(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(file, items) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(items, null, 2));
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

// Maps the dead-code kind enum to the category names the request schema accepts.
const KIND_TO_CATEGORY = {
  "unused-export": "exports",
  "unused-local": "locals",
  "commented-code": "comments",
};

function filterAndShape(allItems, cats, ackedSet, generatedAt) {
  const wanted = new Set(cats);
  const filteredByCategory = allItems.filter((i) => {
    const cat = KIND_TO_CATEGORY[i.kind];
    return cat ? wanted.has(cat) : true;
  });
  const visible = filteredByCategory.filter(
    (i) => !ackedSet.has(i.fingerprint),
  );
  return {
    root: ROOT,
    generatedAt,
    stale: generatedAt > 0 ? Date.now() - generatedAt > STALE_MS : false,
    total: visible.length,
    acknowledgedHidden: filteredByCategory.length - visible.length,
    items: visible,
  };
}

async function toolDetectDeadCode({ categories, exclude_dirs, force_scan }) {
  const cats =
    Array.isArray(categories) && categories.length
      ? categories
      : ["exports", "locals", "comments"];
  const acked = new Set(readJsonArray(ackFilePath()));

  if (force_scan) {
    const storedExcludes = readJsonArray(excludeFilePath());
    const extraExcludes = Array.isArray(exclude_dirs) ? exclude_dirs : [];
    const excludeDirs = [...new Set([...storedExcludes, ...extraExcludes])];

    const detectDeadCode = await loadDetector();
    // Run unfiltered (all categories) so the persisted file is the full set;
    // filtering happens below at the read step.
    const items = await detectDeadCode(ROOT, {
      excludeDirs,
      categories: ["exports", "locals", "comments"],
    });
    await writeFindings(ROOT, "dead-code", { root: ROOT, items });
    return filterAndShape(items, cats, acked, Date.now());
  }

  const findings = await readFindings(ROOT, "dead-code");
  if (!findings || !Array.isArray(findings.items)) {
    return {
      error:
        "No dead-code scan yet. Open the Dead Code panel in the workbench and click Rescan, " +
        "or call detect_dead_code with force_scan: true.",
    };
  }
  return filterAndShape(findings.items, cats, acked, findings.generatedAt);
}

/** Coalesce a single fingerprint and/or a fingerprints array into a unique, trimmed list. */
function normalizeFingerprints(fingerprint, fingerprints) {
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

function toolAcknowledgeDeadCode({ fingerprint, fingerprints, unack }) {
  const list = normalizeFingerprints(fingerprint, fingerprints);
  if (list.length === 0) {
    throw new Error("fingerprint (or fingerprints) is required");
  }
  const current = readJsonArray(ackFilePath());
  const set = new Set(current);
  if (unack) {
    for (const f of list) set.delete(f);
  } else {
    for (const f of list) set.add(f);
  }
  const updated = [...set];
  writeJsonArray(ackFilePath(), updated);
  return { acknowledged: updated, count: updated.length };
}

function toolExcludeDeadCodeDir({ dir, unexclude }) {
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
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "detect_dead_code",
    description:
      "Return dead-code findings from the most recent host-triggered scan: unused exports, " +
      "unused locals, and commented-out code blocks. Reads the persisted findings file written " +
      "by the Code Workbench UI (or by a force_scan call) and applies current acknowledgements " +
      "at read time, so toggling an ack does not require rescanning. The response includes " +
      '"generatedAt" (epoch ms) and "stale" (true when older than 24h). ' +
      "If no scan has been run yet, returns an error pointing the user at the Dead Code panel. " +
      "Pass force_scan: true to run a fresh inline scan (slower) and persist its result for " +
      "subsequent fast reads.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string", enum: ["exports", "locals", "comments"] },
          description: "Subset of categories to return. Defaults to all three.",
        },
        exclude_dirs: {
          type: "array",
          items: { type: "string" },
          description:
            "Additional directory basenames to exclude. Only honored with force_scan: true " +
            "(the persisted findings file is produced by the host with its own exclude list).",
        },
        force_scan: {
          type: "boolean",
          description:
            "Run a fresh inline scan instead of reading the persisted findings file. " +
            "The result is also persisted, so later calls without force_scan are fast.",
        },
      },
    },
  },
  {
    name: "acknowledge_dead_code",
    description:
      "Mark one or more dead-code findings as reviewed/intentional so they are hidden in future scans. " +
      'Pass a single "fingerprint" or an array of "fingerprints" from detect_dead_code output. ' +
      "Pass unack: true to re-surface previously acknowledged items.",
    inputSchema: {
      type: "object",
      properties: {
        fingerprint: {
          type: "string",
          description:
            'The "fingerprint" field of a single dead-code item from detect_dead_code output.',
        },
        fingerprints: {
          type: "array",
          items: { type: "string" },
          description:
            "An array of dead-code fingerprints to acknowledge in one call. " +
            "Combined with fingerprint if both are given.",
        },
        unack: {
          type: "boolean",
          description:
            "If true, remove these fingerprints from the acknowledgement list.",
        },
      },
    },
  },
  {
    name: "exclude_dead_code_dir",
    description:
      "Persistently exclude a directory basename from dead-code scans. " +
      "Affects both this MCP server and the workbench Dead Code pane.",
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description:
            "Directory basename to exclude (matched anywhere in the tree).",
        },
        unexclude: {
          type: "boolean",
          description:
            "If true, remove this directory from the exclusion list.",
        },
      },
      required: ["dir"],
    },
  },
];

const HANDLERS = {
  detect_dead_code: toolDetectDeadCode,
  acknowledge_dead_code: toolAcknowledgeDeadCode,
  exclude_dead_code_dir: toolExcludeDeadCodeDir,
};

// ── MCP JSON-RPC protocol ─────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export async function handle(req) {
  const { method, params } = req;

  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "code-workbench-dead-code", version: "1.0.0" },
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name) recordToolUse("cw-dead-code", name);
      const handler = HANDLERS[name];
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
}
