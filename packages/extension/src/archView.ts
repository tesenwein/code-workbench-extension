import * as vscode from 'vscode';
import { reactWebviewHtml } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';
import { readAllArchCards, upsertArchCard, deleteArchCard, archDirPath } from './archHost';
import type { ArchCard } from './archHost';

/**
 * Hosts the shared `@code-workbench/ui` ArchPanel (graph + search + list +
 * card editor) and answers its RPC calls — list / upsert / delete / openFile —
 * against the repo's `.code-workbench/.arch` cards. A FileSystemWatcher on the
 * arch dir pushes `arch-changed` so cards written by Claude's arch MCP server
 * (or by `seed-arch`) appear in the panel without a manual refresh.
 */
export class ArchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.arch';

  private rpc: RpcContext | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getRepoRoot: () => string | undefined,
  ) {}

  /** Re-pull cards in the webview — wired to the view/title refresh command. */
  refresh(): void {
    this.rpc?.postEvent('arch-changed', null);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist')],
    };
    view.webview.html = reactWebviewHtml(view.webview, this.ctx.extensionUri, 'arch');

    attachRpc(
      view.webview,
      {
        list: async () => {
          const root = this.getRepoRoot();
          return root ? readAllArchCards(root) : [];
        },
        upsert: async (card) => {
          const root = this.getRepoRoot();
          if (!root) throw new Error('Open a git repository first.');
          return upsertArchCard(root, card as Partial<ArchCard> & { name: string });
        },
        remove: async (slug) => {
          const root = this.getRepoRoot();
          if (root) await deleteArchCard(root, String(slug));
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
        this.setupWatcher();
      },
    );

    view.onDidDispose(() => {
      this.watcher?.dispose();
      this.watcher = undefined;
      this.rpc = undefined;
    });
  }

  /** Watch the active repo's arch dir so external edits push a live update. */
  private setupWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    const root = this.getRepoRoot();
    if (!root) return;
    const pattern = new vscode.RelativePattern(vscode.Uri.file(archDirPath(root)), '*.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = () => this.rpc?.postEvent('arch-changed', null);
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    this.watcher = watcher;
    this.ctx.subscriptions.push(watcher);
  }

  /** Re-point the watcher and reload after the workspace folder changes. */
  onRepoChanged(): void {
    if (this.rpc) {
      this.rpc.postEvent('repo-root', this.getRepoRoot() ?? null);
      this.setupWatcher();
    }
  }
}
