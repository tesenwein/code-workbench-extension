/* "Plan Feature" code-health tool.
 *
 * Opens a normal chat session primed with a planning prompt: the session
 * interviews the user with multiple-choice questions (AskUserQuestion) until
 * the feature request is sharp, then designs it — optionally via the bundled
 * `cw-plan-feature` Workflow script (context gathering, one plan draft, one
 * completeness critique) — presents the plan for
 * approval, and persists it to the shared cw-tasks board. It never edits
 * code. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import { writeWorkflowScript } from '../workflowsBundle';

const REQUEST_START = '<<<FEATURE_REQUEST_START>>>';
const REQUEST_END = '<<<FEATURE_REQUEST_END>>>';

/** First turn handed to the plan session. */
export function buildPlanPrompt(scriptPath: string, request: string): string {
  const idea = request.trim();
  return [
    'You are running a feature-planning conversation. You never edit code in this session — planning only.',
    '',
    idea
      ? ['The user\'s starting idea is the exact text between the markers below:', '', REQUEST_START, idea, REQUEST_END].join('\n')
      : 'The user has not described the feature yet. Open by asking what they want to build.',
    '',
    '## 1. Interview the user',
    'First orient yourself in the codebase (cw-code `search_code`, `arch_list`/`arch_search`, reading the relevant files) so your questions are grounded in what actually exists.',
    '',
    'Then use the **AskUserQuestion** tool to turn the rough idea into a precise feature request. Ask in rounds of 1–4 questions, each with 2–4 concrete options; put your recommendation first and mark it "(Recommended)". Cover the things that change the design: scope and non-goals, where it lives in the existing architecture, the user-facing behavior and entry points, data/persistence, edge cases and failure modes, and what is explicitly out of scope for a first cut.',
    '',
    'Do not ask about things you can answer yourself by reading the code, and do not ask about choices with an obvious default — pick it and say so. Keep interviewing (usually 2–3 rounds) until you could hand the request to another engineer with no follow-up. Then restate the finished feature request in prose and confirm it.',
    '',
    '## 2. Design it',
    `Run the Workflow tool with scriptPath: ${scriptPath}, passing the finished feature request as its \`args\` parameter — an object \`{ "request": "<the text>" }\`. Never interpolate the text into a script.`,
    '',
    'The workflow gathers context (repo map, architecture wiki, prior art), drafts an implementation plan, and critiques it once for completeness. It returns { request, summary, openQuestions, tasks }, where tasks is a hierarchical breakdown: each entry has title, description, priority, and subtasks (each with title, description, order).',
    '',
    'If the Workflow tool is unavailable, design the feature yourself instead: gather context, weigh at least two approaches, and note risks and open questions.',
    '',
    '## 3. Resolve, approve, persist',
    '1. If openQuestions is non-empty, resolve them with the user — use AskUserQuestion where the answers are a small set of choices, plain prose otherwise.',
    '2. Present the plan (summary + the task/subtask breakdown) and explicitly ask the user to approve it. Persist nothing until they approve.',
    '3. Once approved, persist the plan with the cw-tasks `task_create` tool: first create one task per entry in `tasks` with tags: ["plan"] and phase: "implement", writing the `summary` into that task\'s `memo` field. Then, for each of its subtasks, create a task with parentId set to the parent\'s id, tags: ["plan-step"], and pass through that subtask\'s `order` field unchanged so the Implement phase gets the intended sequencing.',
    '4. Print the ids of every task and subtask you created.',
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
      const wt = await deps.ensureActiveWorktree();
      if (!wt) return;
      const scriptPath = await writeWorkflowScript(ctx, 'cw-plan-feature');
      await deps.sessionMgr.create('claude', wt, undefined, {
        title: 'Plan',
        icon: 'compass',
        model: 'opus',
        prompt: buildPlanPrompt(scriptPath, ''),
      });
    }),
  );
}
