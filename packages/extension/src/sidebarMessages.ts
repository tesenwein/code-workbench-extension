import * as vscode from 'vscode';

/** Message type → VS Code command id, for the per-item actions of a sidebar list. */
export type ItemCommands = Readonly<Record<string, string>>;

/** Run the command mapped to `type`, passing `arg` (e.g. `{ session }`) as its
 *  argument. Unknown message types are ignored. */
export function runItemCommand(
  commands: ItemCommands,
  type: string | undefined,
  arg: object,
): void {
  if (type === undefined || !Object.hasOwn(commands, type)) return;
  void vscode.commands.executeCommand(commands[type], arg);
}
