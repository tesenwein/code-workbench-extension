// Registers workbench MCP servers into a `.claude.json` so Claude Code sessions
// started outside the workbench (e.g. the plain CLI) can use them. The actual
// registration logic and WSL dual-write live in
// @code-workbench/mcp-core/static-mcp-register so the extension and the
// Electron app emit identical entries.

import * as path from 'path';
import { existsSync } from 'fs';
import {
  registerStaticServersDual,
  type RegisterResult,
} from '@code-workbench/mcp-core/static-mcp-register';
import { resolveNodeRuntime } from './nodeRuntime';

export type McpRegisterResult = RegisterResult;

/**
 * Merge the workbench MCP servers into the `.claude.json` at `<targetDir>`.
 * Preserves any unrelated keys.
 *
 * On Windows, also writes a translated copy to the WSL distro's home
 * (`\\wsl.localhost\<distro>\home\<user>\.claude.json`) when the target IS the
 * Windows user home, so `wsl claude` sessions outside the workbench pick up
 * the same servers. Project-scope targets get a single file with paths native
 * to whichever OS wrote it.
 */
export async function registerWorkbenchMcpServers(
  extensionPath: string,
  targetDir: string,
): Promise<McpRegisterResult> {
  const configPath = path.join(targetDir, '.claude.json');
  const resolveScript = (filename: string): string | null => {
    const p = path.join(extensionPath, 'dist', 'mcp-server', filename);
    return existsSync(p) ? p : null;
  };
  const sameAsWinHome =
    process.platform === 'win32' &&
    !!process.env.USERPROFILE &&
    path.resolve(targetDir).toLowerCase() === path.resolve(process.env.USERPROFILE).toLowerCase();
  const node = await resolveNodeRuntime();
  return registerStaticServersDual({
    primaryConfigPath: configPath,
    resolveScript,
    mirrorToWsl: sameAsWinHome,
    nodeCommand: node.command,
    nodeEnv: node.env,
  });
}
