// Task-bound phase-flow procedures, shared by the VS Code extension and the
// bundled skills. The implementation lives in `phase-prompts.cjs` so CommonJS
// consumers can `require` it; this `.mjs` is a thin re-export shim for ESM.

export {
  PHASE_ORDER,
  PHASE_META,
  PHASE_DESCRIPTIONS,
  phaseProcedure,
  phasePrompt,
  phaseSkillBody,
  phaseSkill,
} from "./phase-prompts.cjs";
