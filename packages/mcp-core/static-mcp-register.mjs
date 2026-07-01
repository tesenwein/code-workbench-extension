// Shared logic for registering the "static" workbench MCP servers — cw-ast and
// cw-dead-code — into a `.claude.json`. Used by both the Electron app
// (packages/app) and the VS Code extension (packages/extension) so they emit
// the same entries with the same WSL handling.
//
// Static = no per-session env injection. Dynamic servers (cw-notify, cw-tasks,
// cw-arch) are wired separately by each launcher.

import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { STATIC_MCP_SERVERS, MCP_SERVER_FILES } from "./server-manifest.mjs";

const execAsync = promisify(exec);

const CODE_KEY = "cw-code";

// `C:\foo\bar` → `/mnt/c/foo/bar`. Returns the input unchanged if it doesn't
// look like a Windows drive path (e.g. already POSIX).
export function windowsPathToWslPath(p) {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!drive) return p.replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
}

export function pathForClaude(p, opts) {
  return opts && opts.wsl && process.platform === "win32"
    ? windowsPathToWslPath(p)
    : p;
}

// Resolves the Windows-accessible UNC path to the default WSL distro's home
// (`\\wsl.localhost\<distro>\home\<user>`) so we can write `.claude.json`
// there via regular fs APIs. Returns null on non-Windows or if WSL is absent.
let _wslHomeWinPath;
export async function getWslHomeWinPath() {
  if (_wslHomeWinPath !== undefined) return _wslHomeWinPath;
  if (process.platform !== "win32") {
    _wslHomeWinPath = null;
    return null;
  }
  try {
    const { stdout } = await execAsync(
      'wsl -e bash -lc "wslpath -w \\"$HOME\\""',
      { timeout: 5000 },
    );
    const trimmed = stdout.trim();
    _wslHomeWinPath = trimmed || null;
  } catch {
    _wslHomeWinPath = null;
  }
  return _wslHomeWinPath ?? null;
}

/**
 * Merge the static workbench MCP servers (cw-ast, cw-dead-code) into the
 * `.claude.json` at `configPath`. Preserves unrelated keys.
 *
 * @param {string} configPath
 * @param {{
 *   resolveScript: (filename: string) => string | null | undefined,
 *   wsl?: boolean,
 *   repoPath?: string | null,
 *   astGrammarsAvailable?: () => boolean,
 * }} opts
 * @returns {Promise<{configPath: string, registered: string[], skipped: {name:string, reason:string}[]}>}
 */
export async function registerStaticServersInto(configPath, opts) {
  const { resolveScript, wsl = false, repoPath = null } = opts;
  const registered = [];
  const skipped = [];

  let config = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        config = parsed;
    } catch {
      // malformed — start clean
    }
  } catch {
    // ENOENT — start clean
  }

  const mcpServers =
    config.mcpServers && typeof config.mcpServers === "object"
      ? config.mcpServers
      : {};

  for (const { key, file } of STATIC_MCP_SERVERS) {
    const script = resolveScript(file);
    if (!script) {
      skipped.push({ name: key, reason: `${file} not found in this build` });
      continue;
    }
    const entry = {
      type: "stdio",
      command: "node",
      args: [pathForClaude(script, { wsl })],
    };
    // The unified server scopes its analysis tools to this repo when told to;
    // without it the server falls back to its spawn cwd.
    if (repoPath) {
      entry.env = {
        CODE_WORKBENCH_REPO_PATH: pathForClaude(repoPath, { wsl }),
      };
    }
    mcpServers[key] = entry;
    registered.push(key);
  }

  config.mcpServers = mcpServers;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );
  return { configPath, registered, skipped };
}

/**
 * Write the primary `.claude.json`, and (when `mirrorToWsl` is true on Windows
 * and WSL is available) also write a translated copy to the WSL distro's home
 * so `wsl claude` sessions get the same MCP servers.
 *
 * @param {{
 *   primaryConfigPath: string,
 *   resolveScript: (filename: string) => string | null | undefined,
 *   wsl?: boolean,
 *   repoPath?: string | null,
 *   astGrammarsAvailable?: () => boolean,
 *   mirrorToWsl?: boolean,
 * }} args
 */
export async function registerStaticServersDual(args) {
  const {
    primaryConfigPath,
    resolveScript,
    wsl = false,
    repoPath = null,
    astGrammarsAvailable,
    mirrorToWsl = false,
  } = args;

  const primary = await registerStaticServersInto(primaryConfigPath, {
    resolveScript,
    wsl,
    repoPath,
    astGrammarsAvailable,
  });

  if (mirrorToWsl && !wsl && process.platform === "win32") {
    const wslHome = await getWslHomeWinPath();
    if (wslHome) {
      try {
        await registerStaticServersInto(path.join(wslHome, ".claude.json"), {
          resolveScript,
          wsl: true,
          repoPath,
          astGrammarsAvailable,
        });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn(`[mcp-register] WSL mirror failed: ${msg}`);
      }
    }
  }
  return primary;
}

export { CODE_KEY, MCP_SERVER_FILES };
