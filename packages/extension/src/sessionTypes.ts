import * as vscode from 'vscode';
import type { TaskPhase } from '@code-workbench/mcp-core/phase-prompts';
// Also imported locally: the re-export below publishes these names but does
// not bind them in this module's own scope, and the types below use them.
import type { ClaudeModel } from '@code-workbench/mcp-core/claude-models';

export type SessionKind = 'claude' | 'claude-yolo' | 'shell';
/** 0=auto, 1=think, 2=think hard, 3=think harder, 4=ultrathink */
export type ClaudeEffort = 0 | 1 | 2 | 3 | 4;

const EFFORT_LEVELS: readonly ClaudeEffort[] = [0, 1, 2, 3, 4];

/** Clamp an arbitrary number to a valid effort level (floored, 0..4). */
export function clampEffort(n: number): ClaudeEffort {
  return EFFORT_LEVELS[Math.max(0, Math.min(4, Math.floor(n)))];
}
/** `claude --permission-mode` values. 'plan' forces read-only planning
 *  (no edits/writes) regardless of the worktree's yolo pref. */
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * The selectable models live in `@code-workbench/mcp-core/claude-models` so the
 * extension, the bundled skills, and the phase defaults all read one list.
 * Re-exported here because every consumer in this package already imports its
 * session types from this module.
 */
export {
  CLAUDE_MODELS,
  CLAUDE_MODEL_VALUES,
  CLAUDE_QUICK_MODELS,
  CLAUDE_PHASE_MODELS,
  claudeModel,
  isClaudeModel,
  type ClaudeModel,
  type ClaudeModelInfo,
} from '@code-workbench/mcp-core/claude-models';

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

/**
 * Model to run each task-flow phase on. A missing entry — or the 'default'
 * value — falls through to the next level: worktree → global → the phase's
 * built-in model (PHASE_META in mcp-core/phase-prompts, i.e. opus for Plan and
 * sonnet for the rest). Note 'default' here means "inherit the phase default",
 * not "pass no --model flag".
 */
export type PhaseModels = Partial<Record<TaskPhase, ClaudeModel>>;

export interface WorktreePrefs {
  model: ClaudeModel;
  effort: ClaudeEffort;
  yolo: boolean;
  color: WorktreeColor;
  /** Per-phase model overrides for this worktree; beats the global setting. */
  phaseModels?: PhaseModels;
  /** Handoff note — "where I left off" for the next session in this worktree. */
  note?: string;
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
  /** Per-session model, overriding the worktree pref. */
  modelOverride?: ClaudeModel;
  /** Prompt handed to the CLI as its first turn. Only applied on the first
   *  launch — a resumed session already has it in its transcript. */
  initialPrompt?: string;
  /** `claude --permission-mode` override, applied on every (re)launch. */
  permissionMode?: ClaudePermissionMode;
  /** Per-session effort override, taking precedence over the worktree pref. */
  effortOverride?: ClaudeEffort;
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
