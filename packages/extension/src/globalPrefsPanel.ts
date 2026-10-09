import * as vscode from 'vscode';
import { clampEffort, ClaudeModel, SessionManager } from './sessions';
import {
  GlobalPrefs,
  GlobalPrompt,
  loadGlobalPrefs,
  newPromptId,
  normalizePhaseModels,
  saveGlobalPrefs,
} from './globalPrefs';
import { renderGlobalPrefsHtml } from './globalPrefsPanelHtml';
import { errorMessage } from './errors';
import { StatePanelBase } from './statePanelBase';

/** Prefs as shown in the panel: the stored file plus VS Code settings it mirrors. */
type PanelState = GlobalPrefs & { prefetchContext?: boolean };

export class GlobalPrefsPanel extends StatePanelBase<PanelState> {
  private static current: GlobalPrefsPanel | undefined;

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

  private constructor(panel: vscode.WebviewPanel, mgr: SessionManager) {
    super(panel, mgr);
    this.start();
  }

  protected renderHtml(): string {
    return renderGlobalPrefsHtml(this.state());
  }

  protected state(): PanelState {
    return {
      ...this.mgr.getGlobalPrefs(),
      prefetchContext: vscode.workspace
        .getConfiguration('codeWorkbench')
        .get<boolean>('taskFlow.prefetchContext', true),
    };
  }

  private async patch(withMirrored: PanelState): Promise<void> {
    // Mirrored settings live in VS Code config, never in the prefs file.
    const { prefetchContext: _mirrored, ...next } = withMirrored;
    this.mgr.setGlobalPrefs(next);
    try {
      await saveGlobalPrefs(next);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not save Workbench settings: ${errorMessage(e)}`);
    }
  }

  protected async onMessage(msg: { type: string; value?: unknown }): Promise<void> {
    const cur = this.state();
    if (msg.type === 'ready') {
      this.postState();
      return;
    }
    if (msg.type === 'setModel' && typeof msg.value === 'string') {
      await this.patch({
        ...cur,
        defaults: { ...cur.defaults, model: msg.value as ClaudeModel },
      });
    } else if (msg.type === 'setEffort' && typeof msg.value === 'number') {
      const e = clampEffort(msg.value);
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
    } else if (msg.type === 'setPrefetchContext' && typeof msg.value === 'boolean') {
      await vscode.workspace
        .getConfiguration('codeWorkbench')
        .update('taskFlow.prefetchContext', msg.value, vscode.ConfigurationTarget.Global);
      this.postState();
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

  protected onDisposed(): void {
    GlobalPrefsPanel.current = undefined;
  }
}
