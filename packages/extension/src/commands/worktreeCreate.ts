import * as vscode from 'vscode';
import * as path from 'path';
import { AddWorktreeOptions, addWorktree, listBranches, listWorktrees } from '../git';
import { SessionManager } from '../sessions';

/** Everything needed to create a worktree, collected from the user. */
export interface WorktreeSpec {
  branch: string;
  target: string;
  opts: AddWorktreeOptions;
}

/** kebab-case slug for branch names derived from a task/issue title. */
export function branchSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'task'
  );
}

export function defaultWorktreePath(repoRoot: string, branch: string): string {
  return path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-${branch.replace(/\//g, '-')}`,
  );
}

async function promptWorktreePath(repoRoot: string, branch: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Path for the new worktree',
    value: defaultWorktreePath(repoRoot, branch),
  });
}

/** Pick the base ref for a new branch. Returns `undefined` on cancel and
 *  `''` for the default (current HEAD — addWorktree omits the base arg). */
async function pickBaseBranch(repoRoot: string): Promise<string | undefined> {
  const { local, remote } = await listBranches(repoRoot);
  type Item = vscode.QuickPickItem & { base?: string };
  const items: Item[] = [
    { label: '$(git-commit) Current HEAD', description: 'default', base: '' },
  ];
  if (local.length) {
    items.push({ label: 'Local branches', kind: vscode.QuickPickItemKind.Separator });
    items.push(...local.map((b) => ({ label: `$(git-branch) ${b}`, base: b })));
  }
  if (remote.length) {
    items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
    items.push(...remote.map((r) => ({ label: `$(cloud) ${r.remoteRef}`, base: r.remoteRef })));
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Base branch for the new branch',
  });
  return pick?.base;
}

/** Prompt name + base + path for a worktree on a brand-new branch. */
export async function promptNewBranchWorktree(
  repoRoot: string,
  initialBranch: string,
): Promise<WorktreeSpec | undefined> {
  const branch = await vscode.window.showInputBox({
    prompt: 'Name for the new branch',
    value: initialBranch,
    placeHolder: 'feature/my-thing',
  });
  if (!branch) return undefined;
  const base = await pickBaseBranch(repoRoot);
  if (base === undefined) return undefined;
  const target = await promptWorktreePath(repoRoot, branch);
  if (!target) return undefined;
  return { branch, target, opts: { mode: 'create', base: base || undefined } };
}

/** Full worktree-creation picker: check out an existing local or remote
 *  branch, or create a new branch (with base selection). */
export async function promptWorktree(repoRoot: string): Promise<WorktreeSpec | undefined> {
  const [{ local, remote }, worktrees] = await Promise.all([
    listBranches(repoRoot),
    listWorktrees(repoRoot),
  ]);
  const checkedOut = new Set(worktrees.map((w) => w.branch));
  type Item = vscode.QuickPickItem & { pick?: () => Promise<WorktreeSpec | undefined> };
  const items: Item[] = [
    {
      label: '$(add) Create new branch…',
      pick: () => promptNewBranchWorktree(repoRoot, ''),
    },
  ];
  const availableLocal = local.filter((b) => !checkedOut.has(b));
  if (availableLocal.length) {
    items.push({ label: 'Local branches', kind: vscode.QuickPickItemKind.Separator });
    items.push(
      ...availableLocal.map((b) => ({
        label: `$(git-branch) ${b}`,
        pick: async (): Promise<WorktreeSpec | undefined> => {
          const target = await promptWorktreePath(repoRoot, b);
          return target ? { branch: b, target, opts: { mode: 'checkout' } } : undefined;
        },
      })),
    );
  }
  if (remote.length) {
    items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
    items.push(
      ...remote.map((r) => ({
        label: `$(cloud) ${r.name}`,
        description: r.remoteRef,
        pick: async (): Promise<WorktreeSpec | undefined> => {
          const target = await promptWorktreePath(repoRoot, r.name);
          return target
            ? {
                branch: r.name,
                target,
                opts: { mode: 'checkout-remote', remoteRef: r.remoteRef },
              }
            : undefined;
        },
      })),
    );
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Branch to check out as a new worktree',
    matchOnDescription: true,
  });
  return pick?.pick?.();
}

/** Run the actual `git worktree add` and assign a workbench color. Throws on
 *  git failure — callers show the error in their own context. */
export async function createWorktree(
  repoRoot: string,
  sessionMgr: SessionManager,
  spec: WorktreeSpec,
): Promise<string> {
  await addWorktree(repoRoot, spec.branch, spec.target, spec.opts);
  await sessionMgr.assignColorIfUnset(spec.target);
  return spec.target;
}

/** Success toast with an "Open in New Window" action. */
export async function offerOpen(message: string, target: string): Promise<void> {
  const open = await vscode.window.showInformationMessage(message, 'Open in New Window');
  if (open) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
  }
}
