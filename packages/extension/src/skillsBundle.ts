// Installs the bundled workbench skills into a target .claude/skills directory.
// Skill definitions come from the shared @code-workbench/mcp-core package;
// esbuild inlines them into the extension bundle at build time.

import { createHash } from 'crypto';
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

export interface SkillsDrift {
  /** True when at least one bundled or legacy skill folder exists at the target. */
  installedAny: boolean;
  /** Installed SKILL.md differs from the bundled body. */
  stale: string[];
  /** Bundled skill with no installed SKILL.md. */
  missing: string[];
  /** Legacy-named skill folders still present. */
  legacy: string[];
}

/**
 * Read-only drift check: byte-compare each installed workbench skill under
 * <target>/.claude/skills against the bundled bodies. Never writes — callers
 * prompt the user and apply via installWorkbenchSkills on confirmation.
 */
export async function checkWorkbenchSkills(targetPath: string): Promise<SkillsDrift> {
  const skillsDir = path.join(targetPath, '.claude', 'skills');
  const stale: string[] = [];
  const missing: string[] = [];
  const legacy: string[] = [];
  let installedAny = false;

  for (const name of LEGACY_SKILL_NAMES) {
    if (await exists(path.join(skillsDir, name))) {
      legacy.push(name);
      installedAny = true;
    }
  }

  for (const skill of BUNDLED_SKILLS) {
    const file = path.join(skillsDir, skill.name, 'SKILL.md');
    try {
      const current = await fs.readFile(file, 'utf8');
      installedAny = true;
      if (current !== skill.body) stale.push(skill.name);
    } catch {
      missing.push(skill.name);
    }
  }

  return { installedAny, stale, missing, legacy };
}

/**
 * Stable fingerprint of the bundled skill set, used to remember a dismissed
 * update prompt until the shipped skills actually change again.
 */
export function skillsBundleSignature(): string {
  const hash = createHash('sha256');
  const skills = [...BUNDLED_SKILLS].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of skills) hash.update(skill.name).update('\0').update(skill.body);
  return hash.digest('hex').slice(0, 16);
}
