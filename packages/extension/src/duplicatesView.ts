import * as vscode from 'vscode';
import { ScanViewProvider } from './scanViewProvider';
import { scanDuplicates } from './scanHost';
import type { DuplicateGroup } from './scanHost';

export class DuplicatesViewProvider extends ScanViewProvider<DuplicateGroup> {
  static readonly viewId = 'codeWorkbench.duplicates';

  constructor(
    ctx: vscode.ExtensionContext,
    getRepoRoot: () => string | undefined,
    getRepoKey: () => string | undefined,
  ) {
    super(ctx, getRepoRoot, getRepoKey, {
      feature: 'duplicates',
      entry: 'duplicates',
      scan: scanDuplicates,
      scanErrorLabel: 'Duplicate scan failed',
    });
  }
}
