export type TaskPhase = 'plan' | 'implement' | 'review' | 'fix';

export interface PhaseMeta {
  label: string;
  /** VS Code codicon id for the spawned session's tab. */
  icon: string;
  model: 'opus' | 'sonnet';
  /** Overrides the worktree's effort pref for this phase's session. */
  effort?: 0 | 1 | 2 | 3 | 4;
}

export interface PhaseTask {
  id: string;
  title: string;
  description: string;
  memo: string;
}

export interface BundledPhaseSkill {
  name: string;
  body: string;
}

/** Canonical phase order — the board's state machine. */
export const PHASE_ORDER: TaskPhase[];

export const PHASE_META: Record<TaskPhase, PhaseMeta>;

export const PHASE_DESCRIPTIONS: Record<TaskPhase, string>;

/** The phase's instructions with the task-id placeholder resolved. */
export function phaseProcedure(phase: TaskPhase, taskId: string): string;

/** Full prompt for a spawned phase session. */
export function phasePrompt(phase: TaskPhase, task: PhaseTask): string;

/** Full prompt for ONE session that runs a phase across several tasks in sequence. */
export function phasePromptBulk(phase: TaskPhase, tasks: PhaseTask[]): string;

/** `.claude/skills/cw-<phase>/SKILL.md` body. */
export function phaseSkillBody(phase: TaskPhase): string;

/** A `{ name, body }` skill record for a phase. */
export function phaseSkill(phase: TaskPhase): BundledPhaseSkill;
