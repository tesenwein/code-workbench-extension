// Type declarations for text-rank.mjs — BM25 lexical ranking shared by the
// MCP servers and the Electron renderer.

export const STOPWORDS: Set<string>;

/** Lowercase, split on non-alphanumerics, drop short tokens and stopwords. */
export function tokenize(text: string | null | undefined): string[];

/**
 * Rank `docs` against `query` with BM25. Each doc must carry a `tokens` array;
 * every other field is preserved on the result, with `score` added. Returns
 * only positive-scoring docs, highest first.
 */
export function bm25Rank<D extends { tokens: string[] }>(
  docs: D[],
  query: string,
  k1?: number,
  b?: number,
): Array<D & { score: number }>;
