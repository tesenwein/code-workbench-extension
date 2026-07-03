/* "Code Health" sidebar action bar.
 *
 * Replaces the three narrow scan WebviewViews (Dead Code, Duplicates, Type
 * Safety): the sidebar no longer tries to render scan results in ~300px —
 * each entry here just runs its tool and opens the full editor-tab page
 * (see scanPages.ts / searchPanel.ts). A native TreeView keeps it tiny and
 * theme-native. */

import * as vscode from 'vscode';

interface ActionEntry {
  label: string;
  description: string;
  icon: string;
  command: string;
}

const ACTIONS: ActionEntry[] = [
  {
    label: 'Search Code',
    description: 'hybrid symbol search',
    icon: 'search',
    command: 'codeWorkbench.searchCode',
  },
  {
    label: 'Duplicate Code',
    description: 'scan & compare clones',
    icon: 'copy',
    command: 'codeWorkbench.duplicates.scan',
  },
  {
    label: 'Dead Code',
    description: 'unused exports & locals',
    icon: 'trash',
    command: 'codeWorkbench.deadCode.scan',
  },
  {
    label: 'Type Safety',
    description: 'casts, any, ts-ignore',
    icon: 'shield',
    command: 'codeWorkbench.typeEscapes.scan',
  },
];

class CodeHealthProvider implements vscode.TreeDataProvider<ActionEntry> {
  getTreeItem(entry: ActionEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.description = entry.description;
    item.iconPath = new vscode.ThemeIcon(entry.icon);
    item.command = { command: entry.command, title: entry.label };
    item.tooltip = `Open the ${entry.label} page`;
    return item;
  }

  getChildren(): ActionEntry[] {
    return ACTIONS;
  }
}

export function registerCodeHealthView(): vscode.Disposable {
  return vscode.window.createTreeView('codeWorkbench.codeHealth', {
    treeDataProvider: new CodeHealthProvider(),
  });
}
