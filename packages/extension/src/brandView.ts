import * as path from 'path';
import * as vscode from 'vscode';
import { SessionManager } from './sessions';
import { themeTokenDecls } from './webviewTheme';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class BrandViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeWorkbench.brand';
  private view?: vscode.WebviewView;

  constructor(private readonly sessionMgr: SessionManager) {
    sessionMgr.onDidChange(() => this.update());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    view.webview.html = this.render();
  }

  update(): void {
    if (this.view) this.view.webview.html = this.render();
  }

  private activeLabel(): string {
    const wt = this.sessionMgr.getActiveWorktree();
    return wt ? path.basename(wt) : 'no worktree';
  }

  private render(): string {
    const active = escapeHtml(this.activeLabel());
    return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {${themeTokenDecls('sidebar')}
    --bg-glow: color-mix(in srgb, var(--clay) 14%, var(--bg-0));
  }
  html, body { margin: 0; padding: 0; height: 100%; background: var(--bg-1); overflow: hidden; }
  body {
    position: relative;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  body::before {
    content: '';
    position: absolute;
    top: -28px;
    left: -20px;
    width: 240px;
    height: 180px;
    background: radial-gradient(circle at 30% 35%, var(--bg-glow), transparent 70%);
    opacity: 0.6;
    pointer-events: none;
  }
  body::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.03;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  }
  .wrap {
    position: relative;
    padding: 10px 12px 12px;
    border-bottom: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    white-space: nowrap;
    overflow: hidden;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .spark {
    font-size: 15px;
    line-height: 1;
    color: var(--clay);
    transform: translateY(1px);
    animation: spark-breathe 4.5s ease-in-out infinite;
    text-shadow: 0 0 14px var(--clay-line);
    flex: 0 0 auto;
  }
  @keyframes spark-breathe {
    0%, 100% { opacity: 0.78; transform: translateY(1px) rotate(0deg) scale(1); }
    50%      { opacity: 1;    transform: translateY(1px) rotate(45deg) scale(1.12); }
  }
  .name {
    font-family: var(--font-serif);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--fg-0);
    flex: 0 0 auto;
  }
  .name em {
    font-style: italic;
    color: var(--clay-bright);
    font-weight: 400;
  }
  .wt {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--clay-bright);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    padding-left: 24px;
    letter-spacing: 0.02em;
  }
  .wrap.empty .wt { color: var(--fg-2); opacity: 0.6; font-style: italic; font-family: var(--font-ui); }
</style>
</head>
<body>
  <div class="wrap${this.sessionMgr.getActiveWorktree() ? '' : ' empty'}">
    <div class="brand">
      <span class="spark">✳</span>
      <span class="name">Code <em>Workbench</em></span>
    </div>
    <div class="wt">${active}</div>
  </div>
</body>
</html>`;
  }
}
