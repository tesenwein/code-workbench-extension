/* Editor-tab webview for the `search-code` quick command's results.
 *
 * The command used to end in a QuickPick, which can only show one detail
 * line per result — no code visible. This page renders every ranked match
 * as a card with a real snippet (the shared @code-workbench/ui SearchPanel),
 * and keeps a query bar so the user can re-search without re-running the
 * command. Re-invoking the command reveals the existing tab and pushes the
 * new query. */

import * as vscode from 'vscode';
import { showPage, getPage } from './pagePanel';
import { widenSnippet } from './snippets';
import { searchCode } from './scanHost';

const VIEW_TYPE = 'codeWorkbench.searchResults';
/** Max results shown on the page (the QuickPick used the backend default 20). */
const RESULT_LIMIT = 50;
/** Max snippet lines per result card. */
const SNIPPET_LINES = 12;

/** Open (or reveal) the search-results page and run `query` in it. */
export function showSearchPanel(
  ctx: vscode.ExtensionContext,
  repoRoot: string,
  query: string,
): void {
  showPage({
    ctx,
    viewType: VIEW_TYPE,
    title: 'Search Code',
    entry: 'search',
    handlers: {
      search: async (q) => {
        const text = String(q);
        const page = getPage(VIEW_TYPE);
        if (page) page.panel.title = `Search: ${text}`;
        const results = await searchCode(ctx, repoRoot, text, RESULT_LIMIT);
        // The raw result carries only ~4 snippet lines (enough for ranking) —
        // widen to up to SNIPPET_LINES lines of the symbol body for the page.
        return Promise.all(
          results.map(async (r) => ({
            ...r,
            snippet: await widenSnippet(r, SNIPPET_LINES, r.snippet),
          })),
        );
      },
      openFile: async (file, line) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(String(file)));
        const ln = typeof line === 'number' ? Math.max(0, line - 1) : 0;
        await vscode.window.showTextDocument(doc, {
          preview: true,
          selection: new vscode.Range(ln, 0, ln, 0),
        });
      },
    },
    onReady: (rpc) => {
      rpc.postEvent('repo-root', repoRoot);
      rpc.postEvent('run-search', query);
    },
    onReveal: (rpc) => rpc.postEvent('run-search', query),
  });
}
