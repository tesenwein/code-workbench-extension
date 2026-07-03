/* Builds the HTML document for a React-based sidebar webview panel.
 *
 * Each panel (Tasks, Dead Code, Duplicates) renders the shared
 * `@code-workbench/ui` React components, bundled by esbuild into
 * `dist/webview/<entry>.js` + `<entry>.css`. The HTML loads those, plus an
 * inline `:root` block of the Code Workbench design tokens, derived from the
 * active VS Code theme (see webviewTheme.ts) so the panels adapt to whatever
 * theme the user selected. */

import * as vscode from 'vscode';
import { themeTokenDecls, hcOverrideCss, type ThemeSurface } from './webviewTheme';

export type WebviewEntry = 'tasks' | 'deadcode' | 'duplicates' | 'typeescapes' | 'arch' | 'search';

function makeNonce(): string {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 24; i++) t += cs[Math.floor(Math.random() * cs.length)];
  return t;
}

/* Design tokens consumed by @code-workbench/ui/styles.css — derived from the
 * active VS Code theme's --vscode-* variables (webviewTheme.ts). */
function tokensCss(surface: ThemeSurface): string {
  return `
:root {${themeTokenDecls(surface)}
}
${hcOverrideCss()}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; height:100%; }
body {
  background:var(--bg-0); color:var(--fg-0);
  font-family:var(--font-ui); font-size:12px; line-height:1.4;
  -webkit-font-smoothing:antialiased;
}
#root { height:100%; display:flex; flex-direction:column; }
`;
}

/** Build the full webview document for a React panel. */
export function reactWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: WebviewEntry,
  surface: ThemeSurface = 'sidebar',
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
<style>${tokensCss(surface)}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
