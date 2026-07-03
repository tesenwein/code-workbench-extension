/* Full editor-tab Architecture board.
 *
 * The Architecture sidebar view stays (quick glance while coding); this page
 * is the same shared ArchPanel at full width, with semantic (embedding) search
 * over cards instead of only the sidebar's substring filter. Both surfaces
 * answer the identical RPC set (buildArchRpcHandlers) and refresh off the same
 * `.code-workbench/.arch` file watcher. */

import * as vscode from 'vscode';
import { showPage, getPage } from './pagePanel';
import { buildArchRpcHandlers } from './archView';

const VIEW_TYPE = 'codeWorkbench.page.arch';

export interface ArchPageIntent {
  /** Focus this card (open its .json) once the board mounts. */
  focusSlug?: string;
}

export function showArchPage(
  ctx: vscode.ExtensionContext,
  getRepoRoot: () => string | undefined,
  intent: ArchPageIntent = {},
): void {
  const pushContext = (rpc: { postEvent(name: string, payload: unknown): void }) => {
    rpc.postEvent('repo-root', getRepoRoot() ?? null);
    // The same React bundle serves the sidebar and this page; the surface flag
    // switches ArchPanel into page mode (semantic search enabled).
    rpc.postEvent('surface', 'page');
  };
  const pushIntent = (rpc: { postEvent(name: string, payload: unknown): void }) => {
    if (intent.focusSlug) rpc.postEvent('focus-card', intent.focusSlug);
  };
  showPage({
    ctx,
    viewType: VIEW_TYPE,
    title: 'Architecture',
    entry: 'arch',
    handlers: buildArchRpcHandlers(ctx, getRepoRoot),
    onReady: (rpc) => {
      pushContext(rpc);
      pushIntent(rpc);
    },
    onReveal: (rpc) => {
      pushContext(rpc);
      rpc.postEvent('arch-changed', null);
      pushIntent(rpc);
    },
    onVisible: (rpc) => rpc.postEvent('arch-changed', null),
  });
}

/** Tell the open arch page (if any) to re-list — wired to the same file
 *  watcher that refreshes the sidebar view. */
export function refreshArchPage(): void {
  getPage(VIEW_TYPE)?.rpc?.postEvent('arch-changed', null);
}
