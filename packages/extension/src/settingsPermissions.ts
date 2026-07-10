// Backfills missing Code Workbench MCP permissions into a target's
// `.claude/settings.json`. Merges rather than overwrites — every other key and
// any permission entries the user added themselves are left untouched.

import { promises as fs } from 'fs';
import * as path from 'path';
import { WORKBENCH_PERMISSIONS } from '@code-workbench/mcp-core/workbench-permissions';

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function settingsFile(targetPath: string): string {
  return path.join(targetPath, '.claude', 'settings.json');
}

async function readSettings(file: string): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.trim() ? (JSON.parse(raw) as ClaudeSettings) : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * Merge Code Workbench's own MCP permissions into <target>/.claude/settings.json,
 * creating the file if absent. Preserves every other key and any permission
 * entries already there — only appends what's missing. Note: the file is
 * rewritten via JSON.parse/stringify, so any comments or custom formatting
 * a user hand-edited into settings.json are not preserved.
 */
export async function installWorkbenchPermissions(targetPath: string): Promise<string[]> {
  const file = settingsFile(targetPath);
  const settings = await readSettings(file);
  const rawAllow = settings.permissions?.allow;
  // A malformed `allow` (string, object, …) must not be spread into garbage and
  // written back — leave the user's file alone rather than corrupt it.
  if (rawAllow !== undefined && !Array.isArray(rawAllow)) {
    throw new Error(`${file}: permissions.allow is not an array — not touching it`);
  }
  const allow = rawAllow ?? [];
  const missing = WORKBENCH_PERMISSIONS.filter((p) => !allow.includes(p));
  if (missing.length === 0) return [];

  const next: ClaudeSettings = {
    ...settings,
    permissions: { ...settings.permissions, allow: [...allow, ...missing] },
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write atomically — a crash mid-write must not truncate the settings file.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
  return missing;
}
