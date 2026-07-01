import * as vscode from 'vscode';
import { ScanViewProvider } from './scanViewProvider';
import { scanTypeEscapes } from './scanHost';
import type { TypeEscapeItem } from './scanHost';

export class TypeEscapeViewProvider extends ScanViewProvider<TypeEscapeItem> {
  static readonly viewId = 'codeWorkbench.typeEscapes';

  constructor(
    ctx: vscode.ExtensionContext,
    getRepoRoot: () => string | undefined,
    getRepoKey: () => string | undefined,
  ) {
    super(ctx, getRepoRoot, getRepoKey, {
      feature: 'type-escapes',
      entry: 'typeescapes',
      scan: scanTypeEscapes,
      scanErrorLabel: 'Type-escape scan failed',
    });
  }
}
