// Shared reader for architecture-wiki cards (`.code-workbench/.arch/*.json`).
//
// The single source of truth for locating and loading cards, used by the
// arch MCP server (BM25 arch_search) and the semantic arch-search detector so
// both always see the same card set.

import fs from "node:fs/promises";
import path from "node:path";

/** Directory holding a repo's arch cards. */
export function archCardsDir(repoPath) {
  return path.join(repoPath, ".code-workbench", ".arch");
}

/**
 * Read every valid card under `repoPath`. Malformed JSON and cards without a
 * non-empty string slug are skipped; a missing dir yields `[]`.
 *
 * @param {string} repoPath
 * @returns {Promise<Array<Record<string, unknown> & { slug: string }>>}
 */
export async function readArchCards(repoPath) {
  const dir = archCardsDir(repoPath);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const cards = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf8");
      const card = JSON.parse(raw);
      if (card && typeof card.slug === "string" && card.slug) cards.push(card);
    } catch {
      /* skip malformed */
    }
  }
  return cards;
}
