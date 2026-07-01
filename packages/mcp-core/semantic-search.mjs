// Optional semantic reranking for code search.
//
// Loads a local sentence-embedding model (transformers.js, all-MiniLM-L6-v2)
// lazily on first use and embeds short code-symbol descriptions so search can
// rank by meaning, not just lexical token overlap. Everything here degrades to
// a no-op if the model or library is unavailable (offline first run, install
// problem) — callers fall back to pure BM25.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const CACHE_ROOT = path.join(os.homedir(), ".code-workbench", "embed-cache");
const VEC_CACHE_FILE = path.join(CACHE_ROOT, "vectors.json");

// Disabled explicitly via env, e.g. for tests or low-resource machines.
export const SEMANTIC_ENABLED = process.env.CW_SEMANTIC_SEARCH !== "0";

let embedderPromise = null; // Promise<pipeline> once started
let embedderFailed = false;

async function getEmbedder() {
  if (embedderFailed || !SEMANTIC_ENABLED) return null;
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Keep model + ONNX cache inside the workbench dir, not node_modules.
      env.cacheDir = path.join(CACHE_ROOT, "models");
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL, { quantized: true });
    })();
  }
  try {
    return await embedderPromise;
  } catch (err) {
    embedderFailed = true;
    process.stderr.write(
      `[semantic-search] disabled: ${err?.message ?? err}\n`,
    );
    return null;
  }
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// ── On-disk embedding cache ──────────────────────────────────────────────────
// Symbol text rarely changes, so caching keyed by content hash makes every
// search after the first one cheap. The cache is best-effort: any IO error
// just means a recompute.

let vecCache = null;

function loadCache() {
  if (vecCache) return vecCache;
  try {
    vecCache = JSON.parse(fs.readFileSync(VEC_CACHE_FILE, "utf8"));
  } catch {
    vecCache = {};
  }
  return vecCache;
}

function saveCache(cache) {
  try {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.writeFileSync(VEC_CACHE_FILE, JSON.stringify(cache));
  } catch (err) {
    process.stderr.write(
      `[semantic-search] cache write failed: ${err?.message ?? err}\n`,
    );
  }
}

// Mean-pooled, L2-normalized embeddings — so cosine similarity is a plain dot.
async function embed(embedder, texts) {
  const out = await embedder(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Rerank `docs` against `query` by embedding similarity.
 *
 * @param {{query: string, docs: Array<{id: string, text: string}>}} opts
 * @returns {Promise<Map<string, number>|null>} id -> cosine similarity in
 *   [-1,1], or null when semantic search is unavailable (caller falls back).
 */
export async function semanticScores({ query, docs }) {
  if (!query || !docs?.length) return null;
  const embedder = await getEmbedder();
  if (!embedder) return null;

  const cache = loadCache();
  const missing = [];
  for (const d of docs) {
    if (!cache[sha1(d.text)]) missing.push(d);
  }
  try {
    if (missing.length) {
      const vecs = await embed(
        embedder,
        missing.map((d) => d.text),
      );
      missing.forEach((d, i) => {
        cache[sha1(d.text)] = vecs[i];
      });
      saveCache(cache);
    }
    const [qVec] = await embed(embedder, [query]);
    const scores = new Map();
    for (const d of docs) scores.set(d.id, dot(qVec, cache[sha1(d.text)]));
    return scores;
  } catch (err) {
    process.stderr.write(
      `[semantic-search] embed failed: ${err?.message ?? err}\n`,
    );
    return null;
  }
}
