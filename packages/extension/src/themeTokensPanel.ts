/* Theme token inspector — a singleton editor-tab page that renders every
 * Code Workbench design token as a swatch with its source declaration and
 * the value it resolves to under the active VS Code theme. Turns "does
 * theme X look right?" into a glance, and doubles as living documentation
 * of the token contract webviews rely on. */

import * as vscode from 'vscode';
import { themeTokenDecls, hcOverrideCss } from './webviewTheme';
import { makeNonce } from './panelTheme';

let panel: vscode.WebviewPanel | undefined;

interface TokenRow {
  name: string;
  source: string;
}

/** Parse the `:root` declaration block into [name, source] rows. */
function parseTokens(decls: string): TokenRow[] {
  const rows: TokenRow[] = [];
  for (const line of decls.split('\n')) {
    const m = /^\s*(--[a-z0-9-]+):\s*(.+?);?$/.exec(line);
    if (m) rows.push({ name: m[1], source: m[2] });
  }
  return rows;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function html(): string {
  const nonce = makeNonce();
  const rows = parseTokens(themeTokenDecls('editor'));
  const isColor = (n: string) => !/^--(font|radius)/.test(n);
  const body = rows
    .map(
      (r) => `
  <div class="tok">
    ${isColor(r.name) ? `<span class="swatch" style="background:var(${r.name})"></span>` : `<span class="swatch none">Aa</span>`}
    <code class="name">${esc(r.name)}</code>
    <code class="resolved" data-token="${esc(r.name)}"></code>
    <code class="source" title="${esc(r.source)}">${esc(r.source)}</code>
  </div>`,
    )
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {${themeTokenDecls('editor')}
  }
  ${hcOverrideCss()}
  * { box-sizing:border-box; }
  body {
    margin:0; padding:18px 22px; background:var(--bg-0); color:var(--fg-0);
    font-family:var(--font-ui); font-size:12px;
  }
  h1 { font-size:15px; margin:0 0 2px; }
  .sub { color:var(--fg-2); margin:0 0 14px; }
  .tok {
    display:grid; grid-template-columns:34px 150px 1fr 1.4fr;
    align-items:center; gap:12px; padding:6px 8px;
    border-bottom:1px solid var(--rule);
  }
  .tok:hover { background:var(--bg-1); }
  .swatch {
    width:26px; height:26px; border-radius:var(--radius-sm);
    border:1px solid var(--border);
    display:inline-flex; align-items:center; justify-content:center;
  }
  .swatch.none { background:var(--bg-1); color:var(--fg-2); font-size:11px; }
  code { font-family:var(--font-mono); font-size:11px; }
  .name { color:var(--clay-bright); }
  .resolved { color:var(--fg-1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .source { color:var(--fg-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .head { position:sticky; top:0; background:var(--bg-0); font-family:var(--font-mono);
    font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--fg-3);
    border-bottom:1px solid var(--border); }
</style>
</head>
<body>
<h1>Theme tokens</h1>
<p class="sub">Design tokens as resolved under the active VS Code theme. Panels opened after a theme or worktree-color change pick up new values.</p>
<div class="tok head"><span></span><span>token</span><span>resolved value</span><span>source declaration</span></div>
${body}
<script nonce="${nonce}">
  // A probe element evaluates color-mix()/var() chains to a concrete rgb();
  // non-color tokens (fonts, radii) fall back to the substituted raw value.
  const cs = getComputedStyle(document.documentElement);
  const probe = document.body.appendChild(document.createElement('div'));
  for (const el of document.querySelectorAll('[data-token]')) {
    const name = el.dataset.token;
    probe.style.background = 'var(' + name + ')';
    const bg = getComputedStyle(probe).backgroundColor;
    el.textContent =
      bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : cs.getPropertyValue(name).trim();
    probe.style.background = '';
  }
  probe.remove();
</script>
</body>
</html>`;
}

/** Open (or reveal and re-render) the token inspector tab. */
export function showThemeTokensPanel(): void {
  if (panel) {
    panel.webview.html = html();
    panel.reveal(undefined, false);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'codeWorkbench.page.themeTokens',
    'Theme Tokens',
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );
  panel.webview.html = html();
  panel.onDidDispose(() => {
    panel = undefined;
  });
}
