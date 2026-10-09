/* Mirror task progress onto the GitHub issue a task was created from.
 *
 * Opt-in (`codeWorkbench.github.syncIssues`, default off) because it writes to
 * an external service. Each status/phase change of a task carrying an
 * `issueNumber` becomes one `gh issue comment`; reaching done closes the issue
 * instead. Best-effort and debounced — a failed `gh` call is dropped, never
 * retried, so the board never blocks on GitHub. */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { listTasks } from './tasks';

const pExecFile = promisify(execFile);

export interface IssueAction {
  issue: number;
  kind: 'comment' | 'close';
  body: string;
}

export type TaskStamp = { status: Task['status']; phase: Task['phase'] };

/** Pure: compare the last-seen stamps with the board and list what to post.
 *  A task with no previous stamp (first sight, or newly linked) only primes
 *  the map — it never posts, so enabling sync does not spam old issues. */
export function planIssueSync(
  prev: ReadonlyMap<string, TaskStamp>,
  tasks: Task[],
): { actions: IssueAction[]; next: Map<string, TaskStamp> } {
  const actions: IssueAction[] = [];
  const next = new Map<string, TaskStamp>();
  for (const t of tasks) {
    if (t.parentId || !t.issueNumber) continue;
    const stamp = { status: t.status, phase: t.phase };
    next.set(t.id, stamp);
    const before = prev.get(t.id);
    if (!before || (before.status === stamp.status && before.phase === stamp.phase)) continue;
    if (stamp.status === 'done' && before.status !== 'done') {
      actions.push({
        issue: t.issueNumber,
        kind: 'close',
        body: `Completed in Code Workbench: ${t.title}${t.prUrl ? `\n\nPull request: ${t.prUrl}` : ''}`,
      });
    } else {
      const phase = stamp.phase ? `, next phase: ${stamp.phase}` : '';
      actions.push({
        issue: t.issueNumber,
        kind: 'comment',
        body: `Code Workbench status: ${stamp.status}${phase}`,
      });
    }
  }
  return { actions, next };
}

export function registerIssueSync(
  ctx: vscode.ExtensionContext,
  deps: { getRepoKey: () => string | undefined; getRepoRoot: () => string | undefined },
): { refresh: () => void } {
  let stamps: ReadonlyMap<string, TaskStamp> = new Map();
  let timer: NodeJS.Timeout | undefined;
  const enabled = () =>
    vscode.workspace.getConfiguration('codeWorkbench').get<boolean>('github.syncIssues', false);

  const run = async () => {
    const key = deps.getRepoKey();
    const root = deps.getRepoRoot();
    if (!enabled() || !key || !root) {
      stamps = new Map();
      return;
    }
    const { actions, next } = planIssueSync(stamps, await listTasks(key));
    stamps = next;
    for (const a of actions) {
      const args =
        a.kind === 'close'
          ? ['issue', 'close', String(a.issue), '--comment', a.body]
          : ['issue', 'comment', String(a.issue), '--body', a.body];
      try {
        await pExecFile('gh', args, { cwd: root });
      } catch {
        /* gh missing / offline / issue gone — best-effort */
      }
    }
  };

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run().catch(() => undefined), 2000);
  };
  ctx.subscriptions.push({ dispose: () => clearTimeout(timer) });
  refresh();
  return { refresh };
}
