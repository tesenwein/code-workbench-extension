/* Full editor-tab pages for the three code-health scans — dead code,
 * duplicates, type safety.
 *
 * These replace the old narrow sidebar WebviewViews: the sidebar now only
 * carries the Code Health action bar (see codeHealthView.ts), whose entries
 * run these commands. Each page hosts the same shared @code-workbench/ui
 * panel the sidebar used, answers the same scan/ack/exclude RPC set, and
 * auto-scans on open. The duplicates page additionally widens each clone
 * member with its code snippet so groups can be compared side by side. */

import * as path from 'path';
import * as vscode from 'vscode';
import { showPage } from './pagePanel';
import type { WebviewEntry } from './reactWebview';
import {
  scanDeadCode,
  scanDuplicates,
  scanTypeEscapes,
  readAcks,
  writeAcks,
  readExcludeDirs,
  writeExcludeDirs,
} from './scanHost';
import { widenSnippet } from './snippets';
import { createTask } from './tasks';
import { appendTrendPoint } from './scanTrends';
import type { ScanFeature } from '@code-workbench/mcp-core/scan-state';

/** Max code lines shown per duplicate-group member on the page. */
const MEMBER_SNIPPET_LINES = 30;

/** Context lines shown for a dead-code finding (no end line is reported, so a
 *  fixed window from the start line gives the reader enough to judge it). */
const DEAD_CODE_SNIPPET_LINES = 8;

interface ScanPage {
  feature: ScanFeature;
  entry: WebviewEntry;
  command: string;
  title: string;
  scanErrorLabel: string;
  scan: (ctx: vscode.ExtensionContext, root: string) => Promise<unknown[]>;
}

/** Attach the source snippet to every clone-group member — the page renders
 *  them side by side, which is the whole point of a full-width view. Member
 *  `file` is repo-relative (the UI needs it that way), so widening reads from
 *  the absolute path. */
async function scanDuplicatesWithSnippets(
  ctx: vscode.ExtensionContext,
  root: string,
): Promise<unknown[]> {
  const groups = await scanDuplicates(ctx, root);
  const cache = new Map<string, Promise<string[] | undefined>>();
  return Promise.all(
    groups.map(async (g) => ({
      ...g,
      members: await Promise.all(
        g.members.map(async (m) => ({
          ...m,
          snippet: await widenSnippet(
            { ...m, file: path.join(root, m.file) },
            MEMBER_SNIPPET_LINES,
            '',
            cache,
          ),
        })),
      ),
    })),
  );
}

/** Attach a source snippet to every dead-code finding so the page can show it
 *  in the same line-numbered style as the code-search results. */
async function scanDeadCodeWithSnippets(
  ctx: vscode.ExtensionContext,
  root: string,
): Promise<unknown[]> {
  const items = await scanDeadCode(ctx, root);
  const cache = new Map<string, Promise<string[] | undefined>>();
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      snippet: await widenSnippet(
        {
          file: path.join(root, item.file),
          startLine: item.startLine,
          endLine: item.startLine + DEAD_CODE_SNIPPET_LINES - 1,
        },
        DEAD_CODE_SNIPPET_LINES,
        '',
        cache,
      ),
    })),
  );
}

const SCAN_PAGES: ScanPage[] = [
  {
    feature: 'dead-code',
    entry: 'deadcode',
    command: 'codeWorkbench.deadCode.scan',
    title: 'Dead Code',
    scanErrorLabel: 'Dead code scan failed',
    scan: scanDeadCodeWithSnippets,
  },
  {
    feature: 'duplicates',
    entry: 'duplicates',
    command: 'codeWorkbench.duplicates.scan',
    title: 'Duplicates',
    scanErrorLabel: 'Duplicate scan failed',
    scan: scanDuplicatesWithSnippets,
  },
  {
    feature: 'type-escapes',
    entry: 'typeescapes',
    command: 'codeWorkbench.typeEscapes.scan',
    title: 'Type Safety',
    scanErrorLabel: 'Type escape scan failed',
    scan: scanTypeEscapes,
  },
];

function openScanPage(
  ctx: vscode.ExtensionContext,
  page: ScanPage,
  getRepoRoot: () => string | undefined,
  getRepoKey: () => string | undefined,
): void {
  const feature = page.feature;
  showPage({
    ctx,
    viewType: `codeWorkbench.page.${feature}`,
    title: page.title,
    entry: page.entry,
    handlers: {
      scan: async () => {
        const root = getRepoRoot();
        if (!root) return { items: [], ackedFingerprints: [] };
        try {
          const [items, ackedFingerprints] = await Promise.all([
            page.scan(ctx, root),
            readAcks(root, feature),
          ]);
          // Record this scan in the per-repo history; the page shows the
          // active-count series as a sparkline. Best-effort — a trend write
          // failure must not fail the scan.
          const acked = new Set(ackedFingerprints);
          const active = (items as Array<{ fingerprint: string }>).filter(
            (i) => !acked.has(i.fingerprint),
          ).length;
          const trend = await appendTrendPoint(root, feature, {
            t: new Date().toISOString(),
            total: items.length,
            active,
          }).then(
            (series) => series.map((p) => p.active),
            () => undefined,
          );
          return { items, ackedFingerprints, trend };
        } catch (e) {
          vscode.window.showErrorMessage(`${page.scanErrorLabel}: ${(e as Error).message}`);
          throw e;
        }
      },
      listAck: async () => {
        const root = getRepoRoot();
        return root ? readAcks(root, feature) : [];
      },
      listExclude: async () => {
        const root = getRepoRoot();
        return root ? readExcludeDirs(root, feature) : [];
      },
      ack: async (_repoPath, fingerprint, remove) => {
        const root = getRepoRoot();
        if (!root) return [];
        const fp = String(fingerprint);
        const acks = await readAcks(root, feature);
        const updated = remove
          ? acks.filter((f) => f !== fp)
          : acks.includes(fp)
            ? acks
            : [...acks, fp];
        await writeAcks(root, feature, updated);
        return updated;
      },
      excludeDir: async (_repoPath, dir, remove) => {
        const root = getRepoRoot();
        if (!root) return [];
        const name = String(dir);
        const dirs = await readExcludeDirs(root, feature);
        const updated = remove
          ? dirs.filter((d) => d !== name)
          : dirs.includes(name)
            ? dirs
            : [...dirs, name];
        await writeExcludeDirs(root, feature, updated);
        return updated;
      },
      createTask: async (title) => {
        const repoKey = getRepoKey();
        if (!repoKey) return;
        await createTask(repoKey, { title: String(title) });
      },
      openFile: async (loc, line) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(String(loc)));
        const ln = typeof line === 'number' ? Math.max(0, line - 1) : 0;
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(ln, 0, ln, 0),
        });
      },
    },
    onReady: (rpc) => {
      rpc.postEvent('repo-root', getRepoRoot() ?? null);
      rpc.postEvent('scan', null);
    },
    // Re-running the action while the tab is open re-scans.
    onReveal: (rpc) => rpc.postEvent('scan', null),
  });
}

/** Register the three scan commands — each opens (or reveals) its page and
 *  triggers a scan. Command ids are unchanged from the old sidebar views. */
export function registerScanPageCommands(
  ctx: vscode.ExtensionContext,
  getRepoRoot: () => string | undefined,
  getRepoKey: () => string | undefined,
): vscode.Disposable[] {
  return SCAN_PAGES.map((page) =>
    vscode.commands.registerCommand(page.command, () =>
      openScanPage(ctx, page, getRepoRoot, getRepoKey),
    ),
  );
}
