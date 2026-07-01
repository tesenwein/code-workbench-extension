/* Reads and writes the architecture-wiki cards that back the Architecture
 * panel. Each component is one JSON file under `.code-workbench/.arch/`,
 * the same store the bundled arch MCP server (mcp-core/arch-server.mjs) reads
 * and writes — so cards authored by Claude and cards edited in the panel are
 * one and the same. Ported from the Electron app's main/arch.ts, minus the
 * Electron/IPC/WSL plumbing: the extension host already has a real fs path. */

import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';

const fsp = fs.promises;

/* Plain data shape of an architecture-wiki card. Declared here (not imported
 * from @code-workbench/ui) so the host's non-JSX `src` tsconfig never pulls in
 * the UI package's .tsx barrel — structurally identical to the ui ArchCard,
 * exactly as DeadCodeItem is mirrored between mcp-core and ui. */
export interface ArchCard {
  slug: string;
  name: string;
  description: string;
  files: string[];
  guidelines: string[];
  anti_patterns: string[];
  decisions: string[];
  dependsOn: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function archDirPath(repoRoot: string): string {
  return path.join(repoRoot, '.code-workbench', '.arch');
}

function normalizeCard(raw: unknown): ArchCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.slug !== 'string' || !c.slug) return null;
  return {
    slug: c.slug,
    name: typeof c.name === 'string' ? c.name : c.slug,
    description: typeof c.description === 'string' ? c.description : '',
    files: Array.isArray(c.files) ? (c.files as string[]) : [],
    guidelines: Array.isArray(c.guidelines) ? (c.guidelines as string[]) : [],
    anti_patterns: Array.isArray(c.anti_patterns) ? (c.anti_patterns as string[]) : [],
    decisions: Array.isArray(c.decisions) ? (c.decisions as string[]) : [],
    dependsOn: Array.isArray(c.dependsOn) ? (c.dependsOn as string[]) : [],
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
  };
}

function assertSafeSlug(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid arch card slug: «${slug}». Must match /^[a-z0-9-]+$/.`);
  }
  return slug;
}

/** Absolute path of a card's JSON file, validated against path traversal.
 *  Exported so the panel can open the card in the normal editor. */
export function archCardPath(repoRoot: string, slug: string): string {
  return safeArchCardPath(repoRoot, slug);
}

function safeArchCardPath(repoRoot: string, slug: string): string {
  assertSafeSlug(slug);
  const dir = archDirPath(repoRoot);
  const resolved = path.resolve(path.join(dir, `${slug}.json`));
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`Path traversal detected for slug: «${slug}».`);
  }
  return resolved;
}

// Serialize writes per-file so a panel edit and a concurrent MCP write of the
// same card can't interleave their tmp-file rename dance.
const archWriteLocks = new Map<string, Promise<void>>();
function withArchLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = archWriteLocks.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fn())
    .finally(() => {
      if (archWriteLocks.get(key) === next) archWriteLocks.delete(key);
    }) as Promise<void>;
  archWriteLocks.set(key, next);
  return next;
}

export async function readAllArchCards(repoRoot: string): Promise<ArchCard[]> {
  const dir = archDirPath(repoRoot);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const cards: ArchCard[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, entry), 'utf8');
      const card = normalizeCard(JSON.parse(raw));
      if (card) cards.push(card);
    } catch {
      /* skip malformed */
    }
  }
  return cards;
}

async function writeArchCard(repoRoot: string, card: ArchCard): Promise<void> {
  await fsp.mkdir(archDirPath(repoRoot), { recursive: true });
  const file = safeArchCardPath(repoRoot, card.slug);
  return withArchLock(file, async () => {
    const tmp = file + '.' + randomBytes(6).toString('hex') + '.tmp';
    try {
      await fsp.writeFile(tmp, JSON.stringify(card, null, 2), 'utf8');
      await fsp.rename(tmp, file);
    } catch (err) {
      try {
        await fsp.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

export async function upsertArchCard(
  repoRoot: string,
  input: Partial<ArchCard> & { name: string },
): Promise<ArchCard> {
  if (!input.name) throw new Error('card.name is required');
  const slug =
    input.slug ??
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  assertSafeSlug(slug);
  const existing = (await readAllArchCards(repoRoot)).find((c) => c.slug === slug);
  const now = new Date().toISOString();
  const card: ArchCard = {
    ...(existing ?? {}),
    slug,
    name: input.name,
    description: input.description ?? existing?.description ?? '',
    files: input.files ?? existing?.files ?? [],
    guidelines: input.guidelines ?? existing?.guidelines ?? [],
    anti_patterns: input.anti_patterns ?? existing?.anti_patterns ?? [],
    decisions: input.decisions ?? existing?.decisions ?? [],
    dependsOn: input.dependsOn ?? existing?.dependsOn ?? [],
    tags: input.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeArchCard(repoRoot, card);
  return card;
}

export async function deleteArchCard(repoRoot: string, slug: string): Promise<boolean> {
  try {
    await fsp.unlink(safeArchCardPath(repoRoot, slug));
    return true;
  } catch {
    return false;
  }
}
