// Shared type definitions for dead-code and duplicate-detection scan results.
// Both the Electron app (app/src/shared/types.ts) and the VS Code extension
// should re-export or import from here to avoid redeclaring these shapes.

export type DeadCodeKind = "unused-export" | "unused-local" | "commented-code";

export interface DeadCodeItem {
  kind: DeadCodeKind;
  file: string;
  name: string;
  startLine: number;
  detail: string;
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

export interface DuplicateMember {
  file: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  lines: number;
}

export interface DuplicateGroup {
  cloneType: "exact" | "renamed" | "structural";
  similarity: number;
  count: number;
  members: DuplicateMember[];
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

export type TypeEscapeKind = "as-cast" | "any-type" | "non-null" | "ts-ignore";

export interface TypeEscapeItem {
  kind: TypeEscapeKind;
  file: string;
  name: string;
  startLine: number;
  detail: string;
  /** Normalized snippet of the offending node — keeps the fingerprint line-independent. */
  content: string;
  /** SHA-1 fingerprint used for ack persistence. */
  fingerprint: string;
}

/** A single ranked symbol match from code-search.mjs. */
export interface CodeSearchResult {
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}
