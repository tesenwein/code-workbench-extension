import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { addWorktree, gitRaw, listWorktrees, mergedWorktrees, Worktree } from '../git';

const pExecFile = promisify(execFile);

/** A git branch ref safe to pass as a CLI argument: no leading dash (which a
 *  CLI would read as a flag), no whitespace, no shell metacharacters. */
function isSafeBranchName(branch: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(branch) && !branch.startsWith('-');
}

/** Whether the GitHub CLI is installed and on PATH. */
async function hasGh(): Promise<boolean> {
  try {
    await pExecFile('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Build an `https://github.com/<owner>/<repo>` URL from the origin remote,
 *  handling both SSH (`git@github.com:o/r.git`) and HTTPS remotes. */
async function githubRepoUrl(cwd: string): Promise<string | null> {
  let remote: string;
  try {
    remote = (await gitRaw(cwd, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    return null;
  }
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
import { WorktreeItem, WorktreesProvider } from '../worktreesView';
import { TasksProvider } from '../tasksView';
import { CLAUDE_MODELS, SessionManager } from '../sessions';
import { listTasks, updateTask } from '../tasks';
import { PrefsPanel } from '../prefsPanel';
import {
  ensureWorktreeWindowTitle,
  openWorkspaceFolder,
  pickSessionLaunch,
  pickWorktreeAndActivate,
} from '../workspaceFolder';

export interface PendingRemoval {
  repoKey: string;
  repoRoot: string;
  worktreePath: string;
}

export interface WorktreeCommandDeps {
  getRepoRoot: () => string | undefined;
  getRepoKey: () => string | undefined;
  sessionMgr: SessionManager;
  worktreesProvider: WorktreesProvider;
  tasksProvider: TasksProvider;
  performWorktreeRemoval: (
    ctx: vscode.ExtensionContext,
    sessionMgr: SessionManager,
    repoRoot: string,
    repoKey: string,
    worktreePath: string,
  ) => Promise<void>;
  pendingRemovalKey: string;
}

export function registerWorktreeCommands(
  ctx: vscode.ExtensionContext,
  deps: WorktreeCommandDeps,
): void {
  const {
    getRepoRoot,
    getRepoKey,
    sessionMgr,
    worktreesProvider,
    tasksProvider,
    performWorktreeRemoval,
    pendingRemovalKey,
  } = deps;

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.worktrees.refresh', () =>
      worktreesProvider.refresh(),
    ),

    vscode.commands.registerCommand('codeWorkbench.worktrees.add', async () => {
      const repoRoot = getRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      const branch = await vscode.window.showInputBox({
        prompt: 'Branch name for the new worktree',
        placeHolder: 'feature/my-thing',
      });
      if (!branch) return;
      const defaultPath = path.join(
        path.dirname(repoRoot),
        `${path.basename(repoRoot)}-${branch.replace(/\//g, '-')}`,
      );
      const target = await vscode.window.showInputBox({
        prompt: 'Path for the new worktree',
        value: defaultPath,
      });
      if (!target) return;
      const createChoice = await vscode.window.showQuickPick(
        [
          {
            label: 'Use existing branch (if present, otherwise create)',
            value: false,
          },
          { label: 'Force create new branch', value: true },
        ],
        { placeHolder: 'Branch strategy' },
      );
      if (!createChoice) return;
      try {
        await addWorktree(repoRoot, branch, target, {
          createBranch: createChoice.value,
        });
        await sessionMgr.assignColorIfUnset(target);
        worktreesProvider.refresh();
        const open = await vscode.window.showInformationMessage(
          `Worktree created at ${target}`,
          'Open in New Window',
        );
        if (open) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Add worktree failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.worktrees.addWithTask', async () => {
      const repoRoot = getRepoRoot();
      const repoKey = getRepoKey();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      if (!repoKey) return;
      const all = await listTasks(repoKey);
      const unassigned = all.filter((t) => !t.worktree && t.status !== 'done');
      if (unassigned.length === 0) {
        vscode.window.showInformationMessage(
          'No unassigned tasks. Create a task first, then add a worktree for it.',
        );
        return;
      }
      // Build subtree structure over the unassigned tasks so a parent and its
      // descendants can be picked together.
      const byId = new Map(unassigned.map((t) => [t.id, t]));
      const childMap = new Map<string, typeof unassigned>();
      for (const t of unassigned) {
        if (t.parentId && byId.has(t.parentId)) {
          if (!childMap.has(t.parentId)) childMap.set(t.parentId, []);
          childMap.get(t.parentId)!.push(t);
        }
      }
      // Collect a task and all of its descendants within the unassigned set.
      const collectSubtree = (id: string, acc: Set<string>): Set<string> => {
        if (acc.has(id)) return acc;
        acc.add(id);
        for (const child of childMap.get(id) ?? []) collectSubtree(child.id, acc);
        return acc;
      };
      // Only top-level tasks are pickable; subtasks are assigned automatically
      // with their parent.
      const topLevel = unassigned.filter((t) => !t.parentId || !byId.has(t.parentId));
      const picks = await vscode.window.showQuickPick(
        topLevel.map((t) => {
          const childCount = collectSubtree(t.id, new Set<string>());
          const subtaskCount = childCount.size - 1;
          return {
            label: t.title,
            description: `[${t.priority}] [${t.status}]${
              subtaskCount > 0 ? ` (+${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'})` : ''
            }`,
            task: t,
          };
        }),
        {
          placeHolder: 'Pick task(s) — subtasks are assigned automatically',
          canPickMany: true,
        },
      );
      if (!picks || picks.length === 0) return;
      // Expand each pick to include its subtree.
      const selectedIds = new Set<string>();
      for (const p of picks) collectSubtree(p.task.id, selectedIds);
      const selected = unassigned.filter((t) => selectedIds.has(t.id));
      const slug =
        picks[0].task.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50) || 'task';
      const branch = await vscode.window.showInputBox({
        prompt: 'Branch name for the new worktree',
        value: `feature/${slug}`,
      });
      if (!branch) return;
      const defaultPath = path.join(
        path.dirname(repoRoot),
        `${path.basename(repoRoot)}-${branch.replace(/\//g, '-')}`,
      );
      const target = await vscode.window.showInputBox({
        prompt: 'Path for the new worktree',
        value: defaultPath,
      });
      if (!target) return;
      try {
        await addWorktree(repoRoot, branch, target, { createBranch: true });
        await sessionMgr.assignColorIfUnset(target);
        for (const t of selected) {
          await updateTask(repoKey, t.id, { worktree: target });
        }
        worktreesProvider.refresh();
        tasksProvider.refresh();
        const open = await vscode.window.showInformationMessage(
          `Worktree created at ${target} with ${selected.length} task(s) assigned`,
          'Open in New Window',
        );
        if (open) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Add worktree with task failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.remove',
      async (item: WorktreeItem) => {
        const repoRoot = getRepoRoot();
        const repoKey = getRepoKey();
        if (!repoRoot || !item) return;
        if (item.wt.isMain) {
          vscode.window.showWarningMessage('Cannot remove the main worktree.');
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Remove worktree at ${item.wt.path}?`,
          { modal: true },
          'Remove',
        );
        if (confirm !== 'Remove') return;

        // If the doomed worktree is the workspace folder VS Code currently has
        // open, deleting it from underneath the editor causes git failures and
        // leaves the window pointed at a missing path. Defer: switch to main
        // first (reloads the host) and complete removal on next activation.
        const folders = vscode.workspace.workspaceFolders ?? [];
        const isOpenHere = folders.some((f) => f.uri.fsPath === item.wt.path);
        if (isOpenHere) {
          if (!repoKey) {
            vscode.window.showErrorMessage('Cannot determine repo key for deferred removal.');
            return;
          }
          let trees: Worktree[];
          try {
            trees = await listWorktrees(repoRoot);
          } catch (err) {
            vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
            return;
          }
          const main = trees.find((w) => w.isMain && w.path !== item.wt.path);
          const fallback = main ?? trees.find((w) => w.path !== item.wt.path);
          if (!fallback) {
            vscode.window.showErrorMessage(
              'No other worktree to switch to before removal — leave this worktree first.',
            );
            return;
          }
          await ctx.globalState.update(pendingRemovalKey, {
            repoKey,
            repoRoot,
            worktreePath: item.wt.path,
          } satisfies PendingRemoval);
          await openWorkspaceFolder(fallback.path);
          return;
        }

        try {
          if (!repoKey) return;
          await performWorktreeRemoval(ctx, sessionMgr, repoRoot, repoKey, item.wt.path);
          const newActive = await sessionMgr.reassignActiveAfterRemoval(repoRoot);
          if (newActive) await openWorkspaceFolder(newActive);
          worktreesProvider.refresh();
          tasksProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
        }
      },
    ),

    vscode.commands.registerCommand('codeWorkbench.worktrees.cleanupMerged', async () => {
      const repoRoot = getRepoRoot();
      const repoKey = getRepoKey();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      if (!repoKey) return;

      let merged: Worktree[];
      try {
        merged = await mergedWorktrees(repoRoot);
      } catch (err) {
        vscode.window.showErrorMessage(`Cleanup failed: ${(err as Error).message}`);
        return;
      }
      // The worktree open in this window can't be removed in-place (it needs
      // the deferred reload path). Exclude it from the bulk picker.
      const folders = vscode.workspace.workspaceFolders ?? [];
      const candidates = merged.filter((wt) => !folders.some((f) => f.uri.fsPath === wt.path));
      if (candidates.length === 0) {
        vscode.window.showInformationMessage(
          merged.length
            ? 'The only merged worktree is open in this window — switch away to remove it.'
            : 'No merged worktrees to clean up.',
        );
        return;
      }

      const picks = await vscode.window.showQuickPick(
        candidates.map((wt) => ({
          label: `$(git-branch) ${path.basename(wt.path)}`,
          description: wt.branch,
          detail: wt.uncommittedCount
            ? `${wt.path}  —  ●${wt.uncommittedCount} uncommitted file(s)`
            : wt.path,
          wt,
          // Pre-check clean worktrees; leave dirty ones for an explicit opt-in.
          picked: !wt.uncommittedCount,
        })),
        {
          canPickMany: true,
          placeHolder: `Select merged worktrees to remove (${candidates.length} found)`,
        },
      );
      if (!picks || picks.length === 0) return;

      const confirm = await vscode.window.showWarningMessage(
        `Remove ${picks.length} merged worktree${picks.length === 1 ? '' : 's'}? This deletes the working directories.`,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') return;

      let removed = 0;
      const failures: string[] = [];
      for (const p of picks) {
        try {
          await performWorktreeRemoval(ctx, sessionMgr, repoRoot, repoKey, p.wt.path);
          removed++;
        } catch (err) {
          failures.push(`${path.basename(p.wt.path)}: ${(err as Error).message}`);
        }
      }
      const newActive = await sessionMgr.reassignActiveAfterRemoval(repoRoot);
      if (newActive) await openWorkspaceFolder(newActive);
      worktreesProvider.refresh();
      tasksProvider.refresh();
      if (failures.length) {
        vscode.window.showErrorMessage(`Removed ${removed}; failed: ${failures.join('; ')}`);
      } else {
        vscode.window.showInformationMessage(
          `Removed ${removed} merged worktree${removed === 1 ? '' : 's'}.`,
        );
      }
    }),

    vscode.commands.registerCommand('codeWorkbench.worktrees.open', async (item: WorktreeItem) => {
      if (!item) return;
      await ensureWorktreeWindowTitle(item.wt);
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(item.wt.path),
        true,
      );
    }),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.openHere',
      async (item: WorktreeItem) => {
        if (!item) return;
        await ensureWorktreeWindowTitle(item.wt);
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(item.wt.path),
          false,
        );
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.reveal',
      async (item: WorktreeItem) => {
        if (!item) return;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.wt.path));
      },
    ),

    vscode.commands.registerCommand('codeWorkbench.worktrees.switch', async () => {
      const repoRoot = getRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      await pickWorktreeAndActivate(repoRoot, sessionMgr);
    }),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.spawnHere',
      async (item: WorktreeItem) => {
        if (!item) return;
        // Open the session as a terminal in the current window, rooted at the
        // selected worktree's directory — no new VS Code window.
        const launch = await pickSessionLaunch();
        if (!launch) return;
        if (launch.kind === 'profile') {
          await sessionMgr.create('shell', item.wt.path, launch.profile);
        } else {
          await sessionMgr.create(launch.kind, item.wt.path);
        }
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.setModel',
      async (item: WorktreeItem) => {
        if (!item) return;
        const choice = await vscode.window.showQuickPick(
          CLAUDE_MODELS.map((m) => ({ label: m.label, value: m.value })),
          { placeHolder: `Default model for ${path.basename(item.wt.path)}` },
        );
        if (!choice) return;
        await sessionMgr.setPrefs(item.wt.path, { model: choice.value });
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.toggleYolo',
      async (item: WorktreeItem) => {
        if (!item) return;
        const cur = sessionMgr.getPrefs(item.wt.path);
        await sessionMgr.setPrefs(item.wt.path, { yolo: !cur.yolo });
        vscode.window.showInformationMessage(
          `${path.basename(item.wt.path)}: yolo ${!cur.yolo ? 'on' : 'off'}`,
        );
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.configure',
      async (item?: WorktreeItem) => {
        const wt = item?.wt.path ?? sessionMgr.getActiveWorktree() ?? getRepoRoot();
        if (!wt) {
          vscode.window.showWarningMessage('No worktree to configure.');
          return;
        }
        PrefsPanel.show(ctx, sessionMgr, wt);
      },
    ),

    vscode.commands.registerCommand(
      'codeWorkbench.worktrees.openPR',
      async (item: WorktreeItem) => {
        if (!item) return;
        const { path: cwd, branch, isMain } = item.wt;
        if (isMain || branch === '(detached)' || branch === '(unknown)') {
          vscode.window.showWarningMessage(
            'Open PR needs a feature branch — not the main or a detached worktree.',
          );
          return;
        }
        if (!isSafeBranchName(branch)) {
          vscode.window.showWarningMessage(
            `Branch name "${branch}" contains unsupported characters.`,
          );
          return;
        }

        // Preferred path: the gh CLI. Open an existing PR for the branch, or
        // start a new one in the browser if none exists yet.
        if (await hasGh()) {
          try {
            await pExecFile('gh', ['pr', 'view', branch, '--web'], { cwd });
            return;
          } catch {
            // No PR yet — fall through to creating one.
          }
          try {
            await pExecFile('gh', ['pr', 'create', '--web', '--head', branch], {
              cwd,
            });
            return;
          } catch (err) {
            vscode.window.showErrorMessage(`gh pr create failed: ${(err as Error).message}`);
            return;
          }
        }

        // Fallback: open the GitHub compare page in a browser.
        const repoUrl = await githubRepoUrl(cwd);
        if (!repoUrl) {
          vscode.window.showWarningMessage(
            'Install the GitHub CLI (`gh`) or add a github.com origin remote to open a PR.',
          );
          return;
        }
        const compare = `${repoUrl}/compare/${encodeURIComponent(branch)}?expand=1`;
        await vscode.env.openExternal(vscode.Uri.parse(compare));
      },
    ),

    vscode.commands.registerCommand('codeWorkbench.worktrees.addFromIssue', async () => {
      const repoRoot = getRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Open a git repository first.');
        return;
      }
      if (!(await hasGh())) {
        vscode.window.showWarningMessage(
          'Install the GitHub CLI (`gh`) to create a worktree from an issue.',
        );
        return;
      }

      let issues: { number: number; title: string }[];
      try {
        const { stdout } = await pExecFile(
          'gh',
          ['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title'],
          { cwd: repoRoot },
        );
        issues = JSON.parse(stdout);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to list issues: ${(err as Error).message}`);
        return;
      }
      if (issues.length === 0) {
        vscode.window.showInformationMessage('No open issues found.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        issues.map((i) => ({ label: `#${i.number}: ${i.title}`, issue: i })),
        { placeHolder: 'Pick an issue to create a worktree for' },
      );
      if (!pick) return;

      const slug =
        pick.issue.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50) || 'issue';
      const branch = await vscode.window.showInputBox({
        prompt: `Branch name for issue #${pick.issue.number}`,
        value: `feature/${pick.issue.number}-${slug}`,
      });
      if (!branch) return;
      const defaultPath = path.join(
        path.dirname(repoRoot),
        `${path.basename(repoRoot)}-${branch.replace(/\//g, '-')}`,
      );
      const target = await vscode.window.showInputBox({
        prompt: 'Path for the new worktree',
        value: defaultPath,
      });
      if (!target) return;
      try {
        await addWorktree(repoRoot, branch, target, { createBranch: true });
        await sessionMgr.assignColorIfUnset(target);
        worktreesProvider.refresh();
        const open = await vscode.window.showInformationMessage(
          `Worktree created at ${target} for issue #${pick.issue.number}`,
          'Open in New Window',
        );
        if (open) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Add worktree from issue failed: ${(err as Error).message}`);
      }
    }),
  );
}
