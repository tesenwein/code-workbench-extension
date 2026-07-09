/* "Plan Feature" code-health tool.
 *
 * Like Code Review, this spawns a dedicated Opus orchestrator session primed
 * to run a bundled Workflow script — here `cw-plan-feature`, which designs a
 * feature via a fleet of subagents (context gathering, three competing
 * designs, judging, synthesis, and a completeness critique) and returns a
 * hierarchical plan. The session resolves open questions and gets explicit
 * approval from the user before persisting anything to the shared cw-tasks
 * board, and it never edits code. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import { writeWorkflowScript } from '../workflowsBundle';

const REQUEST_START = '<<<FEATURE_REQUEST_START>>>';
const REQUEST_END = '<<<FEATURE_REQUEST_END>>>';

/** First turn handed to the plan session. */
export function buildPlanPrompt(scriptPath: string, request: string): string {
  return [
    `Run the Workflow tool with scriptPath: ${scriptPath}`,
    '',
    'The feature request is the exact text between the markers below. Pass it to the Workflow tool as its `args` parameter — an object `{ "request": "<the text>" }` — never type or interpolate it into a script.',
    '',
    REQUEST_START,
    request,
    REQUEST_END,
    '',
    'Do not design anything yourself first — the workflow script gathers context (repo map, architecture wiki, prior art), produces three independent designs, judges them, synthesizes a plan, and critiques it for completeness across a fleet of subagents.',
    '',
    'The workflow returns { request, summary, openQuestions, tasks }, where tasks is a hierarchical breakdown: each entry has title, description, priority, and subtasks (each with title, description).',
    '',
    'Then, in order:',
    '1. If openQuestions is non-empty, ask the user to resolve them in one numbered message and wait for their answers.',
    '2. Present the plan (summary + the task/subtask breakdown) and explicitly ask the user to approve it. Change nothing until they approve.',
    '3. Once approved, persist the plan with the cw-tasks `task_create` tool: first create one task per entry in `tasks` with tags: ["plan"] and phase: "implement", writing the workflow\'s `summary` into that task\'s `memo` field. Then, for each of its subtasks in order, create a task with parentId set to the parent\'s id and tags: ["plan-step"].',
    '4. Print the ids of every task and subtask you created.',
    '',
    'Never edit any code in this session — planning only.',
    '',
    'Fallback: if the Workflow tool is unavailable, design the feature yourself directly (gather context, weigh at least two approaches, note risks and open questions) and follow the same resolve → present → approve → persist steps above.',
  ].join('\n');
}

export function registerPlanFeatureCommand(
  ctx: vscode.ExtensionContext,
  deps: {
    sessionMgr: SessionManager;
    ensureActiveWorktree: () => Promise<string | undefined>;
  },
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.plan.start', async () => {
      const request = await vscode.window.showInputBox({
        prompt: 'What feature should be planned?',
        placeHolder: 'Describe the feature to design…',
        ignoreFocusOut: true,
      });
      if (!request) return;
      const wt = await deps.ensureActiveWorktree();
      if (!wt) return;
      const scriptPath = await writeWorkflowScript(ctx, 'cw-plan-feature');
      await deps.sessionMgr.create('claude', wt, undefined, {
        title: 'Plan',
        icon: 'compass',
        model: 'opus',
        prompt: buildPlanPrompt(scriptPath, request),
      });
    }),
  );
}
