#!/usr/bin/env node
/**
 * code-workbench-type-safety  —  MCP server exposing type-escape detection tools.
 *
 * Tools:
 *   detect_type_escapes      – scan workspace for type-safety escape hatches
 *                              (as-casts, explicit any, non-null !, @ts-ignore)
 *   acknowledge_type_escape  – mark a finding as reviewed so it stops reappearing
 *   exclude_type_escape_dir  – skip a directory basename from future scans
 */

import path from "node:path";
import { execSync } from "node:child_process";
import { readFindings, writeFindings } from "./findings-store.mjs";
import {
  STALE_MS,
  resolveRoots,
  readJsonArray,
  makeAcknowledgeTool,
  makeExcludeDirTool,
  makeHandle,
} from "./scan-server-kit.mjs";

const CATEGORIES = ["as-cast", "any-type", "non-null", "ts-ignore"];

// Lazy-load the detector (pulls in the TypeScript compiler API, ~hundreds of ms)
// so MCP startup stays fast enough for Claude Code's init window.
let _detectTypeEscapes = null;
async function loadDetector() {
  if (!_detectTypeEscapes) {
    ({ detectTypeEscapes: _detectTypeEscapes } =
      await import("./type-escape-detect.mjs"));
  }
  return _detectTypeEscapes;
}

const ROOT = resolveRoots()[0];

// ── Persistence helpers (shared with desktop UI) ──────────────────────────────

function ackFilePath() {
  return path.join(ROOT, ".code-workbench", "type-escapes-ack.json");
}

function excludeFilePath() {
  return path.join(ROOT, ".code-workbench", "type-escapes-exclude.json");
}

// ── Git diff scoping ───────────────────────────────────────────────────────────
//
// Lets the tool answer "what type escapes did THIS branch introduce" instead of
// dumping the whole repo's backlog. Returns repo-relative, forward-slashed paths
// matching the `file` field on findings, or null when git is unavailable / the
// ref can't be resolved (caller then falls back to the full set).

