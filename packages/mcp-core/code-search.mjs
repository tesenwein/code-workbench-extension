// Hybrid code search: walks source files, extracts symbols, ranks by query.
// Identifier-aware BM25 for recall, optional local-embedding semantic rerank
// of the top pool, and a fuzzy subsequence fallback when BM25 finds nothing.
// Exports searchCode() for use as a library.

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getParser,
  detectLanguage,
  extractTsSymbols,
  extractPythonSymbols,
} from "./ast-core.mjs";
import { tokenize, bm25Rank } from "./text-rank.mjs";
import { semanticScores } from "./semantic-search.mjs";
import {
  walkFiles,
  SKIP_DIRS,
  MAX_FILE_BYTES,
  SUPPORTED_EXTS,
} from "./file-walk.mjs";

// Re-exported for backward compatibility — file-walk.mjs is the source of truth.
export { walkFiles, SKIP_DIRS, MAX_FILE_BYTES, SUPPORTED_EXTS };

const CONCURRENCY = 8;

function isBinaryBuffer(buf) {
  const check = buf.slice(0, 8000);
  for (let i = 0; i < check.length; i++) {
    const b = check[i];
    if (b === 0) return true; // null byte → binary
  }
  return false;
}

async function extractSymbols(filePath) {
  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) return [];
    const buf = await fsPromises.readFile(filePath);
    if (isBinaryBuffer(buf)) return [];
    const source = buf.toString("utf8");
    const lang = detectLanguage(filePath);
    if (!lang) return [];
    const entry = await getParser(lang);
    if (!entry) return [];
    const tree = entry.parser.parse(source);
    const lines = source.split("\n");
    const extract = lang === "python" ? extractPythonSymbols : extractTsSymbols;
    const { symbols } = extract(tree.rootNode, source);
    return symbols.map((sym) => {
      const snippet = lines
        .slice(sym.startLine - 1, Math.min(sym.startLine + 3, sym.endLine + 1))
        .join("\n");
      return { ...sym, file: filePath, snippet };
    });
  } catch (err) {
    process.stderr.write(
      `[code-search] failed to parse ${filePath}: ${err?.message ?? err}\n`,
    );
    return [];
  }
}

function buildTokens(sym, filePath, roots) {
  const rel = roots.reduce((best, r) => {
    const candidate = path.relative(r, filePath);
    return candidate.length < best.length ? candidate : best;
  }, filePath);
  const pathTokens = tokenize(
    rel.replace(/[/\\]/g, " ").replace(/[^a-z0-9 ]/gi, " "),
  );
  // Boost symbol name ×3
  const nameTokens = [
    ...tokenize(sym.name),
    ...tokenize(sym.name),
    ...tokenize(sym.name),
  ];
  // Tokenize snippet identifiers and comments
  const snippetTokens = tokenize(sym.snippet ?? "");
  return [...nameTokens, ...snippetTokens, ...pathTokens];
}

const MAX_DOCS = 50_000;

// How many top BM25 hits get semantically reranked. Embedding is the cost, so
// this is a pool, not the whole result set — BM25 handles coarse recall.
const SEMANTIC_POOL = 60;

/**
 * Subsequence match: are all chars of `needle` present in order in `haystack`?
 * Returns a cost (first-hit index + total gap size; lower = tighter match) or
 * null when there is no match. Mirrors the QuickBar palette matcher.
 */
function subsequenceCost(haystack, needle) {
  let hi = 0;
  let gaps = 0;
  let firstIdx = -1;
  for (let ni = 0; ni < needle.length; ni++) {
    const idx = haystack.indexOf(needle[ni], hi);
    if (idx < 0) return null;
    if (firstIdx < 0) firstIdx = idx;
    else gaps += idx - hi;
    hi = idx + 1;
  }
  return firstIdx + gaps;
}

/**
 * Last-resort ranking when BM25 finds no token overlap at all. Subsequence-
 * matches the query against each symbol name and its file basename, so a fused
 * query ("quickcommand") still reaches `quickOpenCommands.ts`.
 */
