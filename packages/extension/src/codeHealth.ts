/* Code-health gate: snapshot the scans' finding fingerprints when an Implement
 * or Fix phase starts, re-scan when it reports done, and record the delta on
 * the task so the Review phase (and the Phase Board card) can act on it.
 *
 * The delta is computed per fingerprint (new vs. gone), so it is scoped to what
 * the phase actually changed without re-implementing each detector's file
 * filtering; the scans themselves still cover the whole worktree. */

import type * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { scanHealthSnapshot, type HealthSnapshot } from './scanHost';
import { listTasks, updateTask } from './tasks';

export const HEALTH_MEMO_PREFIX = 'Code health:';

export interface HealthDelta {
  duplicates: number;
  deadCode: number;
  typeEscapes: number;
}

/** Net change per feature: findings that appeared minus findings that went away. */
export function diffHealth(before: HealthSnapshot, after: HealthSnapshot): HealthDelta {
  const net = (a: string[], b: string[]): number => {
    const was = new Set(a);
    const is = new Set(b);
    let added = 0;
    let removed = 0;
    for (const f of is) if (!was.has(f)) added++;
    for (const f of was) if (!is.has(f)) removed++;
    return added - removed;
  };
  return {
    duplicates: net(before.duplicates, after.duplicates),
    deadCode: net(before.deadCode, after.deadCode),
    typeEscapes: net(before.typeEscapes, after.typeEscapes),
  };
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '±0');

/** "Code health: +3 duplicates, -1 dead exports, ±0 type escapes". */
export function formatHealthDelta(d: HealthDelta): string {
  return `${HEALTH_MEMO_PREFIX} ${signed(d.duplicates)} duplicates, ${signed(d.deadCode)} dead-code items, ${signed(d.typeEscapes)} type escapes`;
}

/** Replace (or append) the health line in a memo, leaving everything else. */
export function upsertHealthLine(memo: string, line: string): string {
  const lines = memo ? memo.split('\n') : [];
  const idx = lines.findIndex((l) => l.startsWith(HEALTH_MEMO_PREFIX));
  if (idx >= 0) {
    lines[idx] = line;
    return lines.join('\n');
  }
  return memo ? `${memo.replace(/\s+$/, '')}\n\n${line}` : line;
}

function baselinePath(ctx: vscode.ExtensionContext, repoKey: string, taskId: string): string {
  return path.join(ctx.globalStorageUri.fsPath, 'task-health', repoKey, `${taskId}.json`);
}

/** Capture the pre-phase baseline. Best-effort: a failed scan just means no gate. */
export async function captureHealthBaseline(
  ctx: vscode.ExtensionContext,
  repoKey: string,
  worktree: string,
  taskId: string,
): Promise<void> {
  try {
    const snap = await scanHealthSnapshot(ctx, worktree);
    const file = baselinePath(ctx, repoKey, taskId);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(snap), 'utf8');
  } catch {
    /* no baseline → no delta later */
  }
}

/** Re-scan, diff against the stored baseline and write the memo line. Returns
 *  the delta, or undefined when there is no baseline / the scan failed. */
export async function recordHealthDelta(
  ctx: vscode.ExtensionContext,
  repoKey: string,
  worktree: string,
  taskId: string,
): Promise<HealthDelta | undefined> {
  try {
    const before = JSON.parse(
      await fsp.readFile(baselinePath(ctx, repoKey, taskId), 'utf8'),
    ) as HealthSnapshot;
    const delta = diffHealth(before, await scanHealthSnapshot(ctx, worktree));
    const task = (await listTasks(repoKey)).find((t) => t.id === taskId);
    if (!task) return undefined;
    await updateTask(repoKey, taskId, {
      memo: upsertHealthLine(task.memo, formatHealthDelta(delta)),
    });
    return delta;
  } catch {
    return undefined;
  }
}
