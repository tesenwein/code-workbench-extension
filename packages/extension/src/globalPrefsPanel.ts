import * as vscode from 'vscode';
import { ClaudeEffort, ClaudeModel, SessionManager } from './sessions';
import {
  GlobalPrefs,
  GlobalPrompt,
  loadGlobalPrefs,
  newPromptId,
  normalizePhaseModels,
  saveGlobalPrefs,
} from './globalPrefs';
import { renderGlobalPrefsHtml } from './globalPrefsPanelHtml';

export class GlobalPrefsPanel {
  private static current: GlobalPrefsPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static async show(_ctx: vscode.ExtensionContext, mgr: SessionManager): Promise<void> {
    if (GlobalPrefsPanel.current) {
      GlobalPrefsPanel.current.panel.reveal();
      return;
    }
    const prefs = await loadGlobalPrefs();
    mgr.setGlobalPrefs(prefs);
    const panel = vscode.window.createWebviewPanel(
      'codeWorkbench.globalPrefs',
      'Code Workbench · Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    GlobalPrefsPanel.current = new GlobalPrefsPanel(panel, mgr);
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private mgr: SessionManager,
  ) {
    panel.webview.html = renderGlobalPrefsHtml(this.state());
    panel.webview.onDidReceiveMessage((m) => this.onMessage(m), undefined, this.disposables);
    this.disposables.push(
      mgr.onDidChange(() => {
        panel.webview.postMessage({ type: 'state', state: this.state() });
      }),
    );
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private state(): GlobalPrefs {
    return this.mgr.getGlobalPrefs();
  }

  private async patch(next: GlobalPrefs): Promise<void> {
    this.mgr.setGlobalPrefs(next);
    try {
      await saveGlobalPrefs(next);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not save Workbench settings: ${(e as Error).message}`);
    }
  }

  private async onMessage(msg: { type: string; value?: unknown }): Promise<void> {
    const cur = this.state();
    if (msg.type === 'ready') {
      this.panel.webview.postMessage({ type: 'state', state: cur });
      return;
    }
    if (msg.type === 'setModel' && typeof msg.value === 'string') {
      await this.patch({
        ...cur,
        defaults: { ...cur.defaults, model: msg.value as ClaudeModel },
      });
    } else if (msg.type === 'setEffort' && typeof msg.value === 'number') {
      const e = Math.max(0, Math.min(4, Math.floor(msg.value))) as ClaudeEffort;
      await this.patch({ ...cur, defaults: { ...cur.defaults, effort: e } });
    } else if (msg.type === 'setYolo' && typeof msg.value === 'boolean') {
      await this.patch({
        ...cur,
        defaults: { ...cur.defaults, yolo: msg.value },
      });
    } else if (msg.type === 'setPhaseModel' && msg.value && typeof msg.value === 'object') {
      const { phase, model } = msg.value as { phase?: string; model?: string };
      if (phase) {
        // normalizePhaseModels drops unknown phases/models, and 'default' means
        // "inherit the phase's built-in model" — store it and let the resolver
        // fall through, rather than deleting the key.
        await this.patch({
          ...cur,
          phaseModels: normalizePhaseModels({ ...cur.phaseModels, [phase]: model }),
        });
      }
    } else if (msg.type === 'setClaudeCommand' && typeof msg.value === 'string') {
      await this.patch({ ...cur, claudeCommand: msg.value });
    } else if (msg.type === 'setYoloArgs' && typeof msg.value === 'string') {
      await this.patch({ ...cur, claudeYoloArgs: msg.value });
    } else if (msg.type === 'setOpenOnStartup' && typeof msg.value === 'boolean') {
      await this.patch({ ...cur, openOnStartup: msg.value });
    } else if (msg.type === 'setLanguage' && typeof msg.value === 'string') {
      await this.patch({ ...cur, language: msg.value });
    } else if (msg.type === 'setCommentLanguage' && typeof msg.value === 'string') {
      await this.patch({ ...cur, commentLanguage: msg.value });
    } else if (msg.type === 'addPrompt') {
      const next: GlobalPrompt = {
        id: newPromptId(),
        name: 'New prompt',
        body: '',
        enabled: true,
      };
      await this.patch({ ...cur, prompts: [...cur.prompts, next] });
    } else if (msg.type === 'updatePrompt' && msg.value && typeof msg.value === 'object') {
      const v = msg.value as Partial<GlobalPrompt> & { id: string };
      const prompts = cur.prompts.map((p) => (p.id === v.id ? { ...p, ...v } : p));
      await this.patch({ ...cur, prompts });
    } else if (msg.type === 'deletePrompt' && typeof msg.value === 'string') {
      await this.patch({
        ...cur,
        prompts: cur.prompts.filter((p) => p.id !== msg.value),
      });
    } else if (msg.type === 'applyMinimalLayout') {
      await vscode.commands.executeCommand('codeWorkbench.applyMinimalLayout');
    } else if (msg.type === 'applyFonts') {
      await vscode.commands.executeCommand('codeWorkbench.applyFonts');
    } else if (msg.type === 'installWorkbenchSkills') {
      const scope = msg.value === 'user' ? 'user' : 'project';
      await vscode.commands.executeCommand('codeWorkbench.installWorkbenchSkills', scope);
    } else if (msg.type === 'installWorkbenchAgents') {
      const scope = msg.value === 'user' ? 'user' : 'project';
      await vscode.commands.executeCommand('codeWorkbench.installWorkbenchAgents', scope);
    } else if (msg.type === 'registerWorkbenchMcp') {
      const scope = msg.value === 'user' ? 'user' : 'project';
      await vscode.commands.executeCommand('codeWorkbench.registerWorkbenchMcpServers', scope);
    } else if (msg.type === 'setSessionPanel' && typeof msg.value === 'string') {
      await vscode.workspace
        .getConfiguration('codeWorkbench')
        .update('sessionPanel', msg.value, vscode.ConfigurationTarget.Global);
    }
  }

  private dispose(): void {
    GlobalPrefsPanel.current = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}
