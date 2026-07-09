// Writes bundled Workflow tool scripts to disk so a session can invoke them
// via Workflow({scriptPath}). Definitions come from the shared
// @code-workbench/mcp-core package; esbuild inlines them into the extension
// bundle at build time. Rewritten unconditionally on every call, so the
// script on disk is always current — no drift-detection needed.

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BUNDLED_WORKFLOWS } from '@code-workbench/mcp-core/workflows';

/**
 * Write the named bundled workflow script to
 * `<globalStorage>/workflows/<name>.workflow.js`, overwriting any existing
 * file, and return its absolute path. Throws if `name` is not bundled.
 */
export async function writeWorkflowScript(
  ctx: vscode.ExtensionContext,
  name: string,
): Promise<string> {
  const workflow = BUNDLED_WORKFLOWS.find(w => w.name === name);
  if (!workflow) {
    throw new Error(`Unknown bundled workflow: ${name}`);
  }
  const dir = path.join(ctx.globalStorageUri.fsPath, 'workflows');
  await fs.mkdir(dir, { recursive: true });
  const scriptPath = path.join(dir, `${name}.workflow.js`);
  await fs.writeFile(scriptPath, workflow.script);
  return scriptPath;
}
