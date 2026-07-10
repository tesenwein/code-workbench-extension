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
