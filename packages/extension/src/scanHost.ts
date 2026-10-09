import * as path from 'path';
import * as vscode from 'vscode';
import {
  createArchSearchWorker,
  runCodeSearch,
  runDeadCodeScan,
  runDuplicateScan,
  runTypeEscapeScan,
} from '@code-workbench/mcp-core/scan-runner';
import type { ArchSearchHit, ArchSearchWorker } from '@code-workbench/mcp-core/scan-runner';
import {
  readAcks,
  writeAcks,
  readExcludeDirs,
  writeExcludeDirs,
} from '@code-workbench/mcp-core/scan-state';
import type {
  CodeSearchResult,
  DeadCodeItem,
  DuplicateGroup,
  TypeEscapeItem,
} from '@code-workbench/mcp-core/scan-types';

export type { CodeSearchResult, DeadCodeItem, DuplicateGroup, TypeEscapeItem };

// The detector .mjs scripts are spawned as child processes. `node` is often
// absent from the extension host's PATH (VS Code launched from the Dock/Finder
// inherits only the minimal GUI PATH), so resolving it via `which` is
// unreliable — and a bare Electron binary spawned without ELECTRON_RUN_AS_NODE
// launches the editor GUI instead of running the script, which hangs the scan
// silently. process.execPath always exists; ELECTRON_RUN_AS_NODE makes it run
// as plain Node. (A real `node` binary ignores that env var, so this is safe.)
const nodeBin = process.execPath;
const detectorEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
};

function detectorPath(ctx: vscode.ExtensionContext, name: string): string {
  return path.join(ctx.extensionPath, 'dist', 'mcp-server', name);
}

interface ScanResults {
  'dead-code': DeadCodeItem[];
  duplicates: DuplicateGroup[];
  'type-escapes': TypeEscapeItem[];
}
type ScanFeature = keyof ScanResults;
type ScanOpts = Parameters<typeof runDeadCodeScan>[0];

const SCAN_FEATURES: {
  [F in ScanFeature]: { script: string; run: (opts: ScanOpts) => Promise<ScanResults[F]> };
} = {
  'dead-code': { script: 'dead-code-detect.mjs', run: runDeadCodeScan },
  duplicates: { script: 'clone-detect.mjs', run: runDuplicateScan },
  'type-escapes': { script: 'type-escape-detect.mjs', run: runTypeEscapeScan },
};

async function runScan<F extends ScanFeature>(
  ctx: vscode.ExtensionContext,
  repoPath: string,
  feature: F,
  categories?: string[],
): Promise<ScanResults[F]> {
  const { script, run } = SCAN_FEATURES[feature];
  const excludeDirs = await readExcludeDirs(repoPath, feature);
  return run({
    nodeBin,
    env: detectorEnv,
    scriptPath: detectorPath(ctx, script),
    root: repoPath,
    excludeDirs,
    categories,
    persistTo: repoPath,
  });
}

export const scanDeadCode = (
  ctx: vscode.ExtensionContext,
  repoPath: string,
  categories?: string[],
): Promise<DeadCodeItem[]> => runScan(ctx, repoPath, 'dead-code', categories);

export const scanDuplicates = (
  ctx: vscode.ExtensionContext,
  repoPath: string,
): Promise<DuplicateGroup[]> => runScan(ctx, repoPath, 'duplicates');

export const scanTypeEscapes = (
  ctx: vscode.ExtensionContext,
  repoPath: string,
  categories?: string[],
): Promise<TypeEscapeItem[]> => runScan(ctx, repoPath, 'type-escapes', categories);

/** Fingerprints of every finding, per scan feature — the unit the code-health
 *  gate diffs. Content-based, so unrelated edits don't churn them. */
export interface HealthSnapshot {
  duplicates: string[];
  deadCode: string[];
  typeEscapes: string[];
}

/**
 * Run all three scans and keep only their fingerprints. Unlike the on-demand
 * scans this never persists a findings file, so a background gate run cannot
 * clobber what the Tools panels show.
 */
export async function scanHealthSnapshot(
  ctx: vscode.ExtensionContext,
  repoPath: string,
): Promise<HealthSnapshot> {
  const run = async <F extends ScanFeature>(feature: F): Promise<ScanResults[F]> => {
    const { script, run: scan } = SCAN_FEATURES[feature];
    return scan({
      nodeBin,
      env: detectorEnv,
      scriptPath: detectorPath(ctx, script),
      root: repoPath,
      excludeDirs: await readExcludeDirs(repoPath, feature),
    });
  };
  const [dups, dead, escapes] = await Promise.all([
    run('duplicates'),
    run('dead-code'),
    run('type-escapes'),
  ]);
  return {
    duplicates: dups.map((d) => d.fingerprint),
    deadCode: dead.map((d) => d.fingerprint),
    typeEscapes: escapes.map((d) => d.fingerprint),
  };
}

/**
 * Hybrid code search over AST-extracted symbols — the AST half of the
 * QuickBar `search-code` command. Ranks by identifier-aware BM25 with an
 * optional semantic rerank (skipped when @xenova/transformers is absent).
 */
export async function searchCode(
  ctx: vscode.ExtensionContext,
  repoPath: string,
  query: string,
  limit?: number,
): Promise<CodeSearchResult[]> {
  return runCodeSearch({
    nodeBin,
    env: detectorEnv,
    scriptPath: detectorPath(ctx, 'code-search.mjs'),
    roots: [repoPath],
    query,
    limit,
  });
}

export type { ArchSearchHit };

// Arch search runs per keystroke, so it uses a single long-lived worker
// (`arch-search.mjs --serve`) instead of a spawn per query — a one-shot spawn
// pays node startup plus a multi-second embedding-model load every time.
let archSearchWorker: ArchSearchWorker | undefined;

/**
 * Semantic search over the repo's architecture cards — ranks each card by
 * local-embedding similarity to `query`; cards below the relevance floor are
 * dropped. Returns [] when the embedding model is absent
 * (@xenova/transformers not installed), so callers fall back to substring
 * filtering.
 */
export async function searchArchCards(
  ctx: vscode.ExtensionContext,
  repoPath: string,
  query: string,
  limit?: number,
): Promise<ArchSearchHit[]> {
  if (!archSearchWorker) {
    archSearchWorker = createArchSearchWorker({
      nodeBin,
      env: detectorEnv,
      scriptPath: detectorPath(ctx, 'arch-search.mjs'),
    });
    ctx.subscriptions.push({
      dispose: () => {
        archSearchWorker?.dispose();
        archSearchWorker = undefined;
      },
    });
  }
  return archSearchWorker.search({ root: repoPath, query, limit });
}

export { readAcks, writeAcks, readExcludeDirs, writeExcludeDirs };
