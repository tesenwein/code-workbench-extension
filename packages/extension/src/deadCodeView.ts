import * as vscode from 'vscode';
import { ScanViewProvider } from './scanViewProvider';
import { scanDeadCode } from './scanHost';
import type { DeadCodeItem } from './scanHost';

export class DeadCodeViewProvider extends ScanViewProvider<DeadCodeItem> {
  static readonly viewId = 'codeWorkbench.deadCode';

  constructor(
    ctx: vscode.ExtensionContext,
    getRepoRoot: () => string | undefined,
    getRepoKey: () => string | undefined,
  ) {
    super(ctx, getRepoRoot, getRepoKey, {
      feature: 'dead-code',
      entry: 'deadcode',
      scan: scanDeadCode,
      scanErrorLabel: 'Dead code scan failed',
    });
  }
}
