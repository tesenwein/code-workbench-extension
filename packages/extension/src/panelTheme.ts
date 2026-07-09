/** Shared chrome for the Code Workbench sidebar webview panels
 *  (Worktrees, Tasks, Saved Sessions). Design tokens derive from the
 *  active VS Code theme (see webviewTheme.ts). */

import { themeTokenDecls, hcOverrideCss } from './webviewTheme';

/** Worktree accent colors for the webview panels. Brighter and more saturated
 *  than the terminal ANSI palette so they read clearly on the dark panel
 *  background. Shared by the Worktrees, Tasks and Sessions views. */
export const WORKTREE_DOT: Record<string, string> = {
  default: '#d97757',
  red: '#e8675c',
  green: '#8fc47a',
  yellow: '#e0b85c',
  blue: '#6fa8e0',
  magenta: '#d488bc',
  cyan: '#6fc6cd',
};

export function makeNonce(): string {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 24; i++) t += cs[Math.floor(Math.random() * cs.length)];
  return t;
}

/* Built per call, not at module load — the token block depends on the
 * worktree accent override, which is set during activation. */
const panelCss = () => `
  :root {${themeTokenDecls('sidebar')}
  }
  ${hcOverrideCss()}
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body {
    font-family:var(--font-ui); color:var(--fg-0);
    background:var(--bg-0); font-size:12px; line-height:1.4;
    -webkit-font-smoothing:antialiased;
    font-feature-settings:'ss01','cv11';
  }
  body::before {
    content:''; position:fixed; inset:0;
    pointer-events:none; z-index:-1;
    background-image:
      radial-gradient(circle at 8% -8%, color-mix(in srgb, var(--clay) 10%, transparent), transparent 40%),
      radial-gradient(circle at 108% 108%, color-mix(in srgb, var(--clay) 5%, transparent), transparent 52%);
    background-repeat:no-repeat;
  }
  #root { padding:4px 5px 9px; }

  /* placeholder / empty state */
  .empty {
    margin:7px 5px; padding:13px 12px;
    border:1px dashed var(--clay-line); border-radius:8px;
    background:var(--clay-ghost);
    font-family:var(--font-serif); font-style:italic; font-size:12.5px;
    color:var(--fg-1); cursor:pointer; text-align:center;
    transition:background .14s ease,border-color .14s ease;
  }
  .empty:hover { background:color-mix(in srgb, var(--clay) 22%, transparent); border-color:var(--clay); }
  .empty .x {
    display:block; margin-top:9px;
    font-family:var(--font-mono); font-style:normal; font-size:9px;
    letter-spacing:.18em; text-transform:uppercase; color:var(--clay);
  }

  /* group header */
  .grp {
    display:flex; align-items:center; gap:7px;
    margin:11px 4px 3px; padding:0 4px 4px;
    border-bottom:1px solid var(--rule);
  }
  .grp:first-child { margin-top:2px; }
  .grp .gi { font-size:10px; color:var(--fg-3); line-height:1; }
  .grp.active .gi { color:var(--clay); }
  .grp .gname {
    font-family:var(--font-mono); font-size:9.5px; letter-spacing:.15em;
    text-transform:uppercase; color:var(--fg-2);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .grp.active .gname { color:var(--clay-bright); }
  /* worktree color accent on group headers */
  .grp .gdot {
    flex:0 0 auto; width:8px; height:8px; border-radius:50%;
    box-shadow:0 0 0 2px var(--bg-0), 0 0 6px currentColor;
  }
  .grp.wt { border-bottom-width:1.5px; }
  .grp .gcount {
    margin-left:auto; font-family:var(--font-mono); font-size:9.5px;
    color:var(--fg-4);
  }
  .grp.toggle { cursor:pointer; }
  .grp.toggle:hover .gname { color:var(--fg-0); }
  .grp .chev { transition:transform .14s ease; }
  .grp.collapsed .chev { transform:rotate(-90deg); }

  /* row */
  .row {
    position:relative; display:flex; align-items:flex-start; gap:8px;
    padding:5px 8px; margin:2px 2px;
    background:var(--bg-1); border:1px solid var(--rule);
    border-radius:6px; cursor:pointer;
    transition:border-color .13s ease,background .13s ease,transform .07s ease;
  }
  .row:hover { border-color:var(--clay-line); background:var(--bg-2); }
  .row:active { transform:translateY(.5px); }
  .row.active {
    border-color:var(--clay-line);
    background:linear-gradient(90deg,var(--clay-ghost),var(--bg-1) 62%);
  }
  .row.active::before {
    content:''; position:absolute; left:-1px; top:5px; bottom:5px; width:2px;
    background:var(--clay); border-radius:2px;
  }
  /* selected: row whose terminal is currently focused in VS Code. A stronger,
     persistent ring than the activity highlight so the panel always shows
     which chat the user is looking at. */
  .row.selected {
    border-color:var(--clay);
    background:linear-gradient(90deg,color-mix(in srgb, var(--clay) 20%, transparent),var(--bg-2) 70%);
    box-shadow:0 0 0 1px var(--clay-line);
  }
  .row.selected::before {
    content:''; position:absolute; left:-1px; top:4px; bottom:4px; width:3px;
    background:var(--clay-bright); border-radius:2px;
  }
  .row.sub { margin-left:19px; }
  .row.sub::after {
    content:''; position:absolute; left:-12px; top:-4px; height:18px; width:10px;
    border-left:1px solid var(--border); border-bottom:1px solid var(--border);
    border-bottom-left-radius:6px;
  }
  .row.dim { opacity:.5; }

  .lead {
    flex:0 0 auto; display:flex; align-items:center; justify-content:center;
    width:16px; height:16px; margin-top:1px;
  }
  .dot {
    width:10px; height:10px; border-radius:50%; background:var(--clay);
    box-shadow:0 0 0 2px var(--bg-0),0 0 7px var(--clay);
  }

  /* session tab icon (codicon) shown in the row lead */
  .lead.icn { position:relative; }
  .sicon.codicon { font-size:15px; }
  .sicon {
    line-height:1; color:var(--fg-2);
    transition:color .13s ease;
  }
  .row:hover .sicon { color:var(--fg-0); }
  .row.selected .sicon, .row.active .sicon { color:var(--clay-bright); }
  /* live-status badge, tucked into the icon's lower-right corner */
  .lead.icn .live {
    position:absolute; right:-2px; bottom:-2px;
    box-shadow:0 0 0 2px var(--bg-1);
  }
  .row:hover .lead.icn .live { box-shadow:0 0 0 2px var(--bg-2); }
  .lead.icn .live.on { box-shadow:0 0 0 2px var(--bg-1),0 0 6px color-mix(in srgb, var(--ok) 70%, transparent); }
  .lead.icn .live.on.blink { box-shadow:0 0 0 2px var(--bg-1),0 0 6px color-mix(in srgb, var(--warn) 70%, transparent); }

  .body { flex:1 1 auto; min-width:0; }
  .title {
    font-size:12px; color:var(--fg-0); font-weight:500;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .title .star { color:var(--clay); font-size:9px; margin-right:3px; }
  .row.done .title { text-decoration:line-through; color:var(--fg-2); }
  .meta {
    display:flex; align-items:center; gap:5px; margin-top:1px;
    font-family:var(--font-mono); font-size:9.5px; color:var(--fg-3);
    overflow:hidden; white-space:nowrap;
  }
  .meta .br {
    color:var(--fg-2); overflow:hidden; text-overflow:ellipsis;
    min-width:0;
  }
  .meta .sep { opacity:.45; }
  .meta .dirty { color:var(--warn); }
  .meta .ab { color:var(--clay-bright); }
  .meta .sess { color:var(--clay-bright); }
  .meta .due { color:var(--fg-2); }
  .meta .due.overdue { color:var(--warn); font-weight:600; }

  /* priority chip — clickable */
  .prio {
    flex:0 0 auto; font-family:var(--font-mono); font-size:9px;
    padding:1px 4px; border-radius:4px; cursor:pointer;
    border:1px solid transparent;
    color:var(--fg-3); background:var(--bg-3);
    transition:all .12s ease;
  }
  .prio:hover { border-color:var(--clay-line); }
  .prio.high { color:var(--clay-bright); background:var(--clay-ghost); }
  .prio.low  { color:var(--fg-3); }

  /* live dot */
  .live {
    width:7px; height:7px; border-radius:50%;
    background:var(--fg-4); flex:0 0 auto;
    transition:background .2s ease;
  }
  .live.on { background:var(--ok); box-shadow:0 0 7px color-mix(in srgb, var(--ok) 70%, transparent); }
  .live.on.blink { background:var(--warn); box-shadow:0 0 7px color-mix(in srgb, var(--warn) 70%, transparent); }

  /* status toggle (tasks) */
  .statusbtn {
    background:none; border:none; padding:0; margin:0; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    width:16px; height:16px; color:var(--fg-3);
    transition:color .12s ease;
  }
  .statusbtn:hover { color:var(--clay); }
  .statusbtn.s-in-progress { color:var(--clay); }
  .statusbtn.s-done { color:var(--ok); }
  .statusbtn svg { width:13px; height:13px; }

  /* action buttons */
  .acts {
    flex:0 0 auto; display:flex; gap:2px; align-self:center;
    opacity:0; transition:opacity .12s ease;
  }
  .row:hover .acts { opacity:1; }
  .ibtn {
    display:flex; align-items:center; justify-content:center;
    width:21px; height:21px; padding:0;
    background:transparent; border:1px solid transparent; border-radius:5px;
    color:var(--fg-3); cursor:pointer;
    transition:all .12s ease;
  }
  .ibtn:hover { color:var(--fg-0); background:var(--bg-3); border-color:var(--rule); }
  .ibtn.danger:hover { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 42%, transparent); }
  .ibtn.clay:hover { color:var(--clay-bright); border-color:var(--clay-line); }
  .ibtn svg { width:13px; height:13px; }

  /* add button */
  .add {
    display:flex; align-items:center; justify-content:center; gap:6px;
    width:calc(100% - 4px); margin:7px 2px 2px; padding:6px;
    background:transparent; border:1px dashed var(--clay-line);
    border-radius:6px; color:var(--clay-bright); cursor:pointer;
    font-family:var(--font-ui); font-size:11px; font-weight:600;
    letter-spacing:.02em;
    transition:background .13s ease,border-color .13s ease;
  }
  .add:hover { background:var(--clay-ghost); border-style:solid; border-color:var(--clay); }
  .add svg { width:13px; height:13px; }

  /* model button group under the add button */
  .addgrp { display:flex; gap:4px; margin:4px 2px 2px; }
  .addgrp .add.sm {
    flex:1; width:auto; margin:0; padding:4px 2px;
    font-size:10px; font-weight:500; color:var(--fg-2);
    border-color:var(--border);
  }
  .addgrp .add.sm:hover { color:var(--clay-bright); }

  .fade { animation:fade .24s ease both; }
  @keyframes fade {
    from { opacity:0; transform:translateY(3px); }
    to   { opacity:1; transform:none; }
  }
`;

/** Build the full webview document. The body is an empty `#root` that the
 *  per-panel script populates from `state` messages posted by the provider.
 *
 *  `codiconUri`, when supplied, is the `asWebviewUri` of the bundled
 *  `dist/codicon/codicon.css`; it is linked so the panel script can render
 *  `<span class="codicon codicon-<id>">` glyphs (used by the Sessions panel to
 *  show each session's tab icon). Loading a stylesheet needs the source host in
 *  `style-src`, and the font it references needs `font-src`. */
export function panelHtml(
  cspSource: string,
  nonce: string,
  script: string,
  codiconUri?: string,
): string {
  const styleSrc = codiconUri ? `${cspSource} 'unsafe-inline'` : `'unsafe-inline'`;
  const fontSrc = codiconUri ? ` font-src ${cspSource};` : '';
  const codiconLink = codiconUri ? `\n<link href="${codiconUri}" rel="stylesheet" />` : '';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${styleSrc};${fontSrc} script-src 'nonce-${nonce}';" />
<style>${panelCss()}</style>${codiconLink}
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
