import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUNDLED_SKILLS } from '@code-workbench/mcp-core/skills';
import { BUNDLED_AGENTS } from '@code-workbench/mcp-core/agents';
import { cleanupWorktreeAssets, injectWorktreeAssets } from '../src/worktreeAssets';
import { removeUnmodifiedWorkbenchAgents } from '../src/agentsBundle';

let tmp: string;

const git = (args: string[], cwd = tmp) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

async function initRepo(): Promise<void> {
  git(['init', '-q']);
  git(['config', 'user.email', 'test@test']);
  git(['config', 'user.name', 'test']);
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

const firstSkill = BUNDLED_SKILLS[0];
const firstAgent = BUNDLED_AGENTS[0];
const skillFile = () => path.join(tmp, '.claude', 'skills', firstSkill.name, 'SKILL.md');
const agentFile = () => path.join(tmp, '.claude', 'agents', `${firstAgent.name}.md`);
const manifestFile = () => path.join(tmp, '.claude', '.cw-injected.json');

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-wt-assets-'));
  await initRepo();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('injectWorktreeAssets', () => {
  it('installs every bundled skill and agent plus a manifest', async () => {
    await injectWorktreeAssets(tmp);
    for (const s of BUNDLED_SKILLS) {
      expect(await fs.readFile(path.join(tmp, '.claude', 'skills', s.name, 'SKILL.md'), 'utf8')).toBe(
        s.body,
      );
    }
    for (const a of BUNDLED_AGENTS) {
      expect(await fs.readFile(path.join(tmp, '.claude', 'agents', `${a.name}.md`), 'utf8')).toBe(
        a.body,
      );
    }
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf8'));
    expect(manifest.files).toContain(`.claude/skills/${firstSkill.name}/SKILL.md`);
    expect(manifest.files).toContain(`.claude/agents/${firstAgent.name}.md`);
  });

  it('keeps git status clean via the info/exclude block', async () => {
    await injectWorktreeAssets(tmp);
    expect(git(['status', '--porcelain']).trim()).toBe('');
    const exclude = await fs.readFile(path.join(tmp, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('code-workbench injected assets');
    expect(exclude).toContain(`.claude/skills/${firstSkill.name}/SKILL.md`);
  });

  it('is idempotent — a second run rewrites the same exclude block, not a second one', async () => {
    await injectWorktreeAssets(tmp);
    await injectWorktreeAssets(tmp);
    const exclude = await fs.readFile(path.join(tmp, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('code-workbench injected assets (auto-generated)').length).toBe(2);
  });

  it('refreshes a stale owned copy back to the bundled body', async () => {
    await injectWorktreeAssets(tmp);
    await fs.writeFile(skillFile(), 'stale edit');
    await injectWorktreeAssets(tmp);
    expect(await fs.readFile(skillFile(), 'utf8')).toBe(firstSkill.body);
  });

  it('never clobbers a pre-existing foreign file with different content', async () => {
    await fs.mkdir(path.dirname(skillFile()), { recursive: true });
    await fs.writeFile(skillFile(), 'user authored');
    await injectWorktreeAssets(tmp);
    expect(await fs.readFile(skillFile(), 'utf8')).toBe('user authored');
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf8'));
    expect(manifest.files).not.toContain(`.claude/skills/${firstSkill.name}/SKILL.md`);
  });

  it('never touches a git-tracked file even when its content matches the bundle', async () => {
    await fs.mkdir(path.dirname(agentFile()), { recursive: true });
    await fs.writeFile(agentFile(), firstAgent.body);
    git(['add', '.claude']);
    git(['commit', '-qm', 'track agent']);
    await injectWorktreeAssets(tmp);
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf8'));
    expect(manifest.files).not.toContain(`.claude/agents/${firstAgent.name}.md`);
  });

  it('adopts an identical untracked copy from an older explicit install', async () => {
    await fs.mkdir(path.dirname(skillFile()), { recursive: true });
    await fs.writeFile(skillFile(), firstSkill.body);
    await injectWorktreeAssets(tmp);
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf8'));
    expect(manifest.files).toContain(`.claude/skills/${firstSkill.name}/SKILL.md`);
  });

  it('removes owned files the bundle no longer ships', async () => {
    await injectWorktreeAssets(tmp);
    const goneRel = '.claude/skills/cw-gone/SKILL.md';
    const goneAbs = path.join(tmp, ...goneRel.split('/'));
    await fs.mkdir(path.dirname(goneAbs), { recursive: true });
    await fs.writeFile(goneAbs, 'old skill');
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf8'));
    manifest.files.push(goneRel);
    await fs.writeFile(manifestFile(), JSON.stringify(manifest));
    await injectWorktreeAssets(tmp);
    expect(await exists(goneAbs)).toBe(false);
    expect(await exists(path.dirname(goneAbs))).toBe(false);
  });
});

describe('cleanupWorktreeAssets', () => {
  it('removes injected files, the manifest, and now-empty .claude dirs', async () => {
    await injectWorktreeAssets(tmp);
    await cleanupWorktreeAssets(tmp);
    expect(await exists(path.join(tmp, '.claude'))).toBe(false);
  });

  it('leaves foreign files (and their dirs) in place', async () => {
    const foreign = path.join(tmp, '.claude', 'skills', 'my-skill', 'SKILL.md');
    await fs.mkdir(path.dirname(foreign), { recursive: true });
    await fs.writeFile(foreign, 'mine');
    await injectWorktreeAssets(tmp);
    await cleanupWorktreeAssets(tmp);
    expect(await fs.readFile(foreign, 'utf8')).toBe('mine');
    expect(await exists(skillFile())).toBe(false);
    expect(await exists(manifestFile())).toBe(false);
  });

  it('is a no-op on a worktree that was never injected', async () => {
    await cleanupWorktreeAssets(tmp);
    expect(await exists(path.join(tmp, '.claude'))).toBe(false);
  });
});

describe('removeUnmodifiedWorkbenchAgents', () => {
  it('removes byte-identical copies and keeps modified ones', async () => {
    const dir = path.join(tmp, '.claude', 'agents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${BUNDLED_AGENTS[0].name}.md`), BUNDLED_AGENTS[0].body);
    await fs.writeFile(path.join(dir, `${BUNDLED_AGENTS[1].name}.md`), 'user modified');
    const { removed, kept } = await removeUnmodifiedWorkbenchAgents(tmp);
    expect(removed).toContain(BUNDLED_AGENTS[0].name);
    expect(kept).toEqual([BUNDLED_AGENTS[1].name]);
    expect(await exists(path.join(dir, `${BUNDLED_AGENTS[0].name}.md`))).toBe(false);
    expect(await fs.readFile(path.join(dir, `${BUNDLED_AGENTS[1].name}.md`), 'utf8')).toBe(
      'user modified',
    );
  });

  it('prunes the agents dir when everything was removed', async () => {
    const dir = path.join(tmp, '.claude', 'agents');
    await fs.mkdir(dir, { recursive: true });
    for (const a of BUNDLED_AGENTS) await fs.writeFile(path.join(dir, `${a.name}.md`), a.body);
    const { kept } = await removeUnmodifiedWorkbenchAgents(tmp);
    expect(kept).toEqual([]);
    expect(await exists(dir)).toBe(false);
  });
});
