import * as vscode from 'vscode';
import { reactWebviewHtml } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';
import {
  readAllArchCards,
  upsertArchCard,
  deleteArchCard,
  archDirPath,
  archCardPath,
} from './archHost';
import type { ArchCard } from './archHost';
import { searchArchCards } from './scanHost';

/**
 * The RPC set the ArchPanel needs — shared by the sidebar {@link ArchViewProvider}
 * and the full-page `archPage`. `list`/`upsert`/`remove`/`openCard` mutate the
 * `.code-workbench/.arch` store; `search` ranks cards by embedding similarity
 * (empty result → the panel substring-filters instead).
 */
export function buildArchRpcHandlers(
  ctx: vscode.ExtensionContext,
  getRepoRoot: () => string | undefined,
): Record<string, (...args: unknown[]) => unknown | Promise<unknown>> {
  return {
    list: async () => {
      const root = getRepoRoot();
      return root ? readAllArchCards(root) : [];
    },
    upsert: async (card) => {
      const root = getRepoRoot();
      if (!root) throw new Error('Open a git repository first.');
      return upsertArchCard(root, card as Partial<ArchCard> & { name: string });
    },
    remove: async (slug) => {
      const root = getRepoRoot();
      if (root) await deleteArchCard(root, String(slug));
    },
    openCard: async (slug) => {
      const root = getRepoRoot();
      if (!root) throw new Error('Open a git repository first.');
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(archCardPath(root, String(slug))),
      );
      await vscode.window.showTextDocument(doc, { preview: false });
    },
    search: async (query) => {
      const root = getRepoRoot();
      if (!root) return [];
      return searchArchCards(ctx, root, String(query));
    },
  };
}

/**
 * Hosts the shared `@code-workbench/ui` ArchPanel (search + list) and answers
 * its RPC calls — list / upsert / remove / openCard / search — against the
 * repo's `.code-workbench/.arch` cards via {@link buildArchRpcHandlers}. A
 * FileSystemWatcher on the arch dir pushes `arch-changed` so cards written by
 * Claude's arch MCP server (or by `seed-arch`) appear without a manual refresh;
 * the same watcher fires `onCardsChanged` so the full-page board refreshes too.
 */
export class ArchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.arch';

  private rpc: RpcContext | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getRepoRoot: () => string | undefined,
    /** Notified whenever cards change so the full-page arch board can refresh too. */
    private readonly onCardsChanged?: () => void,
  ) {}

  /** Re-pull cards in the webview — wired to the view/title refresh command. */
  refresh(): void {
    this.rpc?.postEvent('arch-changed', null);
    this.onCardsChanged?.();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist')],
    };
    view.webview.html = reactWebviewHtml(view.webview, this.ctx.extensionUri, 'arch');

    attachRpc(
      view.webview,
      buildArchRpcHandlers(this.ctx, this.getRepoRoot),
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
    const onChange = () => {
      this.rpc?.postEvent('arch-changed', null);
      this.onCardsChanged?.();
    };
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
