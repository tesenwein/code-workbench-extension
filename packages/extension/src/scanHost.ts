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

export async function scanDeadCode(
  ctx: vscode.ExtensionContext,
  repoPath: string,
  categories?: string[],
): Promise<DeadCodeItem[]> {
  const excludeDirs = await readExcludeDirs(repoPath, 'dead-code');
  return runDeadCodeScan({
    nodeBin,
    env: detectorEnv,
    scriptPath: detectorPath(ctx, 'dead-code-detect.mjs'),
    root: repoPath,
    excludeDirs,
    categories,
    persistTo: repoPath,
  });
}

export async function scanDuplicates(
  ctx: vscode.ExtensionContext,
  repoPath: string,
): Promise<DuplicateGroup[]> {
  const excludeDirs = await readExcludeDirs(repoPath, 'duplicates');
  return runDuplicateScan({
    nodeBin,
    env: detectorEnv,
    scriptPath: detectorPath(ctx, 'clone-detect.mjs'),
    root: repoPath,
    excludeDirs,
    persistTo: repoPath,
  });
}

export async function scanTypeEscapes(
  ctx: vscode.ExtensionContext,
  repoPath: string,
  categories?: string[],
): Promise<TypeEscapeItem[]> {
  const excludeDirs = await readExcludeDirs(repoPath, 'type-escapes');
  return runTypeEscapeScan({
    nodeBin,
    env: detectorEnv,
    scriptPath: detectorPath(ctx, 'type-escape-detect.mjs'),
    root: repoPath,
    excludeDirs,
    categories,
    persistTo: repoPath,
  });
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
