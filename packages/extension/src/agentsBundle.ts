// Installs the bundled workbench agent definitions into a target
// .claude/agents directory. Agent definitions come from the shared
// @code-workbench/mcp-core package; esbuild inlines them into the extension
// bundle at build time.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { BUNDLED_AGENTS, LEGACY_AGENT_NAMES } from '@code-workbench/mcp-core/agents';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install bundled workbench agents into <target>/.claude/agents/<name>.md.
 * Overwrites existing files and removes legacy-named agent files. Pass
 * `only` to write a subset (the user-scope backfill installs missing agents
 * without touching user-modified copies).
 */
export async function installWorkbenchAgents(
  targetPath: string,
  opts?: { only?: string[] },
): Promise<{ installed: string[]; removed: string[] }> {
  const installed: string[] = [];
  const removed: string[] = [];
  if (!targetPath) return { installed, removed };
  const agentsDir = path.join(targetPath, '.claude', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });

  for (const legacy of LEGACY_AGENT_NAMES) {
    const legacyFile = path.join(agentsDir, `${legacy}.md`);
    if (await exists(legacyFile)) {
      await fs.rm(legacyFile, { force: true });
      removed.push(legacy);
    }
  }

  for (const agent of BUNDLED_AGENTS) {
    if (opts?.only && !opts.only.includes(agent.name)) continue;
    await fs.writeFile(path.join(agentsDir, `${agent.name}.md`), agent.body);
    installed.push(agent.name);
  }

  return { installed, removed };
}

export interface AgentsDrift {
  /** True when at least one bundled or legacy agent file exists at the target. */
  installedAny: boolean;
  /** Installed agent .md differs from the bundled body. */
  stale: string[];
  /** Bundled agent with no installed .md file. */
  missing: string[];
  /** Legacy-named agent files still present. */
  legacy: string[];
}

/**
 * Read-only drift check: byte-compare each installed workbench agent under
 * <target>/.claude/agents against the bundled bodies. Never writes — callers
 * prompt the user and apply via installWorkbenchAgents on confirmation.
 */
export async function checkWorkbenchAgents(targetPath: string): Promise<AgentsDrift> {
  const agentsDir = path.join(targetPath, '.claude', 'agents');
  const stale: string[] = [];
  const missing: string[] = [];
  const legacy: string[] = [];
  let installedAny = false;

  for (const name of LEGACY_AGENT_NAMES) {
    if (await exists(path.join(agentsDir, `${name}.md`))) {
      legacy.push(name);
      installedAny = true;
    }
  }

  for (const agent of BUNDLED_AGENTS) {
    const file = path.join(agentsDir, `${agent.name}.md`);
    try {
      const current = await fs.readFile(file, 'utf8');
      installedAny = true;
      if (current !== agent.body) stale.push(agent.name);
    } catch {
      missing.push(agent.name);
    }
  }

  return { installedAny, stale, missing, legacy };
}

/**
 * Stable fingerprint of the bundled agent set, used to remember a dismissed
 * update prompt until the shipped agents actually change again.
 */
export function agentsBundleSignature(): string {
  const hash = createHash('sha256');
  const agents = [...BUNDLED_AGENTS].sort((a, b) => a.name.localeCompare(b.name));
  for (const agent of agents) hash.update(agent.name).update('\0').update(agent.body);
  return hash.digest('hex').slice(0, 16);
}
