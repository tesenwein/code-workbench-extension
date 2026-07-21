import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WORKBENCH_SYSTEM_PROMPT } from './workbenchPrompt';
import { resolveNodeRuntime } from './nodeRuntime';

const fsp = fs.promises;

// Single unified MCP endpoint — the aggregator server exposes every tool group.
const CODE_MCP_KEY = 'cw-code';

export interface McpConfigArgs {
  sessionId: string;
  worktreePath: string;
  repoPath?: string;
  repoKey?: string;
  notifyPort?: number;
  extraPrompts?: string[];
}

export interface McpWriteResult {
  configPath: string;
  promptPath?: string;
}

export class McpConfigBuilder {
  constructor(private ctx: vscode.ExtensionContext) {}

  private dir(): string {
    return path.join(this.ctx.globalStorageUri.fsPath, 'mcp');
  }

  private configPath(sessionId: string): string {
    return path.join(this.dir(), `session-${sessionId}.json`);
  }

  private promptPath(sessionId: string): string {
    return path.join(this.dir(), `session-${sessionId}.txt`);
  }

  private portPath(sessionId: string): string {
    return path.join(this.dir(), `session-${sessionId}.port`);
  }

  /**
   * Re-write the notify-port files of already-launched sessions. The NotifyServer
   * listens on a random port, so after an extension-host restart every running
   * Claude session still holds the old port in its env — the port file is the
   * live channel they re-read on each send. Only touches files that exist
   * (i.e. sessions actually launched with notifications enabled).
   */
  async refreshNotifyPorts(sessionIds: string[], port: number): Promise<void> {
    if (!port || port <= 0) return;
    for (const id of sessionIds) {
      const p = this.portPath(id);
      try {
        await fsp.access(p);
        await fsp.writeFile(p, String(port) + '\n', 'utf8');
      } catch {
        /* never launched — nothing to refresh */
      }
    }
  }

  private async serverScript(name: string): Promise<string | undefined> {
    // MCP servers are spawned as standalone `node <file>` processes. esbuild
    // bundles each one (from the @code-workbench/mcp-core package) into a
    // self-contained file under dist/mcp-server/ — see esbuild.mjs.
    const candidate = path.join(this.ctx.extensionPath, 'dist', 'mcp-server', name);
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      console.warn(`[mcp] expected server bundle not found, skipping: ${name}`);
      return undefined;
    }
  }

  /**
   * Write a per-session MCP config + system prompt file.
   * Returns `{ configPath, promptPath? }` or undefined if no servers were enabled.
   */
  async write(args: McpConfigArgs): Promise<McpWriteResult | undefined> {
    const cfg = vscode.workspace.getConfiguration('codeWorkbench');
    const enableTasks = cfg.get<boolean>('mcp.tasks.enabled', true);
    const enableNotify = cfg.get<boolean>('mcp.notifications.enabled', true);
    const enableArch = cfg.get<boolean>('mcp.arch.enabled', true);
    const enableDeadCode = cfg.get<boolean>('mcp.deadCode.enabled', true);
    const enableTypeSafety = cfg.get<boolean>('mcp.typeSafety.enabled', true);

    const mcpServers: Record<string, unknown> = {};

    // Single unified endpoint. The aggregator server exposes every tool group;
    // per-feature toggles are honored by suppressing groups via env rather than
    // by spawning separate processes. cw-ast is always on (no toggle).
    const notifyEnabled = enableNotify && !!args.notifyPort && args.notifyPort > 0;
    const codeScript = await this.serverScript('code-server.mjs');
    if (codeScript) {
      // Absolute interpreter: the chat terminal runs the CLI as its shell, so a
      // bare `node` misses nvm/fnm/volta shims and the endpoint fails to spawn.
      const node = await resolveNodeRuntime();
      const env: Record<string, string> = { ...node.env };
      if (args.repoPath) env.CODE_WORKBENCH_REPO_PATH = args.repoPath;
      if (args.worktreePath) {
        // Analysis tools scan the working copy; tasks bucketing uses the key.
        env.CODE_WORKBENCH_REPO_PATH = args.worktreePath;
        env.CODE_WORKBENCH_WORKTREE_PATH = args.worktreePath;
      }
      if (args.repoKey) env.CODE_WORKBENCH_REPO_KEY = args.repoKey;
      if (notifyEnabled) {
        env.CODE_WORKBENCH_NOTIFY_PORT = String(args.notifyPort);
        env.CODE_WORKBENCH_SESSION_ID = args.sessionId;
        // Port file: re-read by the notify server on every send so a workbench
        // restart (new random port) doesn't strand long-lived sessions.
        env.CODE_WORKBENCH_NOTIFY_PORT_FILE = this.portPath(args.sessionId);
      }
      const disabled: string[] = [];
      if (!notifyEnabled) disabled.push('notify');
      if (!enableTasks) disabled.push('tasks');
      if (!enableArch) disabled.push('arch');
      if (!enableDeadCode) disabled.push('dead-code');
      if (!enableTypeSafety) disabled.push('type-safety');
      if (disabled.length) env.CODE_WORKBENCH_DISABLED_GROUPS = disabled.join(',');

      mcpServers[CODE_MCP_KEY] = {
        type: 'stdio',
        command: node.command,
        args: [codeScript],
        env,
        alwaysAllow: [
          'get_file_outline',
          'get_symbol_source',
          'ast_query',
          'search_code',
          'find_duplicates',
          'notify_done',
          'notify_needs_input',
          'notify_info',
          'notify_chat_title',
          'task_list',
          'task_create',
          'task_update',
          'task_delete',
          'task_find_similar',
          'arch_list',
          'arch_get',
          'arch_search',
          'arch_upsert',
          'arch_delete',
          'arch_audit',
          'acknowledge_duplicate',
          'exclude_directory',
          'detect_dead_code',
          'acknowledge_dead_code',
          'exclude_dead_code_dir',
          'detect_type_escapes',
          'acknowledge_type_escape',
          'exclude_type_escape_dir',
        ],
      };
    }

    if (Object.keys(mcpServers).length === 0) return undefined;

    await fsp.mkdir(this.dir(), { recursive: true });
    const configPath = this.configPath(args.sessionId);
    await fsp.writeFile(configPath, JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    if (notifyEnabled && args.notifyPort) {
      await fsp.writeFile(this.portPath(args.sessionId), String(args.notifyPort) + '\n', 'utf8');
    }

    let promptPath: string | undefined;
    const extras = (args.extraPrompts ?? []).map((p) => p.trim()).filter(Boolean);
    if (mcpServers[CODE_MCP_KEY] || extras.length > 0) {
      promptPath = this.promptPath(args.sessionId);
      const body = [WORKBENCH_SYSTEM_PROMPT, ...extras].join('\n\n');
      await fsp.writeFile(promptPath, body, 'utf8');
    }

    return { configPath, promptPath };
  }

  async delete(sessionId: string): Promise<void> {
    for (const p of [
      this.configPath(sessionId),
      this.promptPath(sessionId),
      this.portPath(sessionId),
    ]) {
      try {
        await fsp.unlink(p);
      } catch {
        /* ignore */
      }
    }
  }
}
