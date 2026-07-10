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
