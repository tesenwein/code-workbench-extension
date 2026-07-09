// Detects and backfills missing Code Workbench MCP permissions in a target's
// `.claude/settings.json`. Mirrors the skillsBundle.ts drift pattern: a
// read-only check the caller can prompt on, and a separate apply step that
// merges rather than overwrites — every other key and any permission entries
// the user added themselves are left untouched.

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

/**
 * Whether <target>/.claude/settings.json already exists — the opt-in signal
 * for the drift prompt. Mirrors skillsBundle's `installedAny`: only nag users
 * who've already engaged with Claude Code settings in this scope, never
 * first-time users who've never created the file.
 */
export async function hasClaudeSettingsFile(targetPath: string): Promise<boolean> {
  try {
    await fs.access(settingsFile(targetPath));
    return true;
  } catch {
    return false;
  }
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
 * Read-only drift check: which of Code Workbench's own MCP permissions are
 * missing from <target>/.claude/settings.json's `permissions.allow`. Never
 * writes — callers prompt the user and apply via installWorkbenchPermissions.
 */
export async function checkWorkbenchPermissions(targetPath: string): Promise<string[]> {
  const settings = await readSettings(settingsFile(targetPath));
  const allow = settings.permissions?.allow ?? [];
  return WORKBENCH_PERMISSIONS.filter((p) => !allow.includes(p));
}

/**
 * Merge Code Workbench's own MCP permissions into <target>/.claude/settings.json,
 * creating the file if absent. Preserves every other key and any permission
 * entries already there — only appends what's missing.
 */
export async function installWorkbenchPermissions(targetPath: string): Promise<string[]> {
  const file = settingsFile(targetPath);
  const settings = await readSettings(file);
  const allow = settings.permissions?.allow ?? [];
  const missing = WORKBENCH_PERMISSIONS.filter((p) => !allow.includes(p));
  if (missing.length === 0) return [];

  const next: ClaudeSettings = {
    ...settings,
    permissions: { ...settings.permissions, allow: [...allow, ...missing] },
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return missing;
}

/**
 * Stable fingerprint of the canonical permission list, used to remember a
 * dismissed drift prompt until the list itself changes again.
 */
export function workbenchPermissionsSignature(): string {
  return [...WORKBENCH_PERMISSIONS].sort().join('\0');
}
