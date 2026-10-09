import * as vscode from 'vscode';
import { SessionItem, SessionManager, SessionKind } from '../sessions';
import { CLAUDE_MODEL_VALUES, type ClaudeModel } from '../sessionTypes';
import { pickSessionLaunch } from '../workspaceFolder';

export interface SessionCommandDeps {
  sessionMgr: SessionManager;
  ensureActiveWorktree: () => Promise<string | undefined>;
}

export function registerSessionCommands(
  ctx: vscode.ExtensionContext,
  { sessionMgr, ensureActiveWorktree }: SessionCommandDeps,
): void {
  const newSession = async (kind: SessionKind, model?: ClaudeModel) => {
    const wt = await ensureActiveWorktree();
    if (!wt) return;
    await sessionMgr.create(kind, wt, undefined, model ? { model } : undefined);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.sessions.new', (model?: ClaudeModel) =>
      newSession(
        'claude',
        model !== undefined && CLAUDE_MODEL_VALUES.includes(model) ? model : undefined,
      ),
    ),
    vscode.commands.registerCommand('codeWorkbench.sessions.newYolo', () =>
      newSession('claude-yolo'),
    ),
    vscode.commands.registerCommand('codeWorkbench.sessions.newShell', () => newSession('shell')),
    vscode.commands.registerCommand('codeWorkbench.sessions.newPlan', async () => {
      const wt = await ensureActiveWorktree();
      if (!wt) return;
      await sessionMgr.create('claude', wt, undefined, { permissionMode: 'plan' });
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.newFromEditor', async () => {
      const launch = await pickSessionLaunch();
      if (!launch) return;
      const wt = await ensureActiveWorktree();
      if (!wt) return;
      if (launch.kind === 'profile') {
        await sessionMgr.create('shell', wt, launch.profile);
      } else {
        await sessionMgr.create(launch.kind, wt);
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.open', (item: SessionItem) => {
      if (!item) return;
      void sessionMgr.open(item.session);
    }),

    // By id (not item): the Tasks panel's "running in" chip only knows the id.
    vscode.commands.registerCommand('codeWorkbench.sessions.focus', (sessionId?: string) => {
      const session = sessionMgr.list().find((s) => s.id === sessionId);
      if (session) void sessionMgr.open(session);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.rename', async (item: SessionItem) => {
      if (!item) return;
      const next = await vscode.window.showInputBox({
        prompt: 'Rename session',
        value: item.session.title,
      });
      if (!next) return;
      await sessionMgr.rename(item.session.id, next);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.close', async (item: SessionItem) => {
      if (!item) return;
      await sessionMgr.close(item.session.id);
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.closeInactive', async () => {
      const worktree = sessionMgr.getActiveWorktree();
      const removed = await sessionMgr.closeInactive(worktree);
      if (removed === 0) {
        void vscode.window.showInformationMessage('No inactive sessions to remove.');
      } else {
        void vscode.window.showInformationMessage(
          `Removed ${removed} inactive session${removed === 1 ? '' : 's'}.`,
        );
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.sessions.setIcon', async (item: SessionItem) => {
      if (!item) return;
      const presets: Array<{
        label: string;
        description?: string;
        id: string | undefined;
      }> = [
        {
          label: '$(sparkle) sparkle',
          description: 'default (Claude)',
          id: 'sparkle',
        },
        {
          label: '$(terminal) terminal',
          description: 'default (Shell)',
          id: 'terminal',
        },
        { label: '$(rocket) rocket', id: 'rocket' },
        { label: '$(beaker) beaker', id: 'beaker' },
        { label: '$(bug) bug', id: 'bug' },
        { label: '$(zap) zap', id: 'zap' },
        { label: '$(flame) flame', id: 'flame' },
        { label: '$(star-full) star-full', id: 'star-full' },
        { label: '$(heart) heart', id: 'heart' },
        { label: '$(robot) robot', id: 'robot' },
        { label: '$(tools) tools', id: 'tools' },
        { label: '$(gear) gear', id: 'gear' },
        { label: '$(flask) flask', id: 'flask' },
        { label: '$(lightbulb) lightbulb', id: 'lightbulb' },
        { label: '$(eye) eye', id: 'eye' },
        { label: '$(pulse) pulse', id: 'pulse' },
        {
          label: '$(symbol-misc) Other…',
          description: 'enter a codicon name',
          id: undefined,
        },
        { label: '$(discard) Reset to default', id: '' },
      ];
      const pick = await vscode.window.showQuickPick(presets, {
        placeHolder: 'Choose a tab icon (codicon)',
      });
      if (!pick) return;
      let next: string | undefined;
      if (pick.id === '') {
        next = undefined;
      } else if (pick.id === undefined) {
        const typed = await vscode.window.showInputBox({
          prompt: 'Codicon id (see https://microsoft.github.io/vscode-codicons/dist/codicon.html)',
          placeHolder: 'e.g. rocket',
        });
        if (typed === undefined) return;
        next = typed.trim() || undefined;
      } else {
        next = pick.id;
      }
      const stillLive = await sessionMgr.setIcon(item.session.id, next);
      if (stillLive) {
        void vscode.window.showInformationMessage(
          'Icon saved. Reopen the session to see the new tab icon.',
        );
      }
    }),
  );
}
