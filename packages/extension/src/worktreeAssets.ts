// Per-worktree injection of the bundled workbench skills and agents.
//
// Every Claude session launch refreshes <worktree>/.claude/skills and
// .claude/agents from the bundle, so the installed copies always match the
// running extension version and only exist where the cw-code MCP server is
// also injected. A manifest (.claude/.cw-injected.json) records exactly which
// files the workbench wrote: only manifest-owned files are ever overwritten
// or deleted, so repo-tracked or user-authored files with the same name are
// never clobbered. Injected paths are hidden from git status via a managed
// marker block in the repo's shared .git/info/exclude (common across all
// worktrees), never by touching tracked files.

import { promises as fs } from 'fs';
import * as path from 'path';
import { BUNDLED_SKILLS } from '@code-workbench/mcp-core/skills';
import { BUNDLED_AGENTS } from '@code-workbench/mcp-core/agents';
import { gitRaw } from './git';

const MANIFEST_REL = '.claude/.cw-injected.json';
const EXCLUDE_BEGIN = '# >>> code-workbench injected assets (auto-generated) >>>';
const EXCLUDE_END = '# <<< code-workbench injected assets <<<';

interface InjectManifest {
  version: 1;
  /** Worktree-relative posix paths of files the workbench wrote. */
  files: string[];
}

interface DesiredFile {
  rel: string;
  body: string;
}

/** Every file the current bundle wants installed, as worktree-relative paths. */
function desiredFiles(): DesiredFile[] {
  return [
    ...BUNDLED_SKILLS.map((s) => ({ rel: `.claude/skills/${s.name}/SKILL.md`, body: s.body })),
    ...BUNDLED_AGENTS.map((a) => ({ rel: `.claude/agents/${a.name}.md`, body: a.body })),
  ];
}

function abs(worktreePath: string, rel: string): string {
  return path.join(worktreePath, ...rel.split('/'));
}

async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

async function readManifest(worktreePath: string): Promise<InjectManifest> {
  const raw = await readIfExists(abs(worktreePath, MANIFEST_REL));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<InjectManifest>;
      if (Array.isArray(parsed.files)) {
        return { version: 1, files: parsed.files.filter((f) => typeof f === 'string') };
      }
    } catch {
      /* corrupt manifest — treat as empty and rebuild */
    }
  }
  return { version: 1, files: [] };
}

/** Worktree-relative posix paths under .claude/ that git tracks. */
async function trackedClaudeFiles(worktreePath: string): Promise<Set<string>> {
  try {
    const out = await gitRaw(worktreePath, ['ls-files', '-z', '--', '.claude'], {
      timeoutMs: 10_000,
    });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    // Not a repo / git unavailable — be conservative and treat nothing as
    // tracked; the content-compare guard below still protects foreign files.
    return new Set();
  }
}

/** Delete a file and prune now-empty parent dirs up to (excluding) stopDir. */
async function removeAndPrune(file: string, stopDir: string): Promise<void> {
  await fs.rm(file, { force: true });
  let dir = path.dirname(file);
  while (dir.startsWith(stopDir) && dir !== stopDir) {
    try {
      await fs.rmdir(dir); // fails when non-empty — that's the stop condition
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Rewrite the managed marker block in the repo's shared .git/info/exclude so
 * every injected path is invisible to git status in all worktrees. Idempotent;
 * user lines outside the block are preserved.
 */
async function ensureExcludeBlock(worktreePath: string): Promise<void> {
  let excludePath: string;
  try {
    const out = await gitRaw(worktreePath, ['rev-parse', '--git-path', 'info/exclude'], {
      timeoutMs: 10_000,
    });
    excludePath = path.resolve(worktreePath, out.trim());
  } catch {
    return; // not a repo — nothing to exclude from
  }
  const patterns = [MANIFEST_REL, ...desiredFiles().map((f) => f.rel)];
  const block = [EXCLUDE_BEGIN, ...patterns, EXCLUDE_END].join('\n');

  const current = (await readIfExists(excludePath)) ?? '';
  const begin = current.indexOf(EXCLUDE_BEGIN);
  const end = current.indexOf(EXCLUDE_END);
  let next: string;
  if (begin !== -1 && end !== -1 && end > begin) {
    next =
      current.slice(0, begin) + block + current.slice(end + EXCLUDE_END.length);
  } else {
    next = current + (current && !current.endsWith('\n') ? '\n' : '') + block + '\n';
  }
  if (next === current) return;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, next, 'utf8');
}

/**
 * Refresh the bundled workbench skills + agents inside `worktreePath`.
 * Called on every Claude session launch; never throws — a failed injection
 * must not block the session (the session just runs without local skills).
 */
export async function injectWorktreeAssets(worktreePath: string): Promise<void> {
  if (!worktreePath) return;
  try {
    const manifest = await readManifest(worktreePath);
    const owned = new Set(manifest.files);
    const tracked = await trackedClaudeFiles(worktreePath);
    const nextFiles: string[] = [];

    for (const { rel, body } of desiredFiles()) {
      const file = abs(worktreePath, rel);
      if (!owned.has(rel)) {
        if (tracked.has(rel)) continue; // repo-owned — never touch
        const current = await readIfExists(file);
        // A pre-existing file we didn't write and whose content differs is
        // user/repo-authored — skip it. An identical copy (e.g. from an older
        // explicit install) is safe to adopt.
        if (current !== undefined && current !== body) continue;
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body, 'utf8');
      nextFiles.push(rel);
    }

    // Owned files the bundle no longer ships (renamed/removed skills).
    const desired = new Set(desiredFiles().map((f) => f.rel));
    for (const rel of manifest.files) {
      if (desired.has(rel) || tracked.has(rel)) continue;
      await removeAndPrune(abs(worktreePath, rel), worktreePath);
    }

    const manifestFile = abs(worktreePath, MANIFEST_REL);
    if (nextFiles.length) {
      await fs.mkdir(path.dirname(manifestFile), { recursive: true });
      const body: InjectManifest = { version: 1, files: nextFiles.sort() };
      await fs.writeFile(manifestFile, JSON.stringify(body, null, 2) + '\n', 'utf8');
    } else {
      await removeAndPrune(manifestFile, worktreePath);
    }

    await ensureExcludeBlock(worktreePath);
  } catch (e) {
    console.warn('[worktree-assets] injection failed:', e);
  }
}

/**
 * Remove every workbench-injected file from `worktreePath` (manifest-owned
 * files, the manifest itself, and now-empty .claude dirs). Called before a
 * worktree is removed; also safe to run on a kept checkout. Files the
 * manifest doesn't own are never deleted. Never throws.
 */
export async function cleanupWorktreeAssets(worktreePath: string): Promise<void> {
  if (!worktreePath) return;
  try {
    const manifest = await readManifest(worktreePath);
    for (const rel of manifest.files) {
      // Paranoia: only ever delete inside .claude/, whatever the manifest says.
      if (!rel.startsWith('.claude/')) continue;
      await removeAndPrune(abs(worktreePath, rel), worktreePath);
    }
    await removeAndPrune(abs(worktreePath, MANIFEST_REL), worktreePath);
  } catch (e) {
    console.warn('[worktree-assets] cleanup failed:', e);
  }
}
