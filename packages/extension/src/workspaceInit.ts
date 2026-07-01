import { promises as fs } from 'fs';
import * as path from 'path';
import { DOT_DIR, LOCAL_SUBDIR } from './tasks';

/** Per-worktree status bar palette.
 *  Only the bottom status bar is tinted — the activity bar, side bar and
 *  title bar are left to the theme (see LEGACY_COLOR_KEYS, which strips any
 *  tints earlier versions wrote there). Each color is a distinct, clearly
 *  readable hue so the status bar signals which worktree the window is in,
 *  matching the vivid icon/terminal-tab coloring used elsewhere. */
interface WorktreePalette {
  statusBarBg: string; // bottom strip background
  fg: string; // text on the status bar
}

/** Distinct dark-but-saturated backgrounds, one per worktree color. Dark
 *  enough for the light `fg` to stay legible, far enough apart in hue to be
 *  told apart at a glance. */
const WORKTREE_PALETTES: Record<string, WorktreePalette> = {
  red: { statusBarBg: '#6e3434', fg: '#f0e6d4' },
  green: { statusBarBg: '#3d5a32', fg: '#f0e6d4' },
  yellow: { statusBarBg: '#6b5420', fg: '#f0e6d4' },
  blue: { statusBarBg: '#33506e', fg: '#f0e6d4' },
  magenta: { statusBarBg: '#5e3458', fg: '#f0e6d4' },
  cyan: { statusBarBg: '#2f5a5a', fg: '#f0e6d4' },
};

/** Build the `workbench.colorCustomizations` map for a worktree palette.
 *  Returns a flat record of vscode color keys → hex assignments. */
function paletteAssignments(p: WorktreePalette): Record<string, string> {
  return {
    'statusBar.background': p.statusBarBg,
    'statusBar.foreground': p.fg,
    'statusBar.border': p.statusBarBg,
    'statusBar.noFolderBackground': p.statusBarBg,
    'statusBar.debuggingBackground': p.statusBarBg,
    'statusBarItem.remoteBackground': p.statusBarBg,
    'statusBarItem.remoteForeground': p.fg,
  };
}

/** Legacy keys earlier versions of this extension wrote into worktree
 *  settings (activity bar + side bar tints). We strip these on every write
 *  so existing checkouts converge on the current scoped palette. */
const LEGACY_COLOR_KEYS = [
  'activityBar.background',
  'activityBar.foreground',
  'activityBar.inactiveForeground',
  'activityBar.border',
  'activityBarBadge.background',
  'activityBarBadge.foreground',
  'sideBar.background',
  'sideBar.foreground',
  'sideBar.border',
  'sideBarSectionHeader.background',
  'sideBarSectionHeader.foreground',
  'sideBarTitle.foreground',
  'titleBar.activeBackground',
  'titleBar.activeForeground',
  'titleBar.inactiveBackground',
  'titleBar.inactiveForeground',
  'titleBar.border',
];

/** Workbench color keys this extension manages. Overwritten on color change
 *  and stripped when the worktree resets to the default color. */
const MANAGED_COLOR_KEYS = [
  ...Object.keys(paletteAssignments(WORKTREE_PALETTES.red)),
  ...LEGACY_COLOR_KEYS,
];

/** Write per-worktree status/activity-bar colors to .vscode/settings.json.
 *  Preserves other settings; only mutates the keys listed in MANAGED_COLOR_KEYS
 *  under `workbench.colorCustomizations`. If the file exists but cannot be
 *  parsed as strict JSON (e.g. contains JSONC comments), this is a no-op so
 *  user edits are never clobbered. */
