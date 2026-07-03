/* Per-repo history of code-health scan results.
 *
 * Every completed scan appends one {time, total, active} point per feature to
 * `.code-workbench/scan-trends.json`; the scan pages render the active-count
 * series as a sparkline, turning the point-in-time scans into a signal
 * ("duplicates: 41 → 33 since last week"). */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ScanFeature } from '@code-workbench/mcp-core/scan-state';

export interface TrendPoint {
  /** ISO timestamp of the scan. */
  t: string;
  /** All findings, acknowledged included. */
  total: number;
  /** Findings not acknowledged at scan time — the number the user cares about. */
  active: number;
}

type TrendFile = Partial<Record<ScanFeature, TrendPoint[]>>;

/** Keep the last N scans per feature — enough for a trend, bounded on disk. */
const MAX_POINTS = 60;

function trendPath(repoRoot: string): string {
  return path.join(repoRoot, '.code-workbench', 'scan-trends.json');
}

async function readFile(repoRoot: string): Promise<TrendFile> {
  try {
    return JSON.parse(await fs.readFile(trendPath(repoRoot), 'utf8')) as TrendFile;
  } catch {
    return {};
  }
}

/** Append one scan result and return the feature's full (capped) history. */
export async function appendTrendPoint(
  repoRoot: string,
  feature: ScanFeature,
  point: TrendPoint,
): Promise<TrendPoint[]> {
  const all = await readFile(repoRoot);
  const series = [...(all[feature] ?? []), point].slice(-MAX_POINTS);
  all[feature] = series;
  const file = trendPath(repoRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(all, null, 2), 'utf8');
  return series;
}
