// Shared BM25 lexical ranking utilities used by tasks-server.mjs and code-search.mjs.

export const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "this",
  "that",
  "these",
  "those",
  "as",
  "at",
  "by",
  "from",
  "but",
  "not",
  "no",
  "if",
  "then",
  "than",
  "so",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "have",
  "has",
  "had",
  "i",
  "we",
  "you",
  "they",
  "he",
  "she",
  "my",
  "our",
  "your",
  "their",
  "its",
]);

/**
 * Split one raw word on camelCase / PascalCase and letter/digit boundaries.
 * `QuickBar` -> ['Quick','Bar']; `HTTPServer` -> ['HTTP','Server']; `v2` -> ['v','2'].
 */
function splitIdentifier(word) {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .split(/\s+/);
}

/**
 * Lowercase, split on non-alphanumerics, then split each word on identifier
 * boundaries. A word that splits into sub-words ALSO contributes its joined
 * lowercase form, so a fused query ("quickbar") still matches a split symbol
 * ("QuickBar") and a spaced query ("quick bar") matches it too.
 */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue;
    const parts = splitIdentifier(raw).map((p) => p.toLowerCase());
    for (const p of parts) {
      if (p.length >= 2 && !STOPWORDS.has(p)) out.push(p);
    }
    if (parts.length > 1) {
      const joined = raw.toLowerCase();
      if (joined.length >= 2 && !STOPWORDS.has(joined)) out.push(joined);
    }
  }
  return out;
}

export function bm25Rank(docs, query, k1 = 1.5, b = 0.75) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || docs.length === 0) return [];
  const N = docs.length;
  const df = new Map();
  let totalLen = 0;
  for (const d of docs) {
    totalLen += d.tokens.length;
    const seen = new Set();
    for (const t of d.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const avgdl = totalLen / N || 1;
  const idf = new Map();
  for (const [t, n] of df) {
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  const scored = docs.map((d) => {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt);
      if (!f) continue;
      const w = idf.get(qt) ?? 0;
      const denom = f + k1 * (1 - b + (b * d.tokens.length) / avgdl);
      score += w * ((f * (k1 + 1)) / denom);
    }
    // Preserve every field on the input doc (task, card, …) so each consumer
    // can read back whatever payload it attached. Returning only `task` broke
    // arch_search, which attaches `card` instead.
    return { ...d, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}
