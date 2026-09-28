/** A selectable model value. Aliases track the newest model of their tier;
 *  the dotted values are pinned snapshots. 'default' passes no `--model`. */
export type ClaudeModel =
  | 'default'
  | 'fable'
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'fable-5-1'
  | 'opus-5-5'
  | 'sonnet-5-5';

export interface ClaudeModelInfo {
  value: ClaudeModel;
  /** Human-facing label shown in pickers. */
  label: string;
  /** Value passed to `claude --model`; '' means no flag (inherit the CLI default). */
  flag: string;
  /** Whether `--effort` applies. False for models without effort support. */
  thinking: boolean;
  /** Include in the sessions view's one-click quick-launch row. */
  quick?: boolean;
}

/** Single source of truth for the selectable Claude models. */
export const CLAUDE_MODELS: readonly ClaudeModelInfo[];

/** Every valid `ClaudeModel` value, for validating persisted prefs. */
export const CLAUDE_MODEL_VALUES: readonly ClaudeModel[];

/** The curated subset shown as quick-launch buttons in the sessions view. */
export const CLAUDE_QUICK_MODELS: readonly ClaudeModelInfo[];

/** Models offerable as a phase default (everything but 'default'). */
export const CLAUDE_PHASE_MODELS: readonly ClaudeModelInfo[];

/** Metadata for a model value, falling back to 'default' for unknown input. */
export function claudeModel(value: ClaudeModel): ClaudeModelInfo;

/** True when `value` is a model the workbench knows about. */
export function isClaudeModel(value: unknown): value is ClaudeModel;
