/* Phase autopilot: decide whether a finished phase session should be followed
 * by the next phase automatically. Pure — the caller re-reads the task from the
 * store and supplies it, so every stop condition is unit-testable.
 *
 * `task.phase` names the phase to run NEXT (see startTaskPhase), so a session
 * that launched `ranPhase` and handed off cleanly leaves it pointing elsewhere. */

import type { Task, TaskPhase } from '@code-workbench/mcp-core/task-format';

export type AutopilotEvent = 'done' | 'needs_input';

export type AutopilotStopReason =
  | 'autorun-off'
  | 'needs-input'
  | 'task-done'
  | 'blocked'
  | 'high-priority-findings'
  | 'ship-needs-confirmation';

export type AutopilotDecision = { start: TaskPhase } | { stop: AutopilotStopReason };

export interface AutopilotInput {
  /** The task, freshly re-read from the store after the notify event. */
  task: Task;
  /** The task's subtasks (any status); only open review-findings matter. */
  subtasks: Task[];
  event: AutopilotEvent;
  /** Phase the notifying session was launched to run. */
  ranPhase: TaskPhase;
}

export function decideNextPhase({
  task,
  subtasks,
  event,
  ranPhase,
}: AutopilotInput): AutopilotDecision {
  if (!task.autoRun) return { stop: 'autorun-off' };
  if (event === 'needs_input') return { stop: 'needs-input' };
  if (task.status === 'done' || !task.phase) return { stop: 'task-done' };
  // Unchanged phase after "done" means the session hit IF_BLOCKED and stopped.
  if (task.phase === ranPhase) return { stop: 'blocked' };
  if (task.phase === 'fix') {
    const urgent = subtasks.some(
      (s) => s.tags.includes('review-finding') && s.status !== 'done' && s.priority === 'high',
    );
    if (urgent) return { stop: 'high-priority-findings' };
  }
  // Ship pushes a branch and opens a PR — never unattended.
  if (task.phase === 'ship') return { stop: 'ship-needs-confirmation' };
  return { start: task.phase };
}

const STOP_TEXT: Record<AutopilotStopReason, string> = {
  'autorun-off': 'autopilot is off',
  'needs-input': 'the session needs your input',
  'task-done': 'the task is done',
  blocked: 'the phase finished without handing off (blocked)',
  'high-priority-findings': 'Review filed high-priority findings',
  'ship-needs-confirmation': 'Ship pushes and opens a PR — start it yourself from the board',
};

export function describeStop(reason: AutopilotStopReason): string {
  return STOP_TEXT[reason];
}
