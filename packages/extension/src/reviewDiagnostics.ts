/* Review findings as editor diagnostics. Open "review-finding" subtasks carry
 * "file:line, what is wrong" in their description; publishing them to a
 * DiagnosticCollection shows them inline and in the Problems panel, with quick
 * fixes that jump back to the task or close the finding. */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { parseFindingLocation, worktreeKey } from '@code-workbench/mcp-core/task-format';
import { listTasks, updateTask } from './tasks';
import { listWorktrees } from './git';

const SOURCE = 'Code Workbench review';

export interface FindingDiagnostic {
  /** Absolute path of the file the finding points at. */
  file: string;
  /** 0-based, as the VS Code API wants. */
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  taskId: string;
  parentId: string;
}

const SEVERITY: Record<Task['priority'], FindingDiagnostic['severity']> = {
  high: 'error',
  medium: 'warning',
  low: 'info',
};

/** Pure mapping: open review-finding subtasks of live root tasks → diagnostics.
 *  `resolveRoot(parent)` gives the worktree root to resolve relative paths
 *  against (undefined → the finding is skipped). */
export function findingDiagnostics(
  tasks: Task[],
  resolveRoot: (parent: Task) => string | undefined,
): FindingDiagnostic[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: FindingDiagnostic[] = [];
  for (const t of tasks) {
    if (!t.parentId || t.status === 'done' || !t.tags.includes('review-finding')) continue;
    const parent = byId.get(t.parentId);
    if (!parent || parent.status === 'done') continue;
    const loc = parseFindingLocation(t.description);
    const root = resolveRoot(parent);
    if (!loc || !root) continue;
    out.push({
      file: path.isAbsolute(loc.file) ? loc.file : path.join(root, loc.file),
      line: loc.line - 1,
      column: (loc.column ?? 1) - 1,
      message: t.title,
      severity: SEVERITY[t.priority],
      taskId: t.id,
      parentId: parent.id,
    });
  }
  return out;
}

// Resolved lazily: the test stub of `vscode` has no DiagnosticSeverity.
const severityOf = (s: FindingDiagnostic['severity']): vscode.DiagnosticSeverity =>
  s === 'error'
    ? vscode.DiagnosticSeverity.Error
    : s === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

export function registerReviewDiagnostics(
  ctx: vscode.ExtensionContext,
  deps: {
    getRepoKey: () => string | undefined;
    getRepoRoot: () => string | undefined;
    getActiveWorktree: () => string | undefined;
    /** Called after a finding is closed so every task surface refreshes. */
    afterMutation: () => void;
  },
): { refresh: () => void } {
  const collection = vscode.languages.createDiagnosticCollection('codeWorkbenchReview');
  // short code shown in Problems → the full ids (code actions need both).
  const known = new Map<string, { taskId: string; parentId: string }>();
  let timer: NodeJS.Timeout | undefined;

  const enabled = () =>
    vscode.workspace
      .getConfiguration('codeWorkbench')
      .get<boolean>('reviewDiagnostics.enabled', true);

  const publish = async () => {
    collection.clear();
    known.clear();
    const key = deps.getRepoKey();
    const repoRoot = deps.getRepoRoot();
    if (!enabled() || !key || !repoRoot) return;
    const tasks = await listTasks(key);
    const trees = await listWorktrees(repoRoot).catch(() => []);
    const active = deps.getActiveWorktree();
    const items = findingDiagnostics(tasks, (parent) => {
      if (!parent.worktree) return active ?? repoRoot;
      return trees.find((w) => worktreeKey(w.path) === parent.worktree)?.path;
    });
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of items) {
      const pos = new vscode.Position(f.line, f.column);
      // Whole line: the finding names a line, not an exact span.
      const d = new vscode.Diagnostic(
        new vscode.Range(pos, pos),
        f.message,
        severityOf(f.severity),
      );
      d.source = SOURCE;
      d.code = f.taskId.slice(0, 8);
      known.set(f.taskId.slice(0, 8), { taskId: f.taskId, parentId: f.parentId });
      const list = byFile.get(f.file) ?? [];
      list.push(d);
      byFile.set(f.file, list);
    }
    for (const [file, diags] of byFile) collection.set(vscode.Uri.file(file), diags);
  };

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void publish().catch(() => undefined), 300);
  };

  const actions: vscode.CodeActionProvider = {
    provideCodeActions(_doc, _range, context) {
      const out: vscode.CodeAction[] = [];
      for (const d of context.diagnostics) {
        if (d.source !== SOURCE) continue;
        const ids = known.get(String(d.code));
        if (!ids) continue;
        const open = new vscode.CodeAction(
          'Open finding on task board',
          vscode.CodeActionKind.QuickFix,
        );
        open.diagnostics = [d];
        open.command = {
          command: 'codeWorkbench.tasks.openTaskInPage',
          title: 'Open finding on task board',
          arguments: [ids.parentId],
        };
        const done = new vscode.CodeAction('Mark finding done', vscode.CodeActionKind.QuickFix);
        done.diagnostics = [d];
        done.command = {
          command: 'codeWorkbench.reviewDiagnostics.markDone',
          title: 'Mark finding done',
          arguments: [ids.taskId],
        };
        out.push(open, done);
      }
      return out;
    },
  };

  ctx.subscriptions.push(
    collection,
    { dispose: () => clearTimeout(timer) },
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, actions, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand(
      'codeWorkbench.reviewDiagnostics.markDone',
      async (id?: string) => {
        const key = deps.getRepoKey();
        if (!id || !key) return;
        await updateTask(key, id, { status: 'done' });
        deps.afterMutation();
      },
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeWorkbench.reviewDiagnostics.enabled')) refresh();
    }),
  );
  refresh();
  return { refresh };
}
