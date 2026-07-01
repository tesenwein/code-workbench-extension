import * as vscode from 'vscode';
import { patchUserSettingsJson } from '../workspaceFolder';

export function registerLayoutCommands(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.applyFonts', async () => {
      const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
      const UI = "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const G = vscode.ConfigurationTarget.Global;
      const updates: Array<[string, string]> = [
        ['editor.fontFamily', MONO],
        ['terminal.integrated.fontFamily', MONO],
        ['debug.console.fontFamily', MONO],
        ['scm.inputFontFamily', UI],
        ['markdown.preview.fontFamily', UI],
        ['chat.editor.fontFamily', UI],
      ];
      const failed: string[] = [];
      for (const [key, value] of updates) {
        const [section, ...rest] = key.split('.');
        try {
          await vscode.workspace.getConfiguration(section).update(rest.join('.'), value, G);
        } catch (e) {
          failed.push(`${key}: ${(e as Error).message}`);
        }
      }
      if (failed.length) {
        vscode.window.showWarningMessage(`Applied fonts with errors: ${failed.join('; ')}`);
      } else {
        vscode.window.showInformationMessage(
          'Applied Workbench fonts to user settings. Falls back to system fonts if JetBrains Mono / Hanken Grotesk are not installed.',
        );
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.applyMinimalLayout', async () => {
      const G = vscode.ConfigurationTarget.Global;
      const updates: Array<[string, unknown]> = [
        ['workbench.activityBar.location', 'top'],
        ['workbench.layoutControl.enabled', true],
        ['window.commandCenter', false],
        ['breadcrumbs.enabled', false],
        ['editor.minimap.enabled', false],
        ['editor.glyphMargin', false],
        ['workbench.editor.showTabs', 'multiple'],
        ['workbench.sideBar.location', 'left'],
        ['workbench.statusBar.visible', true],
        ['editor.lineNumbers', 'on'],
        ['problems.visibility', false],
        ['workbench.editor.editorActionsLocation', 'default'],
        ['terminal.integrated.defaultLocation', 'editor'],
      ];
      const failed: string[] = [];
      for (const [key, value] of updates) {
        const [section, ...rest] = key.split('.');
        try {
          await vscode.workspace.getConfiguration(section).update(rest.join('.'), value, G);
        } catch (e) {
          failed.push(`${key}: ${(e as Error).message}`);
        }
      }

      // workbench.views.customizations isn't writable via the Configuration API
      // (VS Code manages it internally), so patch the user settings.json file
      // directly. Requires a window reload to take effect.
      try {
        await patchUserSettingsJson((current) => {
          const cur =
            (current['workbench.views.customizations'] as Record<string, unknown> | undefined) ??
            {};
          const viewContainerLocations = {
            ...((cur.viewContainerLocations as Record<string, number>) ?? {}),
            'workbench.view.explorer': 2,
            'workbench.view.scm': 1,
            codeWorkbench: 0,
          };
          current['workbench.views.customizations'] = {
            ...cur,
            viewContainerLocations,
          };
        });
      } catch (e) {
        failed.push(`workbench.views.customizations: ${(e as Error).message}`);
      }

      if (failed.length) {
        vscode.window.showWarningMessage(
          `Applied minimal layout with errors: ${failed.join('; ')}`,
        );
      } else {
        const choice = await vscode.window.showInformationMessage(
          'Applied minimal layout: Code Workbench left · Files right · Git bottom. Reload to apply view moves.',
          'Reload Window',
        );
        if (choice === 'Reload Window') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      }
    }),
  );
}
