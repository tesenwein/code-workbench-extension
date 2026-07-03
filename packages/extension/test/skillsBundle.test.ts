import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUNDLED_SKILLS, LEGACY_SKILL_NAMES } from '@code-workbench/mcp-core/skills';
import {
  checkWorkbenchSkills,
  installWorkbenchSkills,
  skillsBundleSignature,
} from '../src/skillsBundle';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-skills-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('checkWorkbenchSkills', () => {
  it('reports installedAny=false when nothing was ever installed', async () => {
    const drift = await checkWorkbenchSkills(tmp);
    expect(drift.installedAny).toBe(false);
    expect(drift.missing.length).toBe(BUNDLED_SKILLS.length);
    expect(drift.stale).toEqual([]);
    expect(drift.legacy).toEqual([]);
  });

  it('is clean right after a full install', async () => {
    await installWorkbenchSkills(tmp);
    const drift = await checkWorkbenchSkills(tmp);
    expect(drift.installedAny).toBe(true);
    expect(drift.stale).toEqual([]);
    expect(drift.missing).toEqual([]);
    expect(drift.legacy).toEqual([]);
  });

  it('flags stale and missing skills without writing anything', async () => {
    await installWorkbenchSkills(tmp);
    const first = BUNDLED_SKILLS[0].name;
    const second = BUNDLED_SKILLS[1].name;
    const staleFile = path.join(tmp, '.claude', 'skills', first, 'SKILL.md');
    await fs.writeFile(staleFile, 'hand-edited');
    await fs.rm(path.join(tmp, '.claude', 'skills', second), { recursive: true });

    const drift = await checkWorkbenchSkills(tmp);
    expect(drift.stale).toEqual([first]);
    expect(drift.missing).toEqual([second]);
    // read-only: the edited file must be untouched
    expect(await fs.readFile(staleFile, 'utf8')).toBe('hand-edited');
  });

  it('flags leftover legacy skill folders', async () => {
    const legacyDir = path.join(tmp, '.claude', 'skills', LEGACY_SKILL_NAMES[0]);
    await fs.mkdir(legacyDir, { recursive: true });
    const drift = await checkWorkbenchSkills(tmp);
    expect(drift.installedAny).toBe(true);
    expect(drift.legacy).toEqual([LEGACY_SKILL_NAMES[0]]);
  });
});

describe('skillsBundleSignature', () => {
  it('is stable across calls', () => {
    expect(skillsBundleSignature()).toBe(skillsBundleSignature());
    expect(skillsBundleSignature()).toMatch(/^[0-9a-f]{16}$/);
  });
});
