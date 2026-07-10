/* Minimal `vscode` stand-in so src modules that import the API can be loaded in
 * Vitest (node environment). Only what the tests actually touch is populated —
 * anything else is left undefined on purpose, so a test that starts depending
 * on real editor behaviour fails loudly instead of silently passing. */

export const executedCommands: unknown[][] = [];
export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: (...args: unknown[]) => {
    executedCommands.push(args);
    return Promise.resolve(undefined);
  },
};
export const window = {};
export const workspace = { getConfiguration: () => ({ get: () => true }) };
export const Uri = { joinPath: () => ({}), parse: () => ({}), file: () => ({}) };
export const ProgressLocation = { Notification: 15 };
export class TreeItem {
  constructor(
    public label?: unknown,
    public collapsibleState?: unknown,
  ) {}
}
export class Disposable {
  constructor(private readonly onDispose: () => void = () => {}) {}
  dispose(): void {
    this.onDispose();
  }
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const ThemeIcon = class {
  constructor(public id: string) {}
};
