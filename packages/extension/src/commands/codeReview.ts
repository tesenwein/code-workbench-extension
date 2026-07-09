/* "Code Review" code-health tool.
 *
 * Unlike the other Tools action bar entries (which run a static analyser and render
 * a page), this one spawns a dedicated Claude session — Sonnet, since the work
 * is broad-but-shallow reading — primed with a review prompt. Findings land on
 * the shared cw-tasks board rather than in a throwaway chat log, and the agent
 * asks before touching any code. */

import * as vscode from 'vscode';
import type { SessionManager } from '../sessions';

/** First turn handed to the review session. */
export function buildCodeReviewPrompt(): string {
  return [
    'Do a thorough code review of the current changes in this worktree. Nothing else — do not review untouched code.',
    '',
    'Scope, in this order:',
    '1. Uncommitted work: `git status --short`, `git diff`, `git diff --staged`.',
    '2. Commits on this branch that are not on the base branch: resolve the base (origin/HEAD, else develop, else main/master), then `git diff <base>...HEAD` and `git log --oneline <base>..HEAD`.',
    'If both are empty, say so and stop.',
    '',
    'Read the surrounding files for context — never judge a hunk in isolation. Look for correctness bugs, logic errors, races, missing error handling, type-safety escapes, security issues, dead code, duplication, and needless complexity.',
    '',
    'Verify the change actually builds and passes the project checks. Discover what exists first (package.json scripts, Makefile, CI config) and run whatever of lint, format check, typecheck, and tests the project has. Skip silently what it does not have. Treat every failure you find as a review finding.',
    '',
    'File every finding on the shared board with the cw-tasks `task_create` tool — one task per finding:',
    '- title: short statement of the defect',
    '- description: `file:line`, what is wrong, why it matters, and the suggested fix',
    '- priority: high for bugs, data loss, and security; medium for correctness-adjacent and design problems; low for style and nits',
    '- tags: ["code-review"]',
    'If several findings share one root cause, create a parent task and attach the rest as subtasks via parentId.',
    '',
    'Then print a summary grouped by priority.',
    '',
    'Finally — and only then — ask the user whether you should fix the findings directly. Change no code before they answer. If they say yes, work the tasks in priority order, marking each in-progress before you start and done when it is fixed, and re-run the project checks at the end.',
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
      await deps.sessionMgr.create('claude', wt, undefined, {
        title: 'Code Review',
        icon: 'checklist',
        model: 'sonnet',
        prompt: buildCodeReviewPrompt(),
      });
    }),
  );
}