function fuzzyFallback(docs, query) {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return [];
  const scored = [];
  for (const d of docs) {
    const nameCost = subsequenceCost(d.task.name.toLowerCase(), q);
    const base = path
      .basename(d.task.file)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const baseCost = subsequenceCost(base, q);
    // Name match is worth more than a mere filename match.
    const costs = [];
    if (nameCost != null) costs.push(nameCost);
    if (baseCost != null) costs.push(baseCost + 50);
    if (!costs.length) continue;
    scored.push({ task: d.task, score: 1 / (1 + Math.min(...costs)) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Blend BM25 with embedding similarity over the top BM25 pool. Returns the
 * reranked list; falls back to the original BM25 order if semantic search is
 * unavailable.
 */
async function rerankSemantic(ranked, query) {
  const pool = ranked.slice(0, SEMANTIC_POOL);
  const semDocs = pool.map((r, i) => ({
    id: String(i),
    text: `${r.task.name}\n${r.task.snippet ?? ""}`.slice(0, 512),
  }));
  const scores = await semanticScores({ query, docs: semDocs });
  if (!scores) return ranked;
  const maxBm = Math.max(...pool.map((r) => r.score), 1e-9);
  const blended = pool.map((r, i) => {
    const cos = scores.get(String(i)) ?? 0;
    // BM25 normalized to [0,1]; cosine remapped from [-1,1] to [0,1].
    const score = 0.5 * (r.score / maxBm) + 0.5 * ((cos + 1) / 2);
    return { task: r.task, score };
  });
  blended.sort((a, b) => b.score - a.score);
  return [...blended, ...ranked.slice(SEMANTIC_POOL)];
}

/**
 * @param {{roots: string[], query: string, limit?: number, langs?: string[]}} opts
 * @returns {Promise<Array<{name,kind,file,startLine,endLine,score,snippet}>>}
 */

export async function searchCode({ roots, query, limit = 20, langs } = {}) {
  if (!roots?.length || !query) return [];
  const docs = [];
  let truncated = false;

  async function processFile(filePath) {
    if (docs.length >= MAX_DOCS) return;
    if (langs?.length) {
      const lang = detectLanguage(filePath);
      if (!langs.includes(lang)) return;
    }
    const symbols = await extractSymbols(filePath);
    for (const sym of symbols) {
      if (docs.length >= MAX_DOCS) {
        truncated = true;
        break;
      }
      docs.push({ tokens: buildTokens(sym, filePath, roots), task: sym });
    }
  }

  for (const root of roots) {
    const queue = [];
    for await (const filePath of walkFiles(root)) {
      const p = processFile(filePath);
      queue.push(p);
      if (queue.length >= CONCURRENCY) {
        await Promise.all(queue.splice(0, CONCURRENCY)).catch((err) => {
          process.stderr.write(
            `[code-search] batch processing error: ${err?.message ?? err}\n`,
          );
        });
      }
    }
    if (queue.length)
      await Promise.all(queue).catch((err) => {
        process.stderr.write(
          `[code-search] batch processing error: ${err?.message ?? err}\n`,
        );
      });
  }
  if (truncated) {
    process.stderr.write(
      `[code-search] result set capped at ${MAX_DOCS} symbols — repo too large for full index\n`,
    );
  }
  const bm25 = bm25Rank(docs, query);
  // BM25 found token overlap -> rerank the top pool semantically.
  // BM25 found nothing (vocabulary mismatch) -> fuzzy subsequence fallback.
  const ranked = (
    bm25.length ? await rerankSemantic(bm25, query) : fuzzyFallback(docs, query)
  ).slice(0, limit);
  return ranked.map(({ task: sym, score }) => ({
    name: sym.name,
    kind: sym.kind,
    file: sym.file,
    startLine: sym.startLine,
    endLine: sym.endLine,
    score,
    snippet: sym.snippet,
  }));
}

// CLI entry: the Electron app's `code:search` IPC handler execs this file with
// --query/--root/--limit/--langs and expects a JSON array on stdout.
function parseCliArgs(argv) {
  const opts = { roots: [], query: "" };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    if (argv[i] === "--query") opts.query = next();
    else if (argv[i] === "--root") opts.roots.push(next());
    else if (argv[i] === "--limit") opts.limit = Number(next());
    else if (argv[i] === "--langs")
      opts.langs = next().split(",").filter(Boolean);
  }
  return opts;
}

// realpathSync resolves pnpm node_modules symlinks so a spawn via the
// symlinked path still matches node's canonicalised import.meta.url.
const __entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
// Only run as CLI when this file is the actual entrypoint. When bundled into
// another script (e.g. ast-server), import.meta.url resolves to the bundle's
// URL and would falsely match — basename check prevents stray stdout writes
// that corrupt the MCP stdio protocol.
if (
  __entry &&
  path.basename(__entry) === "code-search.mjs" &&
  pathToFileURL(__entry).href === import.meta.url
) {
  searchCode(parseCliArgs(process.argv.slice(2)))
    .then((results) => process.stdout.write(JSON.stringify(results)))
    .catch((err) => {
      process.stderr.write(`[code-search] ${err?.stack ?? err}\n`);
      process.exit(1);
    });
}
