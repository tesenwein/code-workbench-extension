import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { listWorktrees, Worktree } from './git';
import { SessionKind, SessionManager, SessionProfile } from './sessions';

export async function pickWorktreeAndActivate(
  repoRoot: string,
  sessionMgr: SessionManager,
): Promise<string | undefined> {
  let trees: Worktree[];
  try {
    trees = await listWorktrees(repoRoot);
  } catch (err) {
    vscode.window.showErrorMessage(`Worktrees: ${(err as Error).message}`);
    return undefined;
  }
  const active = sessionMgr.getActiveWorktree();
  const items = trees.map((wt) => {
    const sessions = sessionMgr.listForWorktree(wt.path).length;
    const dirty = wt.uncommittedCount ? ` ●${wt.uncommittedCount}` : '';
    const sess = sessions ? ` · ${sessions} session${sessions === 1 ? '' : 's'}` : '';
    return {
      label: `${wt.path === active ? '$(star-full) ' : '$(git-branch) '}${path.basename(wt.path)}`,
      description: `${wt.branch}${dirty}${sess}`,
      detail: wt.path,
      wt,
    };
  });
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Switch active worktree',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) return undefined;
  if (choice.wt.path === sessionMgr.getActiveWorktree()) return choice.wt.path;
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(choice.wt.path), true);
  return choice.wt.path;
}

/** Open the given path as the workspace folder in the current window if it
 *  isn't already. This reloads the window. No-op if already the folder. */
export async function ensureWorktreeWindowTitle(wt: Worktree): Promise<void> {
  try {
    const vscodeDir = path.join(wt.path, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');
    await fs.mkdir(vscodeDir, { recursive: true });
    const folder = path.basename(wt.path);
    const branch = wt.branch || '';
    const title = `✳ ${folder}${branch ? ` · ${branch}` : ''} — Code Workbench\${separator}\${activeEditorShort}`;
    let current: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(settingsPath, 'utf8');
      current = JSON.parse(raw);
    } catch {
      /* no file or invalid — start fresh */
    }
    if (current['window.title'] === title) return;
    current['window.title'] = title;
    await fs.writeFile(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  } catch {
    /* best-effort */
  }
}

/** Resolve the user settings.json path for the running VS Code variant
 *  (Code, Insiders, VSCodium, Cursor, etc) by deriving the user-data directory
 *  from vscode.env.appName. */
export function userSettingsJsonPath(): string {
  const appName = vscode.env.appName || 'Code';
  const folderMap: Record<string, string> = {
    'Visual Studio Code': 'Code',
    'Visual Studio Code - Insiders': 'Code - Insiders',
    'Visual Studio Code - Exploration': 'Code - Exploration',
    VSCodium: 'VSCodium',
    'VSCodium - Insiders': 'VSCodium - Insiders',
    Cursor: 'Cursor',
    Windsurf: 'Windsurf',
  };
  const folder = folderMap[appName] ?? appName;
  const home = os.homedir();
  let base: string;
  if (process.platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support', folder);
  } else if (process.platform === 'win32') {
    base = path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), folder);
  } else {
    base = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), folder);
  }
  return path.join(base, 'User', 'settings.json');
}

/** Read user settings.json, apply the patch in-place, and write it back.
 *  Tolerates a missing file or empty contents. Preserves keys not touched. */
export async function patchUserSettingsJson(
  patch: (current: Record<string, unknown>) => void,
): Promise<void> {
  const settingsPath = userSettingsJsonPath();
  let current: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    if (raw.trim()) current = JSON.parse(raw);
  } catch {
    /* no file — start fresh */
  }
  patch(current);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
}

export async function openWorkspaceFolder(target: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1 && folders[0].uri.fsPath === target) return;
  if (folders.length > 1) {
    if (folders.some((f) => f.uri.fsPath === target)) return;
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: vscode.Uri.file(target),
    });
    return;
  }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), {
    forceNewWindow: false,
  });
}

/** Read and validate the `codeWorkbench.sessionProfiles` setting. Invalid
 *  or incomplete entries are silently dropped. */
export function getSessionProfiles(): SessionProfile[] {
  const cfg = vscode.workspace.getConfiguration('codeWorkbench');
  const raw = cfg.get<unknown[]>('sessionProfiles', []) ?? [];
  const profiles: SessionProfile[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    const command = typeof o.command === 'string' ? o.command.trim() : '';
    if (!label || !command) continue;
    const args = Array.isArray(o.args)
      ? o.args.filter((a): a is string => typeof a === 'string')
      : [];
    let env: Record<string, string> | undefined;
    if (o.env && typeof o.env === 'object') {
      env = {};
      for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
        if (typeof v === 'string') env[k] = v;
      }
    }
    const icon = typeof o.icon === 'string' ? o.icon.trim() || undefined : undefined;
    profiles.push({ label, command, args, env, icon });
  }
  return profiles;
}

export type SessionLaunch = { kind: SessionKind } | { kind: 'profile'; profile: SessionProfile };

/** Quick-pick over the built-in session kinds plus any custom profiles from
 *  the `sessionProfiles` setting. */
export async function pickSessionLaunch(): Promise<SessionLaunch | undefined> {
  const builtins: Array<{
    label: string;
    description?: string;
    launch: SessionLaunch;
  }> = [
    { label: '$(sparkle) Claude', launch: { kind: 'claude' } },
    { label: '$(zap) Claude (yolo)', launch: { kind: 'claude-yolo' } },
    { label: '$(terminal) Shell', launch: { kind: 'shell' } },
  ];
  const profiles = getSessionProfiles().map((p) => ({
    label: `$(${p.icon || 'tools'}) ${p.label}`,
    description: [p.command, ...p.args].join(' '),
    launch: { kind: 'profile' as const, profile: p },
  }));
  const choice = await vscode.window.showQuickPick([...builtins, ...profiles], {
    placeHolder: 'Session kind',
  });
  return choice?.launch;
}
