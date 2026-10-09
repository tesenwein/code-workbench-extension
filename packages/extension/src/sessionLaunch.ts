import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { WorktreeColor } from './sessionTypes';

export function cryptoRandom(): string {
  return randomUUID();
}

/** Claude stores conversation transcripts at ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl.
 *  The cwd encoding has quirks (dots and slashes both become '-'), so rather than reproduce it
 *  we scan project dirs for the UUID-named file. Resuming a missing id errors out, so we fall
 *  back to --session-id when no transcript is found. */
export function claudeConversationExists(_worktreePath: string, sessionId: string): boolean {
  return findClaudeTranscriptPath(sessionId) !== undefined;
}

/** Locate a Claude transcript file by scanning ~/.claude/projects/*, mirroring
 *  claudeConversationExists's dir-encoding-agnostic search. */
function findClaudeTranscriptPath(sessionId: string): string | undefined {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const target = `${sessionId}.jsonl`;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  for (const d of dirs) {
    const candidate = path.join(root, d, target);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // missing or not a dir — keep looking
    }
  }
  return undefined;
}

/** Best-effort extraction of the first human-typed message in a transcript,
 *  for use as a fallback session title when the agent never calls
 *  notify_chat_title. Returns undefined if no transcript or user turn exists
 *  yet, or the message text is unusable (e.g. empty/whitespace-only). */
export function readFirstUserMessage(sessionId: string): string | undefined {
  const file = findClaudeTranscriptPath(sessionId);
  if (!file) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const e = entry as {
      type?: string;
      isMeta?: boolean;
      message?: { role?: string; content?: unknown };
    };
    if (e.type !== 'user' || e.message?.role !== 'user' || e.isMeta) continue;
    const content = e.message.content;
    let text: string | undefined;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const block = content.find(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string',
      );
      text = block?.text;
    }
    const clean = text?.split('\n')[0]?.trim();
    // Slash-command turns land as `<command-name>…</command-name>` wrapper
    // entries — markup, not a title. Keep scanning for a real typed message.
    if (!clean || clean.startsWith('<')) continue;
    return clean;
  }
  return undefined;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreate: a.cacheCreate + b.cacheCreate,
  };
}

interface UsageState {
  byMessage: Map<string, TokenUsage>;
  anon: number;
}

/** Fold complete JSONL lines into `state`. A turn can be written several times
 *  while it streams, so the LAST entry per message id wins. */
function ingestUsageLines(state: UsageState, text: string): void {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e: {
      type?: string;
      message?: { id?: string; usage?: Record<string, unknown> };
    };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e.type === 'assistant' ? e.message?.usage : undefined;
    if (!u) continue;
    const n = (k: string): number => (typeof u[k] === 'number' ? (u[k] as number) : 0);
    state.byMessage.set(e.message?.id ?? `anon-${state.anon++}`, {
      input: n('input_tokens'),
      output: n('output_tokens'),
      cacheRead: n('cache_read_input_tokens'),
      cacheCreate: n('cache_creation_input_tokens'),
    });
  }
}

function totalUsage(state: UsageState): TokenUsage {
  let total = EMPTY_USAGE;
  for (const u of state.byMessage.values()) total = addUsage(total, u);
  return total;
}

/** Sum the `usage` blocks of assistant turns in a transcript's JSONL text. */
export function sumTranscriptUsage(raw: string): TokenUsage {
  const state: UsageState = { byMessage: new Map(), anon: 0 };
  ingestUsageLines(state, raw);
  return totalUsage(state);
}

/** Minimum gap between transcript reads per session: usage is polled from a
 *  view that refreshes on every tool call, and must not stat/read each time. */
const USAGE_REFRESH_MS = 5000;

interface UsageEntry extends UsageState {
  file: string;
  /** Bytes already consumed (always at a line boundary). */
  offset: number;
  checkedAt: number;
  usage: TokenUsage;
}

const usageCache = new Map<string, UsageEntry>();

/** Read [from, to) of a file as utf8. */
function readRange(file: string, from: number, to: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    const n = fs.readSync(fd, buf, 0, buf.length, from);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** Token usage of a Claude session, read from its transcript. The transcript
 *  path is cached, only newly appended complete lines are parsed, and the file
 *  is touched at most every USAGE_REFRESH_MS. Undefined when no transcript exists. */
export function readSessionUsage(sessionId: string): TokenUsage | undefined {
  let entry = usageCache.get(sessionId);
  const now = Date.now();
  if (entry && now - entry.checkedAt < USAGE_REFRESH_MS) return entry.usage;
  try {
    const file = entry?.file ?? findClaudeTranscriptPath(sessionId);
    if (!file) return undefined;
    const size = fs.statSync(file).size;
    if (!entry || size < entry.offset) {
      entry = {
        file,
        byMessage: new Map(),
        anon: 0,
        offset: 0,
        checkedAt: now,
        usage: EMPTY_USAGE,
      };
      usageCache.set(sessionId, entry);
    }
    if (size > entry.offset) {
      const text = readRange(file, entry.offset, size);
      // Leave a trailing partial line for the next read.
      const end = text.lastIndexOf('\n') + 1;
      if (end > 0) {
        ingestUsageLines(entry, text.slice(0, end));
        entry.offset += Buffer.byteLength(text.slice(0, end), 'utf8');
        entry.usage = totalUsage(entry);
      }
    }
    entry.checkedAt = now;
    return entry.usage;
  } catch {
    usageCache.delete(sessionId);
    return undefined;
  }
}

/** Headline token count: cache reads are re-counted every turn and would
 *  dwarf real usage, so they only appear in the detail tooltip. */
export function usageTotal(u: TokenUsage): number {
  return u.input + u.output + u.cacheCreate;
}

/** Compact count: 950, 12.3k, 4.5M. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function usageDetail(u: TokenUsage): string {
  return `input ${u.input.toLocaleString()} · output ${u.output.toLocaleString()} · cache write ${u.cacheCreate.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()} (not counted in total)`;
}

/** POSIX single-quote escape: wrap in '…', escaping embedded ' as '\''. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 24-bit RGB for the colored banner background. Matches the terminal ANSI
 *  palette of the Paper & Clay theme (github.com/tesenwein/paper-and-clay-theme)
 *  so the banner visually matches the terminal tab tint and tree icon for
 *  each worktree color. */
function ansiBgRgb(color: WorktreeColor): [number, number, number] | undefined {
  switch (color) {
    case 'red':
      return [0xe0, 0x5c, 0x5c];
    case 'green':
      return [0x9a, 0xa6, 0x6e];
    case 'yellow':
      return [0xc9, 0x88, 0x3a];
    case 'blue':
      return [0x7a, 0x9a, 0xb5];
    case 'magenta':
      return [0xc8, 0x94, 0x78];
    case 'cyan':
      return [0x8a, 0xa9, 0xa3];
    default:
      return undefined;
  }
}

/** Build a full-width 3-row colored banner identifying the worktree, or '' if no color set.
 *  Uses ESC[K (erase-to-EOL) with bg set so the bar fills the terminal width on its own,
 *  with a blank colored row above and below the name for padding. */
export function buildBanner(worktreePath: string, color: WorktreeColor): string {
  const rgb = ansiBgRgb(color);
  if (!rgb) return '';
  const name = path.basename(worktreePath) || 'workspace';
  const ESC = '\x1b';
  const bg = `48;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  const blank = `${ESC}[${bg}m${ESC}[K${ESC}[0m\n`;
  const label = `${ESC}[1;97;${bg}m  ${name}  ${ESC}[K${ESC}[0m\n`;
  return blank + label + blank + '\n\n';
}
