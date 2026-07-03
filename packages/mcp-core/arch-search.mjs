// Semantic search over architecture-wiki cards.
//
// Reads `.code-workbench/.arch/*.json` under --root, ranks each card against
// --query by local-embedding cosine similarity, and prints a JSON array of
// { slug, score } sorted best-first. Prints `[]` when semantic search is
// unavailable (no embedding model) so the caller falls back to substring
// filtering — the same graceful-degradation contract code-search uses.
// Exports searchArchCards() for use as a library.

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { semanticScores } from "./semantic-search.mjs";

// Flatten a card into one embedding document — name + prose + every list so a
// query can match a guideline, a dependency, or a file path, not just the name.
function cardText(c) {
  return [
    c.name,
    c.description,
    ...(Array.isArray(c.files) ? c.files : []),
    ...(Array.isArray(c.guidelines) ? c.guidelines : []),
    ...(Array.isArray(c.anti_patterns) ? c.anti_patterns : []),
    ...(Array.isArray(c.decisions) ? c.decisions : []),
    ...(Array.isArray(c.dependsOn) ? c.dependsOn : []),
    ...(Array.isArray(c.tags) ? c.tags : []),
  ]
    .filter(Boolean)
    .join("\n");
}

async function readCards(root) {
  const dir = path.join(root, ".code-workbench", ".arch");
  let entries;
  try {
    entries = await fsPromises.readdir(dir);
  } catch {
    return [];
  }
  const cards = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fsPromises.readFile(path.join(dir, entry), "utf8");
      const c = JSON.parse(raw);
      if (c && typeof c.slug === "string" && c.slug) cards.push(c);
    } catch {
      /* skip malformed */
    }
  }
  return cards;
}

/**
 * Rank arch cards under `root` against `query` by embedding similarity.
 * @param {{ root: string; query: string; limit?: number }} opts
 * @returns {Promise<Array<{ slug: string; score: number }>>} best-first, or
 *   `[]` when there are no cards or semantic search is unavailable.
 */
export async function searchArchCards({ root, query, limit }) {
  if (!query || !root) return [];
  const cards = await readCards(root);
  if (!cards.length) return [];
  const docs = cards.map((c) => ({ id: c.slug, text: cardText(c) }));
  const scores = await semanticScores({ query, docs });
  if (!scores) return []; // model absent — caller substring-filters instead
  const ranked = cards
    .map((c) => ({ slug: c.slug, score: scores.get(c.slug) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

function parseCliArgs(argv) {
  const opts = { root: "", query: "" };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    if (argv[i] === "--query") opts.query = next();
    else if (argv[i] === "--root") opts.root = next();
    else if (argv[i] === "--limit") opts.limit = Number(next());
  }
  return opts;
}

// realpathSync resolves pnpm symlinks so a spawn via the symlinked path still
// matches node's canonicalised import.meta.url. The basename guard prevents a
// false CLI-run when this file is bundled into another script.
const __entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
if (
  __entry &&
  path.basename(__entry) === "arch-search.mjs" &&
  pathToFileURL(__entry).href === import.meta.url
) {
  searchArchCards(parseCliArgs(process.argv.slice(2)))
    .then((results) => process.stdout.write(JSON.stringify(results)))
    .catch((err) => {
      process.stderr.write(`[arch-search] ${err?.stack ?? err}\n`);
      process.exit(1);
    });
}
