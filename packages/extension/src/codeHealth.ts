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

/** Findings that appeared / went away for one feature. Kept apart so new
 *  regressions are never hidden by an equal number of removals. */
export interface FeatureDelta {
  added: number;
  removed: number;
}

export interface HealthDelta {
  duplicates: FeatureDelta;
  deadCode: FeatureDelta;
  typeEscapes: FeatureDelta;
}

/** Per-fingerprint change per feature: findings that appeared vs. went away. */
export function diffHealth(before: HealthSnapshot, after: HealthSnapshot): HealthDelta {
  const change = (a: string[], b: string[]): FeatureDelta => {
    const was = new Set(a);
    const is = new Set(b);
    let added = 0;
    let removed = 0;
    for (const f of is) if (!was.has(f)) added++;
    for (const f of was) if (!is.has(f)) removed++;
    return { added, removed };
  };
  return {
    duplicates: change(before.duplicates, after.duplicates),
    deadCode: change(before.deadCode, after.deadCode),
    typeEscapes: change(before.typeEscapes, after.typeEscapes),
  };
}

/** "+2/-2", "+2", "-1" or "±0". A leading "+N" always means regressions: the
 *  Review rule and the board chip key off it. */
const signed = ({ added, removed }: FeatureDelta): string => {
  if (added > 0 && removed > 0) return `+${added}/-${removed}`;
  if (added > 0) return `+${added}`;
  if (removed > 0) return `-${removed}`;
  return '±0';
};

/** "Code health: +3 duplicates, -1 dead-code items, ±0 type escapes". */
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

/** How long a phase start may wait for the baseline scan. */
const BASELINE_TIMEOUT_MS = 30_000;

async function dropBaseline(file: string): Promise<void> {
  await fsp.rm(file, { force: true }).catch(() => undefined);
}

/** Capture the pre-phase baseline. The caller awaits this BEFORE the session
 *  spawns, so the scan sees the tree as it was before the agent's first edit.
 *  Best-effort: a failed or timed-out scan just means no gate — and any older
 *  baseline is dropped first so a stale one is never reused. */
export async function captureHealthBaseline(
  ctx: vscode.ExtensionContext,
  repoKey: string,
  worktree: string,
  taskId: string,
  timeoutMs = BASELINE_TIMEOUT_MS,
): Promise<void> {
  const file = baselinePath(ctx, repoKey, taskId);
  await dropBaseline(file);
  try {
    let timer: NodeJS.Timeout | undefined;
    const snap = await Promise.race([
      scanHealthSnapshot(ctx, worktree),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    // Timed out: the session is about to start editing, so a late result
    // would be polluted. No baseline → no gate.
    if (!snap) return;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(snap), 'utf8');
  } catch {
    /* no baseline → no delta later */
  }
}

/** Re-scan, diff against the stored baseline and write the memo line. Returns
 *  the delta, or undefined when there is no baseline / the scan failed. The
 *  baseline is consumed either way. */
export async function recordHealthDelta(
  ctx: vscode.ExtensionContext,
  repoKey: string,
  worktree: string,
  taskId: string,
): Promise<HealthDelta | undefined> {
  const file = baselinePath(ctx, repoKey, taskId);
  try {
    const before = JSON.parse(await fsp.readFile(file, 'utf8')) as HealthSnapshot;
    const delta = diffHealth(before, await scanHealthSnapshot(ctx, worktree));
    const task = (await listTasks(repoKey)).find((t) => t.id === taskId);
    if (!task) return undefined;
    await updateTask(repoKey, taskId, {
      memo: upsertHealthLine(task.memo, formatHealthDelta(delta)),
    });
    return delta;
  } catch {
    return undefined;
  } finally {
    await dropBaseline(file);
  }
}
