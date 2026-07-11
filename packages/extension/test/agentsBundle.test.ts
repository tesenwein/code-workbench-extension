import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUNDLED_AGENTS } from '@code-workbench/mcp-core/agents';
import {
  agentsBundleSignature,
  checkWorkbenchAgents,
  installWorkbenchAgents,
} from '../src/agentsBundle';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-agents-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('BUNDLED_AGENTS', () => {
  it('every agent has frontmatter with name, description, and model', () => {
    for (const agent of BUNDLED_AGENTS) {
      expect(agent.body.startsWith('---\n')).toBe(true);
      expect(agent.body).toContain(`name: ${agent.name}`);
      expect(agent.body).toContain('description: ');
      expect(agent.body).toContain('model: ');
    }
  });

  it('the reviewer is code-read-only: no Edit or Write in its toolset', () => {
    const reviewer = BUNDLED_AGENTS.find((a) => a.name === 'cw-reviewer');
    expect(reviewer).toBeDefined();
    const tools = reviewer!.body.match(/^tools: (.*)$/m)?.[1] ?? '';
    expect(tools).toContain('Read');
    expect(tools.split(', ')).not.toContain('Edit');
    expect(tools.split(', ')).not.toContain('Write');
  });
});

describe('checkWorkbenchAgents', () => {
  it('reports installedAny=false when nothing was ever installed', async () => {
    const drift = await checkWorkbenchAgents(tmp);
    expect(drift.installedAny).toBe(false);
    expect(drift.missing.length).toBe(BUNDLED_AGENTS.length);
    expect(drift.stale).toEqual([]);
    expect(drift.legacy).toEqual([]);
  });

  it('is clean right after a full install', async () => {
    await installWorkbenchAgents(tmp);
    const drift = await checkWorkbenchAgents(tmp);
    expect(drift.installedAny).toBe(true);
    expect(drift.stale).toEqual([]);
    expect(drift.missing).toEqual([]);
    expect(drift.legacy).toEqual([]);
  });

  it('flags stale and missing agents without writing anything', async () => {
    await installWorkbenchAgents(tmp);
    const first = BUNDLED_AGENTS[0].name;
    const second = BUNDLED_AGENTS[1].name;
    const staleFile = path.join(tmp, '.claude', 'agents', `${first}.md`);
    await fs.writeFile(staleFile, 'hand-edited');
    await fs.rm(path.join(tmp, '.claude', 'agents', `${second}.md`));

    const drift = await checkWorkbenchAgents(tmp);
    expect(drift.stale).toEqual([first]);
    expect(drift.missing).toEqual([second]);
    // read-only: the edited file must be untouched
    expect(await fs.readFile(staleFile, 'utf8')).toBe('hand-edited');
  });
});

describe('installWorkbenchAgents', () => {
  it('with `only` writes just the listed agents and leaves the rest alone', async () => {
    await installWorkbenchAgents(tmp);
    const first = BUNDLED_AGENTS[0].name;
    const second = BUNDLED_AGENTS[1].name;
    const editedFile = path.join(tmp, '.claude', 'agents', `${first}.md`);
    await fs.writeFile(editedFile, 'hand-edited');
    await fs.rm(path.join(tmp, '.claude', 'agents', `${second}.md`));

    const { installed } = await installWorkbenchAgents(tmp, { only: [second] });
    expect(installed).toEqual([second]);
    // the backfill restored the missing agent but never clobbered the edit
    expect(await fs.readFile(editedFile, 'utf8')).toBe('hand-edited');
    const restored = path.join(tmp, '.claude', 'agents', `${second}.md`);
    expect(await fs.readFile(restored, 'utf8')).toBe(BUNDLED_AGENTS[1].body);
  });
});

describe('agentsBundleSignature', () => {
  it('is stable across calls', () => {
    expect(agentsBundleSignature()).toBe(agentsBundleSignature());
    expect(agentsBundleSignature()).toMatch(/^[0-9a-f]{16}$/);
  });
});
