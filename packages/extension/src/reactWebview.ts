/* Builds the HTML document for a React-based sidebar webview panel.
 *
 * Each panel (Tasks, Dead Code, Duplicates) renders the shared
 * `@code-workbench/ui` React components, bundled by esbuild into
 * `dist/webview/<entry>.js` + `<entry>.css`. The HTML loads those, plus an
 * inline `:root` block of the Code Workbench design tokens — the same
 * clay-on-charcoal palette the Electron app defines — so the components look
 * identical in both surfaces. */

import * as vscode from 'vscode';

export type WebviewEntry = 'tasks' | 'deadcode' | 'duplicates' | 'typeescapes' | 'arch';

function makeNonce(): string {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 24; i++) t += cs[Math.floor(Math.random() * cs.length)];
  return t;
}

/* Design tokens consumed by @code-workbench/ui/styles.css. Kept in sync
 * with the Electron app's renderer/styles/global.css :root block. */
const TOKENS_CSS = `
:root {
  color-scheme: dark;
  --bg-0:#1c1b19; --bg-1:#232220; --bg-2:#2b2a27; --bg-3:#353330;
  --fg-0:#f3f0e7; --fg-1:#c4c0b4; --fg-2:#8b877c; --fg-3:#5f5c54;
  --clay:#d97757; --clay-bright:#e8916f; --clay-deep:#b85c3e;
  --clay-ghost:rgba(217,119,87,.14); --clay-line:rgba(217,119,87,.32);
  --border:#34322e; --border-soft:#2a2825;
  --conflict:#e85a4f; --conflict-bg:rgba(232,90,79,.13);
  --radius:7px; --radius-sm:5px;
  --font-ui:'Hanken Grotesk',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',Menlo,Consolas,monospace;
  --font-serif:'Newsreader','Iowan Old Style',Georgia,serif;
}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; height:100%; }
body {
  background:var(--bg-0); color:var(--fg-0);
  font-family:var(--font-ui); font-size:12px; line-height:1.4;
  -webkit-font-smoothing:antialiased;
}
#root { height:100%; display:flex; flex-direction:column; }
`;

/** Build the full webview document for a React panel. */
export function reactWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: WebviewEntry,
): string {
  const nonce = makeNonce();
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', `${entry}.js`),
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', `${entry}.css`),
  );
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${cssUri}" />
<style>${TOKENS_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
