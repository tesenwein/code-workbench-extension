// The selectable Claude models — ONE source of truth for the whole workbench.
//
// Every model picker, pref validator, launch-arg builder, and phase default
// derives from `CLAUDE_MODELS` below. Add a model here and it appears in the
// sessions view's quick-launch row, both prefs panels, the phase-model
// dropdowns, and the `--model` flag builder. Nothing else hardcodes a list.
//
// Two flavours of entry, because both are genuinely useful:
//   - ALIASES (`opus`, `sonnet`, ...) — the Claude CLI resolves these to the
//     newest model of that tier, so they never go stale but also never pin.
//   - PINNED IDS (`claude-sonnet-5-5`, ...) — an exact snapshot, for when a
//     worktree must keep running the model it was tuned against even after
//     Anthropic ships the next generation.
//
// `flag` is passed verbatim to `claude --model`; the CLI accepts an alias or a
// full model name. '' means "pass no flag" and inherit the CLI's own default.
//
// CommonJS so synced consumers can `require` it; `claude-models.mjs` is a thin
// ESM re-export shim.

"use strict";

/** @type {readonly import("./claude-models.cjs").ClaudeModelInfo[]} */
const CLAUDE_MODELS = [
  { value: "default", label: "default", flag: "", thinking: true },

  // Aliases — always the newest model of their tier.
  { value: "fable", label: "fable", flag: "fable", thinking: true, quick: true },
  { value: "opus", label: "opus", flag: "opus", thinking: true, quick: true },
  { value: "sonnet", label: "sonnet", flag: "sonnet", thinking: true, quick: true },
  // Haiku 4.5 has extended thinking but no `--effort` support, so the effort
  // flag must be skipped for it — that is what `thinking: false` gates here.
  { value: "haiku", label: "haiku", flag: "haiku", thinking: false },

  // Pinned snapshots of the current generation.
  { value: "fable-5-1", label: "fable 5.1", flag: "claude-fable-5-1", thinking: true },
  { value: "opus-5-5", label: "opus 5.5", flag: "claude-opus-5-5", thinking: true },
  { value: "sonnet-5-5", label: "sonnet 5.5", flag: "claude-sonnet-5-5", thinking: true },
];

/** Every valid `ClaudeModel` value, for validating persisted prefs. */
const CLAUDE_MODEL_VALUES = CLAUDE_MODELS.map((m) => m.value);

/** Metadata for a model value, falling back to 'default' for unknown input. */
function claudeModel(value) {
  return CLAUDE_MODELS.find((m) => m.value === value) ?? CLAUDE_MODELS[0];
}

/** True when `value` is a model the workbench knows about. */
function isClaudeModel(value) {
  return CLAUDE_MODEL_VALUES.includes(value);
}

/** The shortlist shown as one-click "new terminal" buttons in the sessions
 *  view. A curated subset — the full list lives in the prefs panels. */
const CLAUDE_QUICK_MODELS = CLAUDE_MODELS.filter((m) => m.quick);

/** Models offerable as a phase default: 'default' means "inherit the phase's
 *  built-in model", which is not a thing a phase default can itself be. */
const CLAUDE_PHASE_MODELS = CLAUDE_MODELS.filter((m) => m.value !== "default");

module.exports = {
  CLAUDE_MODELS,
  CLAUDE_MODEL_VALUES,
  CLAUDE_QUICK_MODELS,
  CLAUDE_PHASE_MODELS,
  claudeModel,
  isClaudeModel,
};
