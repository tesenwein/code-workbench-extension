/* Prefetched context for phase prompts: the arch cards and code symbols most
 * relevant to a task, searched BEFORE the session spawns so it starts with
 * them in view instead of (often) skipping the wiki. Best-effort throughout —
 * a slow or failing search yields less context, never a failed phase start. */

import type * as vscode from 'vscode';
import * as path from 'path';
import { readAllArchCards, type ArchCard } from './archHost';
import { searchArchCards, searchCode, type CodeSearchResult } from './scanHost';

/** Hard cap on the rendered section; the prompt must not balloon. */
export const CONTEXT_MAX_CHARS = 2048;
const SEARCH_TIMEOUT_MS = 5000;
const MAX_CARDS = 3;
const MAX_SYMBOLS = 5;

export interface ContextTask {
  title: string;
  description: string;
}

const oneLine = (s: string, max: number): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Render cards + symbols, dropping trailing lines to fit `cap`. Empty input
 *  renders ''. Paths are made relative to `root` for compactness. */
export function formatTaskContext(
  cards: Pick<ArchCard, 'slug' | 'name' | 'description' | 'files'>[],
  symbols: Pick<CodeSearchResult, 'file' | 'startLine' | 'name' | 'kind'>[],
  root: string,
  cap = CONTEXT_MAX_CHARS,
): string {
  const lines: string[] = [];
  if (cards.length) {
    lines.push('Architecture cards (arch_get <slug> for the full card):');
    for (const c of cards.slice(0, MAX_CARDS)) {
      const files = c.files.slice(0, 3).join(', ');
      lines.push(
        `- ${c.slug} — ${c.name}: ${oneLine(c.description, 160)}${files ? ` [${files}]` : ''}`,
      );
    }
  }
  if (symbols.length) {
    lines.push('Code symbols:');
    for (const s of symbols.slice(0, MAX_SYMBOLS)) {
      const rel = path.isAbsolute(s.file) ? path.relative(root, s.file) : s.file;
      lines.push(`- ${rel}:${s.startLine} ${s.kind} ${s.name}`);
    }
  }
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > cap) break;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), SEARCH_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Search arch cards + code for `task` inside `root` and render the result. */
export async function buildTaskContext(
  ctx: vscode.ExtensionContext,
  root: string,
  task: ContextTask,
): Promise<string> {
  const query = `${task.title}\n${task.description.slice(0, 300)}`.trim();
  const [hits, symbols, allCards] = await Promise.all([
    withTimeout(searchArchCards(ctx, root, query, MAX_CARDS), []),
    withTimeout(searchCode(ctx, root, query, MAX_SYMBOLS), []),
    readAllArchCards(root).catch(() => [] as ArchCard[]),
  ]);
  const bySlug = new Map(allCards.map((c) => [c.slug, c]));
  const cards = hits.map((h) => bySlug.get(h.slug)).filter((c): c is ArchCard => !!c);
  return formatTaskContext(cards, symbols, root);
}
