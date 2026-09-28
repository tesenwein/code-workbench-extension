// ESM re-export shim for claude-models.cjs — the single selectable-model list.
// The implementation is CommonJS so CJS consumers (the VS Code extension, the
// bundled skills) can `require` it; this file lets the spawned `.mjs` MCP
// servers import it unchanged. One implementation.
// Keep this file plain ESM with no non-builtin imports.

export {
  CLAUDE_MODELS,
  CLAUDE_MODEL_VALUES,
  CLAUDE_QUICK_MODELS,
  CLAUDE_PHASE_MODELS,
  claudeModel,
  isClaudeModel,
} from "./claude-models.cjs";
