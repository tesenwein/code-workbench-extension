// Installs the bundled workbench skills into a target .claude/skills directory.
// Skill definitions come from the shared @code-workbench/mcp-core package;
// esbuild inlines them into the extension bundle at build time.

import { promises as fs } from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS, LEGACY_SKILL_NAMES } from '@code-workbench/mcp-core/skills';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install bundled workbench skills into <worktree>/.claude/skills/<name>/SKILL.md.
 * Overwrites existing files and removes legacy-named skill folders.
 * Triggered manually from the global settings panel — not on session start.
 */
export async function installWorkbenchSkills(
  worktreePath: string,
): Promise<{ installed: string[]; removed: string[] }> {
  const installed: string[] = [];
  const removed: string[] = [];
  if (!worktreePath) return { installed, removed };
  const skillsDir = path.join(worktreePath, '.claude', 'skills');
  await fs.mkdir(skillsDir, { recursive: true });

  for (const legacy of LEGACY_SKILL_NAMES) {
    const legacyDir = path.join(skillsDir, legacy);
    if (await exists(legacyDir)) {
      await fs.rm(legacyDir, { recursive: true, force: true });
      removed.push(legacy);
    }
  }

  for (const skill of BUNDLED_SKILLS) {
    const dir = path.join(skillsDir, skill.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), skill.body);
    installed.push(skill.name);
  }

  return { installed, removed };
}