export async function writeWorktreeWorkspaceColors(
  worktreePath: string,
  color: string,
): Promise<void> {
  const vscodeDir = path.join(worktreePath, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  let hadFile = false;
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    hadFile = true;
    if (raw.trim()) {
      try {
        settings = JSON.parse(raw);
      } catch {
        return; // JSONC or invalid — don't risk clobbering user content
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }

  const customizations =
    (settings['workbench.colorCustomizations'] as Record<string, unknown>) ?? {};

  // Always strip legacy keys so old activity/side-bar tints clear out.
  for (const k of LEGACY_COLOR_KEYS) delete customizations[k];

  const palette = WORKTREE_PALETTES[color];
  if (!palette) {
    for (const k of MANAGED_COLOR_KEYS) delete customizations[k];
  } else {
    const assignments = paletteAssignments(palette);
    for (const [k, v] of Object.entries(assignments)) customizations[k] = v;
  }

  if (Object.keys(customizations).length === 0) {
    delete settings['workbench.colorCustomizations'];
  } else {
    settings['workbench.colorCustomizations'] = customizations;
  }

  // Nothing to write & no pre-existing file → skip creating an empty settings file.
  if (!hadFile && Object.keys(settings).length === 0) return;

  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

export type InitStepStatus = 'created' | 'ok' | 'skipped' | 'error';
export interface InitStep {
  name: string;
  path: string;
  status: InitStepStatus;
  detail?: string;
}
export interface WorkspaceInitResult {
  repoPath: string;
  steps: InitStep[];
}

const GITIGNORE_ENTRY = `${DOT_DIR}/`;

function projectDotDir(repoPath: string): string {
  return path.join(repoPath, DOT_DIR);
}

function projectLocalDir(repoPath: string): string {
  return path.join(projectDotDir(repoPath), LOCAL_SUBDIR);
}

async function ensureDir(dir: string): Promise<InitStepStatus> {
  try {
    const st = await fs.stat(dir);
    return st.isDirectory() ? 'ok' : 'error';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(dir, { recursive: true });
      return 'created';
    }
    throw e;
  }
}

async function ensureRepoGitignore(repoPath: string): Promise<InitStep> {
  const giPath = path.join(repoPath, '.gitignore');
  let current: string | null = null;
  try {
    current = await fs.readFile(giPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        name: 'gitignore',
        path: giPath,
        status: 'error',
        detail: String(e),
      };
    }
  }
  if (current === null) {
    await fs.writeFile(giPath, `${GITIGNORE_ENTRY}\n`, 'utf8');
    return { name: 'gitignore', path: giPath, status: 'created' };
  }
  const lines = current.split('\n').map((l) => l.trim());
  if (lines.includes(GITIGNORE_ENTRY) || lines.includes(DOT_DIR)) {
    return { name: 'gitignore', path: giPath, status: 'ok' };
  }
  const sep = current.endsWith('\n') ? '' : '\n';
  await fs.writeFile(giPath, current + sep + GITIGNORE_ENTRY + '\n', 'utf8');
  return {
    name: 'gitignore',
    path: giPath,
    status: 'ok',
    detail: `appended ${GITIGNORE_ENTRY}`,
  };
}

async function ensureLocalReadme(localDir: string): Promise<InitStep> {
  const p = path.join(localDir, 'README.md');
  try {
    await fs.access(p);
    return { name: 'local-readme', path: p, status: 'ok' };
  } catch {
    const body =
      '# .code-workbench/local/\n\n' +
      'Machine-specific Code Workbench state. Gitignored.\n' +
      'Do not commit anything in this folder.\n';
    await fs.writeFile(p, body, 'utf8');
    return { name: 'local-readme', path: p, status: 'created' };
  }
}

export async function initProjectWorkspace(repoPath: string): Promise<WorkspaceInitResult> {
  const steps: InitStep[] = [];
  const dot = projectDotDir(repoPath);
  const local = projectLocalDir(repoPath);

  try {
    steps.push({ name: 'dot-dir', path: dot, status: await ensureDir(dot) });
  } catch (e) {
    steps.push({
      name: 'dot-dir',
      path: dot,
      status: 'error',
      detail: String(e),
    });
    return { repoPath, steps };
  }

  try {
    steps.push({
      name: 'local-dir',
      path: local,
      status: await ensureDir(local),
    });
  } catch (e) {
    steps.push({
      name: 'local-dir',
      path: local,
      status: 'error',
      detail: String(e),
    });
  }

  try {
    steps.push(await ensureRepoGitignore(repoPath));
  } catch (e) {
    steps.push({
      name: 'gitignore',
      path: path.join(repoPath, '.gitignore'),
      status: 'error',
      detail: String(e),
    });
  }

  try {
    steps.push(await ensureLocalReadme(local));
  } catch (e) {
    steps.push({
      name: 'local-readme',
      path: path.join(local, 'README.md'),
      status: 'error',
      detail: String(e),
    });
  }

  return { repoPath, steps };
}
