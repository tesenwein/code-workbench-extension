import * as vscode from 'vscode';
import * as path from 'path';
import {
  SessionManager,
  ClaudeModel,
  ClaudeEffort,
  WorktreeColor,
  WORKTREE_COLORS,
} from './sessions';
import { renderPrefsHtml, type PrefsPanelState } from './prefsPanelHtml';
import { installWorkbenchSkills } from './skillsBundle';
import { registerWorkbenchMcpServers } from './mcpRegister';

export class PrefsPanel {
  private static panels = new Map<string, PrefsPanel>();
  private disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext, mgr: SessionManager, worktreePath: string): void {
    const existing = PrefsPanel.panels.get(worktreePath);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'codeWorkbench.prefs',
      `Claude · ${path.basename(worktreePath)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    PrefsPanel.panels.set(worktreePath, new PrefsPanel(panel, ctx, mgr, worktreePath));
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private ctx: vscode.ExtensionContext,
    private mgr: SessionManager,
    private worktreePath: string,
  ) {
    panel.webview.html = renderPrefsHtml(this.worktreePath, this.state());
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), undefined, this.disposables);
    this.disposables.push(
      mgr.onDidChange(() => {
        panel.webview.postMessage({ type: 'state', state: this.state() });
      }),
    );
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private state(): PrefsPanelState {
    const p = this.mgr.getPrefs(this.worktreePath);
    return { model: p.model, effort: p.effort, yolo: p.yolo, color: p.color };
  }

  private async onMessage(msg: { type: string; value?: unknown }): Promise<void> {
    if (msg.type === 'setModel' && typeof msg.value === 'string') {
      await this.mgr.setPrefs(this.worktreePath, {
        model: msg.value as ClaudeModel,
      });
    } else if (msg.type === 'setEffort' && typeof msg.value === 'number') {
      const e = Math.max(0, Math.min(4, Math.floor(msg.value))) as ClaudeEffort;
      await this.mgr.setPrefs(this.worktreePath, { effort: e });
    } else if (msg.type === 'setYolo' && typeof msg.value === 'boolean') {
      await this.mgr.setPrefs(this.worktreePath, { yolo: msg.value });
    } else if (msg.type === 'setColor' && typeof msg.value === 'string') {
      if ((WORKTREE_COLORS as readonly string[]).includes(msg.value)) {
        await this.mgr.setPrefs(this.worktreePath, {
          color: msg.value as WorktreeColor,
        });
      }
    } else if (msg.type === 'installSkills') {
      await this.installSkills();
    } else if (msg.type === 'registerMcp') {
      await this.registerMcp();
    } else if (msg.type === 'ready') {
      this.panel.webview.postMessage({ type: 'state', state: this.state() });
    }
  }

  private async installSkills(): Promise<void> {
    try {
      const { installed, removed } = await installWorkbenchSkills(this.worktreePath);
      const parts: string[] = [];
      if (installed.length) parts.push(`installed ${installed.join(', ')}`);
      if (removed.length) parts.push(`removed legacy ${removed.join(', ')}`);
      const text = `${parts.join('; ') || 'nothing to do'} — .claude/skills`;
      this.panel.webview.postMessage({
        type: 'result',
        target: 'skills',
        ok: true,
        text,
      });
    } catch (e) {
      const text = (e as Error).message;
      this.panel.webview.postMessage({
        type: 'result',
        target: 'skills',
        ok: false,
        text,
      });
      vscode.window.showErrorMessage(`Install skills failed: ${text}`);
    }
  }

  private async registerMcp(): Promise<void> {
    try {
      const result = await registerWorkbenchMcpServers(this.ctx.extensionPath, this.worktreePath);
      const lines = [
        ...result.registered.map((s) => `✓ ${s}`),
        ...result.skipped.map((s) => `– ${s.name} (skipped: ${s.reason})`),
      ];
      const text = `${lines.join('  ') || 'nothing to do'} — .claude.json`;
      this.panel.webview.postMessage({
        type: 'result',
        target: 'mcp',
        ok: true,
        text,
      });
    } catch (e) {
      const text = (e as Error).message;
      this.panel.webview.postMessage({
        type: 'result',
        target: 'mcp',
        ok: false,
        text,
      });
      vscode.window.showErrorMessage(`Register MCP servers failed: ${text}`);
    }
  }

  private dispose(): void {
    PrefsPanel.panels.delete(this.worktreePath);
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}
