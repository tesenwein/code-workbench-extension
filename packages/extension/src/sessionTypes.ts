import * as vscode from 'vscode';

export type SessionKind = 'claude' | 'claude-yolo' | 'shell';
export type ClaudeModel = 'default' | 'opus' | 'opus-1m' | 'sonnet' | 'haiku' | 'fable';
/** 0=auto, 1=think, 2=think hard, 3=think harder, 4=ultrathink */
export type ClaudeEffort = 0 | 1 | 2 | 3 | 4;

export interface ClaudeModelInfo {
  value: ClaudeModel;
  /** Human-facing label shown in pickers. */
  label: string;
  /** Value passed to `claude --model`; '' means no flag (inherit the CLI default). */
  flag: string;
  /** Whether the model supports extended thinking (the `--effort` flag applies). */
  thinking: boolean;
}

/**
 * Single source of truth for the selectable Claude models. Every model picker,
 * validator, and launch-arg builder derives from this list — add a model here
 * and it appears everywhere.
 */
export const CLAUDE_MODELS: readonly ClaudeModelInfo[] = [
  { value: 'default', label: 'default', flag: '', thinking: true },
  { value: 'opus', label: 'opus', flag: 'opus', thinking: true },
  { value: 'opus-1m', label: 'opus 1m', flag: 'opus[1m]', thinking: true },
  { value: 'sonnet', label: 'sonnet', flag: 'sonnet', thinking: true },
  { value: 'haiku', label: 'haiku', flag: 'haiku', thinking: false },
  { value: 'fable', label: 'fable', flag: 'fable', thinking: true },
];

export const CLAUDE_MODEL_VALUES: readonly ClaudeModel[] = CLAUDE_MODELS.map((m) => m.value);

/** Metadata for a model value, falling back to 'default' for unknown input. */
export function claudeModel(value: ClaudeModel): ClaudeModelInfo {
  return CLAUDE_MODELS.find((m) => m.value === value) ?? CLAUDE_MODELS[0];
}

export const EFFORT_LABELS: readonly string[] = [
  'auto',
  'think',
  'think hard',
  'think harder',
  'ultrathink',
];
/** Maps effort level → claude --effort flag value. '' means no flag (off). */
export const EFFORT_FLAGS: readonly string[] = ['', 'low', 'medium', 'high', 'max'];

/** Worktree accent color. Maps to a VS Code ThemeColor id. */
export type WorktreeColor = 'default' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan';

export const WORKTREE_COLORS: readonly WorktreeColor[] = [
  'default',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
];

const WORKTREE_COLOR_KEYS: Record<
  Exclude<WorktreeColor, 'default'>,
  {
    terminal: string;
    icon: string;
  }
> = {
  red: { terminal: 'terminal.ansiRed', icon: 'charts.red' },
  green: { terminal: 'terminal.ansiGreen', icon: 'charts.green' },
  yellow: { terminal: 'terminal.ansiYellow', icon: 'charts.yellow' },
  blue: { terminal: 'terminal.ansiBlue', icon: 'charts.blue' },
  magenta: { terminal: 'terminal.ansiMagenta', icon: 'charts.purple' },
  cyan: { terminal: 'terminal.ansiCyan', icon: 'charts.cyan' },
};

/** Resolve a worktree color id to a terminal ThemeColor (for terminal tab tint). */
export function worktreeTerminalColor(
  color: WorktreeColor | undefined,
): vscode.ThemeColor | undefined {
  if (!color || color === 'default') return undefined;
  const key = WORKTREE_COLOR_KEYS[color]?.terminal;
  return key ? new vscode.ThemeColor(key) : undefined;
}

/** Resolve a worktree color id to a tree-icon ThemeColor. Uses charts.* keys
 *  which render reliably as TreeItem icon colors across themes. */
export function worktreeIconColor(color: WorktreeColor | undefined): vscode.ThemeColor | undefined {
  if (!color || color === 'default') return undefined;
  const key = WORKTREE_COLOR_KEYS[color]?.icon;
  return key ? new vscode.ThemeColor(key) : undefined;
}

export interface WorktreePrefs {
  model: ClaudeModel;
  effort: ClaudeEffort;
  yolo: boolean;
  color: WorktreeColor;
}

/** A user-defined launch profile from the `codeWorkbench.sessionProfiles`
 *  setting — runs an arbitrary command in a worktree-rooted terminal,
 *  alongside the built-in Claude/Shell session kinds. */
export interface SessionProfile {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Optional codicon id for the session tab. */
  icon?: string;
}

export interface SavedSession {
  id: string;
  title: string;
  /** worktree path the session is bound to. Always === cwd. */
  worktreePath: string;
  kind: SessionKind;
  /** Set when the session was launched from a custom `sessionProfiles` entry.
   *  Takes precedence over `kind` for launch command and tab icon. */
  profile?: SessionProfile;
  /** Legacy single-string form. Kept for migration / shell-typed launches. */
  initCommand: string;
  /** ms epoch */
  created: number;
  /** Codicon id (e.g. 'rocket'). Overrides the kind-based default. */
  icon?: string;
  /** Claude Code session UUID. Assigned on first launch via --session-id and
   *  reused via --resume on subsequent opens, so closing and reopening a saved
   *  session restores the prior conversation. */
  claudeSessionId?: string;
  launched?: boolean;
}

/** Default codicon for a session kind. Shell tabs get the terminal glyph;
 *  Claude sessions get the sparkle. */
function defaultIconId(kind: SessionKind): string {
  return kind === 'shell' ? 'terminal' : 'sparkle';
}

/** Resolve a session's effective codicon id, honoring user override, then a
 *  profile's icon, then the kind-based default. */
export function sessionIconId(session: SavedSession): string {
  if (session.icon && session.icon.trim()) return session.icon.trim();
  if (session.profile?.icon && session.profile.icon.trim()) {
    return session.profile.icon.trim();
  }
  return session.profile ? 'tools' : defaultIconId(session.kind);
}
