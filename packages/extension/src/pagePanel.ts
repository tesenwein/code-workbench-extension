/* Singleton editor-tab webview pages.
 *
 * Full-page counterpart to the sidebar WebviewViews: each page (search
 * results, dead code, duplicates, type safety, tasks board) is one reusable
 * WebviewPanel keyed by viewType — re-invoking its command reveals the
 * existing tab instead of stacking new ones, and can push a fresh event
 * into it (re-run a search, trigger a scan). */

import * as vscode from 'vscode';
import { reactWebviewHtml, type WebviewEntry } from './reactWebview';
import { attachRpc, type RpcContext } from './webviewRpc';

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

interface PageInstance {
  panel: vscode.WebviewPanel;
  rpc?: RpcContext;
}

const pages = new Map<string, PageInstance>();

export interface PageOptions {
  ctx: vscode.ExtensionContext;
  /** Stable panel key — one tab per viewType. */
  viewType: string;
  title: string;
  /** Which dist/webview React bundle the page renders. */
  entry: WebviewEntry;
  handlers: Record<string, Handler>;
  /** Called once the webview has mounted (push initial state here). */
  onReady: (rpc: RpcContext) => void;
  /** Called instead of onReady when the page already exists and is revealed. */
  onReveal?: (rpc: RpcContext) => void;
  /** Called when the tab becomes visible again after being hidden (tab
   *  switch back) — push a refresh here so a retained-but-hidden page can
   *  skip background work and still show fresh data on return. */
  onVisible?: (rpc: RpcContext) => void;
}

/** Open the page, or reveal the existing tab for this viewType. */
export function showPage(opts: PageOptions): void {
  const existing = pages.get(opts.viewType);
  if (existing) {
    existing.panel.reveal(undefined, false);
    if (existing.rpc) opts.onReveal?.(existing.rpc);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    opts.viewType,
    opts.title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(opts.ctx.extensionUri, 'dist')],
    },
  );
  panel.webview.html = reactWebviewHtml(panel.webview, opts.ctx.extensionUri, opts.entry, 'editor');
  const instance: PageInstance = { panel };
  pages.set(opts.viewType, instance);
  panel.onDidDispose(() => pages.delete(opts.viewType));

  attachRpc(panel.webview, opts.handlers, (rpc) => {
    instance.rpc = rpc;
    opts.onReady(rpc);
  });

  if (opts.onVisible) {
    const onVisible = opts.onVisible;
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible && instance.rpc) onVisible(instance.rpc);
    });
  }
}

/** The live page for a viewType, if its tab is open. */
export function getPage(viewType: string): { rpc?: RpcContext; panel: vscode.WebviewPanel } | undefined {
  return pages.get(viewType);
}
