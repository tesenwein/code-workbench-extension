#!/usr/bin/env node
/**
 * code-workbench-dead-code  —  MCP server exposing dead-code detection tools.
 *
 * Tools:
 *   detect_dead_code        – scan workspace for unused exports, locals, commented-out code
 *   acknowledge_dead_code   – mark a finding as reviewed so it stops reappearing
 *   exclude_dead_code_dir   – skip a directory basename from future scans
 */

import path from "node:path";
import {
  resolveRoots,
  makeDetectTool,
  makeAcknowledgeTool,
  makeExcludeDirTool,
  makeHandle,
} from "./scan-server-kit.mjs";

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

const ROOT = resolveRoots()[0];

// ── Persistence helpers (shared with desktop UI) ──────────────────────────────

function ackFilePath() {
  return path.join(ROOT, ".code-workbench", "dead-code-ack.json");
}

function excludeFilePath() {
  return path.join(ROOT, ".code-workbench", "dead-code-exclude.json");
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

// Maps the dead-code kind enum to the category names the request schema accepts.
const KIND_TO_CATEGORY = {
  "unused-export": "exports",
  "unused-local": "locals",
  "commented-code": "comments",
};

const toolDetectDeadCode = makeDetectTool({
  root: ROOT,
  feature: "dead-code",
  allCategories: ["exports", "locals", "comments"],
  categoryOf: (i) => KIND_TO_CATEGORY[i.kind],
  ackFilePath,
  excludeFilePath,
  loadDetector,
  noScanMessage:
    "No dead-code scan yet. Open the Dead Code panel in the workbench and click Rescan, " +
    "or call detect_dead_code with force_scan: true.",
});

const toolAcknowledgeDeadCode = makeAcknowledgeTool(ackFilePath);
const toolExcludeDeadCodeDir = makeExcludeDirTool(excludeFilePath);

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

export const handle = makeHandle({
  serverName: "code-workbench-dead-code",
  usageKey: "cw-dead-code",
  tools: TOOLS,
  handlers: HANDLERS,
});
