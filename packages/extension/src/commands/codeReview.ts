/* "Code Review" code-health tool.
 *
 * Unlike the other Tools action bar entries (which run a static analyser and render
 * a page), this one spawns a dedicated Claude session — on the review-phase model
 * from preferences, since it acts as an orchestrator — primed to run the bundled
 * `cw-code-review` Workflow script.
 * That script fans a finder out per review dimension and adversarially verifies
 * each finding before it survives; the session files the returned findings on
 * the shared cw-tasks board and asks before touching any code. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';
import { writeWorkflowScript } from '../workflowsBundle';

/** First turn handed to the review session. */
export function buildCodeReviewPrompt(scriptPath: string): string {
  return [
    `Run the Workflow tool with scriptPath: ${scriptPath}`,
    '',
    'Do not read the diff or review anything yourself first — the workflow script does the scoping, dimension review, and adversarial verification across a fleet of subagents.',
    '',
    "The workflow returns { baseBranch, empty, findings, checks }. If empty is true, tell the user there is nothing to review (no uncommitted changes and no commits ahead of the base branch) and stop.",
    '',
    'Otherwise, file every entry in findings on the shared board with the cw-tasks `task_create` tool — one task per finding:',
    '- title: the finding\'s summary',
    '- description: `file:line`, what is wrong, why it matters, and the suggested fix',
    '- priority: the finding\'s priority',
    '- tags: ["code-review"]',
    'If several findings share one rootCause, create a parent task and attach the rest as subtasks via parentId.',
    'Also file each entry in checks.failures as a high-priority finding the same way.',
    '',
    'Then print a summary grouped by priority.',
    '',
    'Finally — and only then — ask the user whether you should fix the findings directly. Change no code before they answer. If they say yes, work the tasks in priority order, marking each in-progress before you start and done when it is fixed, and re-run the project checks at the end.',
    '',
    'Fallback: if the Workflow tool is unavailable, review the diff directly across the same dimensions (correctness & logic; error handling, concurrency & resource lifecycle; type safety & API contracts; security & data handling; dead code, duplication & needless complexity; tests & docs coverage) and file findings the same way.',
  ].join('\n');
}

export function registerCodeReviewCommand(
  ctx: vscode.ExtensionContext,
  deps: {
    sessionMgr: SessionManager;
    ensureActiveWorktree: () => Promise<string | undefined>;
  },
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.codeReview.start', async () => {
      const wt = await deps.ensureActiveWorktree();
      if (!wt) return;
      const scriptPath = await writeWorkflowScript(ctx, 'cw-code-review');
      await deps.sessionMgr.create('claude', wt, undefined, {
        title: 'Code Review',
        icon: 'checklist',
        // Honour the review-phase model from preferences (worktree override →
        // global → built-in) rather than pinning Opus.
        model: deps.sessionMgr.resolvePhaseModel(wt, 'review'),
        prompt: buildCodeReviewPrompt(scriptPath),
      });
    }),
  );
}