function gitChangedFiles(baseRef) {
  try {
    // Three-dot: files changed on the current branch since it diverged from base,
    // ignoring changes made on base in the meantime. Include uncommitted edits too.
    const committed = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const working = execSync("git diff --name-only HEAD", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const all = `${committed}\n${working}\n${untracked}`
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return new Set(all.map((p) => p.replace(/\\/g, "/")));
  } catch {
    return null;
  }
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

function byKindCounts(items) {
  const counts = {};
  for (const c of CATEGORIES) counts[c] = 0;
  for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return counts;
}

function filterAndShape(allItems, cats, ackedSet, generatedAt) {
  const wanted = new Set(cats);
  const filteredByCategory = allItems.filter((i) => wanted.has(i.kind));
  const visible = filteredByCategory.filter(
    (i) => !ackedSet.has(i.fingerprint),
  );
  return {
    root: ROOT,
    generatedAt,
    stale: generatedAt > 0 ? Date.now() - generatedAt > STALE_MS : false,
    total: visible.length,
    byKind: byKindCounts(visible),
    acknowledgedHidden: filteredByCategory.length - visible.length,
    items: visible,
  };
}

// Branch-scoped, info-only view: scans inline, filters to the current branch's
// changed files, and returns directly. Deliberately does NOT persist a findings
// file (it would be the partial branch slice, not the canonical full scan) and
// does NOT apply acks (acks are a property of the persisted full backlog, not of
// an ephemeral branch report).
async function diffOnlyReport(cats, baseRef, exclude_dirs) {
  const changedFiles = gitChangedFiles(baseRef);
  if (!changedFiles) {
    return {
      error:
        `diff_only requested but could not resolve git diff against "${baseRef}". ` +
        "Ensure ROOT is a git repo and the base ref exists, or pass base_ref explicitly.",
    };
  }

  const storedExcludes = readJsonArray(excludeFilePath());
  const extraExcludes = Array.isArray(exclude_dirs) ? exclude_dirs : [];
  const excludeDirs = [...new Set([...storedExcludes, ...extraExcludes])];

  const detectTypeEscapes = await loadDetector();
  const all = await detectTypeEscapes(ROOT, {
    excludeDirs,
    categories: CATEGORIES,
  });
  const wanted = new Set(cats);
  const items = all.filter(
    (i) => wanted.has(i.kind) && changedFiles.has(i.file),
  );
  return {
    root: ROOT,
    base: baseRef,
    diffScope: { changedFiles: changedFiles.size },
    total: items.length,
    byKind: byKindCounts(items),
    items,
  };
}

async function toolDetectTypeEscapes({
  categories,
  exclude_dirs,
  force_scan,
  diff_only,
  base_ref,
}) {
  const cats =
    Array.isArray(categories) && categories.length ? categories : CATEGORIES;

  if (diff_only) {
    const baseRef =
      typeof base_ref === "string" && base_ref.trim()
        ? base_ref.trim()
        : "develop";
    return diffOnlyReport(cats, baseRef, exclude_dirs);
  }

  const acked = new Set(readJsonArray(ackFilePath()));

  if (force_scan) {
    const storedExcludes = readJsonArray(excludeFilePath());
    const extraExcludes = Array.isArray(exclude_dirs) ? exclude_dirs : [];
    const excludeDirs = [...new Set([...storedExcludes, ...extraExcludes])];

    const detectTypeEscapes = await loadDetector();
    // Run unfiltered (all categories) so the persisted file is the full set;
    // filtering happens below at the read step.
    const items = await detectTypeEscapes(ROOT, {
      excludeDirs,
      categories: CATEGORIES,
    });
    await writeFindings(ROOT, "type-escapes", { root: ROOT, items });
    return filterAndShape(items, cats, acked, Date.now());
  }

  const findings = await readFindings(ROOT, "type-escapes");
  if (!findings || !Array.isArray(findings.items)) {
    return {
      error:
        "No type-escape scan yet. Open the Type Safety panel in the workbench and click Rescan, " +
        "or call detect_type_escapes with force_scan: true.",
    };
  }
  return filterAndShape(findings.items, cats, acked, findings.generatedAt);
}

const toolAcknowledgeTypeEscape = makeAcknowledgeTool(ackFilePath);
const toolExcludeTypeEscapeDir = makeExcludeDirTool(excludeFilePath);

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "detect_type_escapes",
    description:
      "Return type-safety escape hatches from the most recent host-triggered scan: " +
      "`as` casts, explicit `any` annotations, non-null `!` assertions, and " +
      "@ts-ignore / @ts-expect-error directives — the patterns code uses to silence " +
      "the TypeScript compiler rather than fix the underlying type error. Reads the " +
      "persisted findings file written by the Code Workbench UI (or by a force_scan call) " +
      "and applies current acknowledgements at read time, so toggling an ack does not " +
      'require rescanning. The response includes "generatedAt" (epoch ms) and "stale" ' +
      "(true when older than 24h). If no scan has been run yet, returns an error pointing " +
      "the user at the Type Safety panel. Pass force_scan: true to run a fresh inline scan " +
      "(slower) and persist its result for subsequent fast reads. The response includes a " +
      '"byKind" count breakdown. Pass diff_only: true to restrict findings to files changed ' +
      'on the current branch vs base_ref (default "develop") — use this to review only what ' +
      "the current branch/PR introduced rather than the whole repo backlog.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORIES },
          description: "Subset of categories to return. Defaults to all four.",
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
        diff_only: {
          type: "boolean",
          description:
            "Branch-scoped, info-only mode: scans inline and returns ONLY findings in files " +
            "changed on the current branch (committed, working-tree, and untracked) relative to " +
            "base_ref. Does NOT persist a findings file and does NOT apply acknowledgements — it " +
            "is an ephemeral report of what the current branch introduced. Ignores force_scan.",
        },
        base_ref: {
          type: "string",
          description:
            'Git ref to diff against when diff_only is true. Defaults to "develop". ' +
            'Examples: "main", "HEAD~3", "origin/develop".',
        },
      },
    },
  },
  {
    name: "acknowledge_type_escape",
    description:
      "Mark one or more type-escape findings as reviewed/intentional so they are hidden in future scans. " +
      'Pass a single "fingerprint" or an array of "fingerprints" from detect_type_escapes output. ' +
      "Pass unack: true to re-surface previously acknowledged items.",
    inputSchema: {
      type: "object",
      properties: {
        fingerprint: {
          type: "string",
          description:
            'The "fingerprint" field of a single type-escape item from detect_type_escapes output.',
        },
        fingerprints: {
          type: "array",
          items: { type: "string" },
          description:
            "An array of type-escape fingerprints to acknowledge in one call. " +
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
    name: "exclude_type_escape_dir",
    description:
      "Persistently exclude a directory basename from type-escape scans. " +
      "Affects both this MCP server and the workbench Type Safety pane.",
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
  detect_type_escapes: toolDetectTypeEscapes,
  acknowledge_type_escape: toolAcknowledgeTypeEscape,
  exclude_type_escape_dir: toolExcludeTypeEscapeDir,
};

// ── MCP JSON-RPC protocol ─────────────────────────────────────────────────────

export const handle = makeHandle({
  serverName: "code-workbench-type-safety",
  usageKey: "cw-type-safety",
  tools: TOOLS,
  handlers: HANDLERS,
});
