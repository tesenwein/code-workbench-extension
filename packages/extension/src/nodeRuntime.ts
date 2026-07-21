// Resolves an absolute Node.js interpreter for spawning the MCP server.
//
// The chat terminal is created with `shellPath: <cli>` — no login shell runs, so
// version-manager shims (nvm, fnm, volta) that live in ~/.zshrc never load and a
// bare `node` in the MCP config fails to spawn. When that happens the CLI drops
// the whole cw-code endpoint and every workbench tool silently disappears, so we
// always write an absolute path we have verified exists.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const fsp = fs.promises;

export interface NodeRuntime {
  /** Absolute interpreter path (or `node` only if nothing else resolved). */
  command: string;
  /** Extra env the interpreter needs — set when falling back to Electron. */
  env: Record<string, string>;
  /** Where it came from, for logging. */
  source: string;
}

let cached: NodeRuntime | undefined;

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fs.constants.X_OK);
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}

function exeName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

/** `node` as found on the extension host's own PATH. */
async function fromPath(): Promise<string | undefined> {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    const candidate = path.join(dir, exeName());
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** nvm keeps no shim on disk — resolve its default alias, else the newest install. */
async function fromNvm(): Promise<string | undefined> {
  const home = process.env.HOME;
  if (!home) return undefined;
  const root = path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
  const bin = (v: string) => path.join(root, v, 'bin', exeName());

  try {
    const alias = (await fsp.readFile(path.join(root, '..', '..', 'alias', 'default'), 'utf8')).trim();
    if (alias) {
      const versioned = alias.startsWith('v') ? alias : `v${alias}`;
      if (await isExecutable(bin(versioned))) return bin(versioned);
    }
  } catch {
    /* no default alias — fall through to newest */
  }

  try {
    const versions = (await fsp.readdir(root))
      .filter((v) => v.startsWith('v'))
      .sort((a, b) => compareVersions(b, a));
    for (const v of versions) {
      if (await isExecutable(bin(v))) return bin(v);
    }
  } catch {
    /* no nvm */
  }
  return undefined;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Fixed install locations, in preference order. */
async function fromWellKnown(): Promise<string | undefined> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
          path.join(home, 'AppData', 'Roaming', 'npm', 'node.exe'),
          path.join(home, '.volta', 'bin', 'node.exe'),
        ]
      : [
          '/opt/homebrew/bin/node',
          '/usr/local/bin/node',
          '/usr/bin/node',
          path.join(home, '.volta', 'bin', 'node'),
          path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'),
          path.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin', 'node'),
        ];
  for (const c of candidates) {
    if (c && (await isExecutable(c))) return c;
  }
  return undefined;
}

/**
 * Resolve the interpreter once per extension-host session.
 * Order: user setting → PATH → well-known installs → nvm → Electron-as-node.
 */
export async function resolveNodeRuntime(): Promise<NodeRuntime> {
  if (cached) return cached;

  const configured = vscode.workspace
    .getConfiguration('codeWorkbench')
    .get<string>('mcp.nodePath', '')
    .trim();
  if (configured) {
    if (await isExecutable(configured)) {
      cached = { command: configured, env: {}, source: 'codeWorkbench.mcp.nodePath' };
      return cached;
    }
    void vscode.window.showErrorMessage(
      `Code Workbench: codeWorkbench.mcp.nodePath points at "${configured}", which is not an executable file. Falling back to auto-detection.`,
    );
  }

  for (const [source, find] of [
    ['PATH', fromPath],
    ['well-known install', fromWellKnown],
    ['nvm', fromNvm],
  ] as const) {
    const found = await find();
    if (found) {
      cached = { command: found, env: {}, source };
      console.log(`[mcp] node interpreter: ${found} (${source})`);
      return cached;
    }
  }

  // Last resort: VS Code's own Electron binary runs .mjs files fine in node mode.
  cached = {
    command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
    source: 'electron (ELECTRON_RUN_AS_NODE)',
  };
  console.warn(
    `[mcp] no node executable found on PATH or in the usual install locations; ` +
      `using ${process.execPath} with ELECTRON_RUN_AS_NODE=1. ` +
      `Set codeWorkbench.mcp.nodePath to silence this.`,
  );
  return cached;
}

/** Drop the memoized result — call when the nodePath setting changes. */
export function resetNodeRuntimeCache(): void {
  cached = undefined;
}
