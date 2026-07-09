import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUNDLED_WORKFLOWS } from '@code-workbench/mcp-core/workflows';
import { writeWorkflowScript } from '../src/workflowsBundle';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-workflows-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function fakeCtx(globalStorageFsPath: string) {
  return { globalStorageUri: { fsPath: globalStorageFsPath } } as unknown as import('vscode').ExtensionContext;
}

describe('writeWorkflowScript', () => {
  it('writes the bundled script to workflows/<name>.workflow.js and returns the absolute path', async () => {
    const workflow = BUNDLED_WORKFLOWS[0];
    const scriptPath = await writeWorkflowScript(fakeCtx(tmp), workflow.name);
    expect(path.isAbsolute(scriptPath)).toBe(true);
    expect(scriptPath).toBe(path.join(tmp, 'workflows', `${workflow.name}.workflow.js`));
    expect(await fs.readFile(scriptPath, 'utf8')).toBe(workflow.script);
  });

  it('overwrites a hand-edited file on a second call', async () => {
    const workflow = BUNDLED_WORKFLOWS[0];
    const scriptPath = await writeWorkflowScript(fakeCtx(tmp), workflow.name);
    await fs.writeFile(scriptPath, 'hand-edited');
    await writeWorkflowScript(fakeCtx(tmp), workflow.name);
    expect(await fs.readFile(scriptPath, 'utf8')).toBe(workflow.script);
  });

  it('rejects an unknown workflow name', async () => {
    await expect(writeWorkflowScript(fakeCtx(tmp), 'not-a-real-workflow')).rejects.toThrow(
      /Unknown bundled workflow/,
    );
  });
});
