// Semantic search over architecture-wiki cards.
//
// Reads `.code-workbench/.arch/*.json` under --root, ranks each card against
// --query by local-embedding cosine similarity, and prints a JSON array of
// { slug, score } sorted best-first. Prints `[]` when semantic search is
// unavailable (no embedding model) so the caller falls back to substring
// filtering — the same graceful-degradation contract code-search uses.
//
// Modes: one-shot CLI (--query/--root/--limit), or `--serve` — a long-lived
// worker speaking JSON-lines over stdin/stdout ({id, root, query, limit} →
// {id, results}), so the embedding model loads once and stays warm across
// queries instead of being reloaded per spawn.
//
// Exports searchArchCards() for use as a library.

import { isCliEntry } from "./cli-entry.mjs";
import { readArchCards } from "./arch-cards.mjs";
import { semanticScores } from "./semantic-search.mjs";

// Cards scoring below this cosine floor are noise for the query. Dropping
// them keeps a nonsense query from surfacing the whole ranked corpus and
// makes the caller's "no matches" empty state reachable.
const MIN_SCORE = 0.25;

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

/**
 * Rank arch cards under `root` against `query` by embedding similarity.
 * Cards below the relevance floor are dropped, so an off-topic query can
 * legitimately return nothing.
 * @param {{ root: string; query: string; limit?: number }} opts
 * @returns {Promise<Array<{ slug: string; score: number }>>} best-first, or
 *   `[]` when there are no cards, no relevant cards, or semantic search is
 *   unavailable.
 */
export async function searchArchCards({ root, query, limit }) {
  if (!query || !root) return [];
  const cards = await readArchCards(root);
  if (!cards.length) return [];
  const docs = cards.map((c) => ({ id: c.slug, text: cardText(c) }));
  const scores = await semanticScores({ query, docs });
  if (!scores) return []; // model absent — caller substring-filters instead
  const ranked = cards
    .map((c) => ({ slug: c.slug, score: scores.get(c.slug) ?? 0 }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

// Worker mode: answer JSON-line requests until stdin closes. Keeps the
// embedder (and semantic-search's in-memory vector cache) warm.
async function serve() {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  // Exit only once stdin has closed AND every accepted request has answered —
  // exiting straight on 'close' would drop in-flight responses.
  let inFlight = 0;
  let closed = false;
  const maybeExit = () => {
    if (closed && inFlight === 0) process.exit(0);
  };
  rl.on("line", (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return; // ignore garbage lines
    }
    inFlight++;
    searchArchCards(req)
      .then((results) => {
        process.stdout.write(JSON.stringify({ id: req.id, results }) + "\n");
      })
      .catch((err) => {
        process.stdout.write(
          JSON.stringify({ id: req.id, error: String(err?.message ?? err) }) + "\n",
        );
      })
      .finally(() => {
        inFlight--;
        maybeExit();
      });
  });
  rl.on("close", () => {
    closed = true;
    maybeExit();
  });
}

function parseCliArgs(argv) {
  const opts = { root: "", query: "", serve: false };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    if (argv[i] === "--query") opts.query = next();
    else if (argv[i] === "--root") opts.root = next();
    else if (argv[i] === "--limit") opts.limit = Number(next());
    else if (argv[i] === "--serve") opts.serve = true;
  }
  return opts;
}

if (isCliEntry(import.meta.url, "arch-search.mjs")) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.serve) {
    serve();
  } else {
    searchArchCards(opts)
      .then((results) => process.stdout.write(JSON.stringify(results)))
      .catch((err) => {
        process.stderr.write(`[arch-search] ${err?.stack ?? err}\n`);
        process.exit(1);
      });
  }
}
