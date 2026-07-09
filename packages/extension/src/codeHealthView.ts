/* "Tools" sidebar action bar (view id: codeWorkbench.codeHealth).
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
  /** Overrides the default "Open the <label> page" hover. */
  tooltip?: string;
}

const ACTIONS: ActionEntry[] = [
  {
    label: 'Code Review',
    description: 'review branch & uncommitted changes',
    icon: 'checklist',
    command: 'codeWorkbench.codeReview.start',
    tooltip:
      'Start a Claude session that runs a multi-agent review workflow (dimension fan-out + adversarial verification) over the current changes and files findings as tasks',
  },
  {
    label: 'Plan Session',
    description: 'start a chat in plan mode',
    icon: 'compass',
    command: 'codeWorkbench.sessions.newPlan',
    tooltip: 'Start a new Claude session directly in plan mode (no edits until a plan is approved)',
  },
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
    item.tooltip = entry.tooltip ?? `Open the ${entry.label} page`;
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
