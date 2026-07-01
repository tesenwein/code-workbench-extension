import * as vscode from 'vscode';
import { reactWebviewHtml, type WebviewEntry } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';
import { readAcks, writeAcks, readExcludeDirs, writeExcludeDirs } from './scanHost';
import { createTask } from './tasks';
import type { ScanFeature } from '@code-workbench/mcp-core/scan-state';

// Shared config for a scan-result WebviewView. The two concrete views
// (dead code, duplicates) differ only in their feature key, the webview
// React bundle, and the scan function.
export interface ScanViewConfig<T> {
  feature: ScanFeature;
  /** Which dist/webview React bundle this panel renders. */
  entry: WebviewEntry;
  scan: (ctx: vscode.ExtensionContext, root: string) => Promise<T[]>;
  scanErrorLabel: string;
}

/**
 * Generic WebviewViewProvider for the scan panels. Hosts the shared
 * `@code-workbench/ui` React panel and answers its RPC calls — scan,
 * acknowledge, exclude — so the extension's Dead Code / Duplicates panels
 * look and behave identically to the Electron app's.
 */
export class ScanViewProvider<T> implements vscode.WebviewViewProvider {
  private rpc: RpcContext | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getRepoRoot: () => string | undefined,
    private readonly getRepoKey: () => string | undefined,
    private readonly config: ScanViewConfig<T>,
  ) {}

  /** Trigger a scan in the webview — wired to the view/title scan command. */
  requestScan(): void {
    this.rpc?.postEvent('scan', null);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist')],
    };
    view.webview.html = reactWebviewHtml(view.webview, this.ctx.extensionUri, this.config.entry);

    const feature = this.config.feature;

    attachRpc(
      view.webview,
      {
        scan: async () => {
          const root = this.getRepoRoot();
          if (!root) return { items: [], ackedFingerprints: [] };
          try {
            const [items, ackedFingerprints] = await Promise.all([
              this.config.scan(this.ctx, root),
              readAcks(root, feature),
            ]);
            return { items, ackedFingerprints };
          } catch (e) {
            vscode.window.showErrorMessage(
              `${this.config.scanErrorLabel}: ${(e as Error).message}`,
            );
            throw e;
          }
        },
        listAck: async () => {
          const root = this.getRepoRoot();
          return root ? readAcks(root, feature) : [];
        },
        listExclude: async () => {
          const root = this.getRepoRoot();
          return root ? readExcludeDirs(root, feature) : [];
        },
        ack: async (_repoPath, fingerprint, remove) => {
          const root = this.getRepoRoot();
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
          const root = this.getRepoRoot();
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
          const repoKey = this.getRepoKey();
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
      (rpc: RpcContext) => {
        this.rpc = rpc;
        rpc.postEvent('repo-root', this.getRepoRoot() ?? null);
      },
    );
  }
}
