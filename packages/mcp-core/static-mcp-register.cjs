"use strict";

const { promises: fs } = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const {
  STATIC_MCP_SERVERS,
  MCP_SERVER_FILES,
} = require("./server-manifest.cjs");

const execAsync = promisify(exec);

const CODE_KEY = "cw-code";

function windowsPathToWslPath(p) {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!drive) return p.replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
}

function pathForClaude(p, opts) {
  return opts && opts.wsl && process.platform === "win32"
    ? windowsPathToWslPath(p)
    : p;
}

let _wslHomeWinPath;
async function getWslHomeWinPath() {
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
  return _wslHomeWinPath == null ? null : _wslHomeWinPath;
}

async function registerStaticServersInto(configPath, opts) {
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

async function registerStaticServersDual(args) {
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

module.exports = {
  CODE_KEY,
  MCP_SERVER_FILES,
  windowsPathToWslPath,
  pathForClaude,
  getWslHomeWinPath,
  registerStaticServersInto,
  registerStaticServersDual,
};
