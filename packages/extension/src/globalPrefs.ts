import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DOT_DIR } from './tasks';
import { CLAUDE_MODEL_VALUES, type ClaudeEffort, type ClaudeModel } from './sessions';

export interface GlobalPrompt {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

export interface GlobalDefaults {
  model: ClaudeModel;
  effort: ClaudeEffort;
  yolo: boolean;
}

export interface GlobalPrefs {
  defaults: GlobalDefaults;
  prompts: GlobalPrompt[];
  claudeCommand: string;
  claudeYoloArgs: string;
  openOnStartup: boolean;
  syncRemoteUrl: string;
  syncBranch: string;
}

export const DEFAULT_GLOBAL_PREFS: GlobalPrefs = {
  defaults: { model: 'default', effort: 1, yolo: false },
  prompts: [],
  claudeCommand: 'claude',
  claudeYoloArgs: '--dangerously-skip-permissions',
  openOnStartup: true,
  syncRemoteUrl: '',
  syncBranch: 'main',
};

export function globalPrefsDir(): string {
  return path.join(os.homedir(), DOT_DIR);
}

export function globalPrefsPath(): string {
  return path.join(globalPrefsDir(), 'settings.json');
}

function normalize(raw: unknown): GlobalPrefs {
  const r = (raw ?? {}) as Partial<GlobalPrefs>;
  const d = (r.defaults ?? {}) as Partial<GlobalDefaults>;
  const effortNum = Number(d.effort);
  const model = CLAUDE_MODEL_VALUES.includes(d.model as ClaudeModel)
    ? (d.model as ClaudeModel)
    : DEFAULT_GLOBAL_PREFS.defaults.model;
  const effort = (
    Number.isFinite(effortNum)
      ? Math.max(0, Math.min(4, Math.floor(effortNum)))
      : DEFAULT_GLOBAL_PREFS.defaults.effort
  ) as ClaudeEffort;
  const yolo = typeof d.yolo === 'boolean' ? d.yolo : false;

  const prompts: GlobalPrompt[] = Array.isArray(r.prompts)
    ? r.prompts
        .map((p) => ({
          id: typeof p?.id === 'string' && p.id ? p.id : cryptoId(),
          name: typeof p?.name === 'string' ? p.name : '',
          body: typeof p?.body === 'string' ? p.body : '',
          enabled: p?.enabled !== false,
        }))
        .filter((p) => p.name.trim() !== '' || p.body.trim() !== '')
    : [];

  return {
    defaults: { model, effort, yolo },
    prompts,
    claudeCommand:
      typeof r.claudeCommand === 'string' && r.claudeCommand.trim()
        ? r.claudeCommand
        : DEFAULT_GLOBAL_PREFS.claudeCommand,
    claudeYoloArgs:
      typeof r.claudeYoloArgs === 'string' ? r.claudeYoloArgs : DEFAULT_GLOBAL_PREFS.claudeYoloArgs,
    openOnStartup:
      typeof r.openOnStartup === 'boolean' ? r.openOnStartup : DEFAULT_GLOBAL_PREFS.openOnStartup,
    syncRemoteUrl:
      typeof r.syncRemoteUrl === 'string' ? r.syncRemoteUrl : DEFAULT_GLOBAL_PREFS.syncRemoteUrl,
    syncBranch:
      typeof r.syncBranch === 'string' && r.syncBranch.trim()
        ? r.syncBranch
        : DEFAULT_GLOBAL_PREFS.syncBranch,
  };
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newPromptId(): string {
  return cryptoId();
}

export function loadGlobalPrefsSync(): GlobalPrefs {
  try {
    const raw = fsSync.readFileSync(globalPrefsPath(), 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GLOBAL_PREFS };
  }
}

export async function loadGlobalPrefs(): Promise<GlobalPrefs> {
  try {
    const raw = await fs.readFile(globalPrefsPath(), 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GLOBAL_PREFS };
  }
}

export async function saveGlobalPrefs(prefs: GlobalPrefs): Promise<void> {
  const normalized = normalize(prefs);
  await fs.mkdir(globalPrefsDir(), { recursive: true });
  await fs.writeFile(globalPrefsPath(), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}

/** Watch the global prefs file for changes. Returns a disposable. */
export function watchGlobalPrefs(onChange: () => void): vscode.Disposable {
  // Watch the parent directory so we catch create / rename / delete too.
  const dir = globalPrefsDir();
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  const watcher = fsSync.watch(dir, (_event, filename) => {
    if (filename === 'settings.json' || filename === null) onChange();
  });
  // Swallow watcher errors (e.g. ENOENT after dir removal) — next write will re-trigger.
  watcher.on('error', (_err: unknown) => {
    /* ignore */
  });
  return new vscode.Disposable(() => {
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  });
}
