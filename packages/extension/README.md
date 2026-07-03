# Code Workbench

A VS Code extension that turns your editor into a multi-worktree command center for [Claude Code](https://claude.com/claude-code). Spin up branches as git worktrees, drive named Claude/shell sessions in each, and keep a shared task board that Claude itself can read and write.

![icon](media/icon.png)

## Features

### 🌲 Git Worktrees

- Worktrees panel listing every worktree for the current repo — branch name, **ahead/behind** counts, uncommitted file count, and live session count.
- Per-worktree **color tagging** — terminals and view icons are tinted so you always know which branch you're in.
- Inline row actions on every worktree: open in a new window, spawn a session, configure Claude, open a PR, remove.
- Click a worktree row to open it in a new window; **Open in This Window** stays on the context menu.
- Add worktrees three ways: a **fresh branch**, a branch **prefilled with a task**, or one created **straight from a GitHub issue**.
- **Clean Up Merged Worktrees** prunes worktrees whose branches have already landed.
- **Switch Worktree…** sets the active worktree that scopes new sessions and task assignments.

### ✅ Shared Task Board

- Markdown-backed tasks under `.code-workbench/tasks/` — diff-friendly and committable.
- Priority (high/med/low), status (open/in-progress/done), worktree assignment, subtasks via `parentId`, and optional **due dates** with overdue highlighting.
- **Filter** the board by text, toggle to **hide done** tasks (grouped separately when shown), and see **subtask counts** at a glance.
- **Unassigned project tasks** are flagged with `⚑ unassigned` so they don't slip through.
- **Create Worktree for Task** spins up a branch + worktree for any task in one step.
- Bundled **tasks MCP server** lets Claude `task_create`, `task_update`, `task_list`, `task_delete`, and `task_find_similar` directly inside a session — keeping the board in sync with what Claude is doing.

### 💻 Saved Sessions

- Persistent named Claude/shell terminals per worktree; restart on demand, or **restore them automatically** when the workspace opens.
- Profiles: **Claude**, **Claude (yolo / `--dangerously-skip-permissions`)**, plain **Shell**, plus your own **custom profiles** (any command with args, env, and a tab icon).
- Per-worktree Claude config — default model, yolo toggle, and thinking effort.
- A **spark button** in the Workbench panel header → quick-pick session type → launches in the active worktree.
- Rename sessions, set a tab icon, and **remove all inactive sessions** in one click.
- Choose where sessions open — dedicated editor tabs, the bottom terminal panel, or a locked bottom editor group.

### 🔔 Notifications MCP

- Bundled notify MCP server gives Claude tools to:
  - `notify_chat_title` — rename the session tab as the task evolves.
  - `notify_done` / `notify_needs_input` / `notify_info` — surface progress and blockers as VS Code toasts.

### 🎨 Appearance

- Optional commands to apply workbench fonts and a minimal layout.
- Pairs well with the standalone [Paper & Clay](https://github.com/tesenwein/paper-and-clay-theme) theme.

## Install

### From VSIX (recommended for now)

1. Download the latest `.vsix` from [Releases](https://github.com/tesenwein/code-workbench-extension/releases) (or build one — see below).
2. In VS Code: **Extensions** view → `⋯` menu → **Install from VSIX…** → select the file.
3. Reload VS Code.

### Build from source

```bash
git clone https://github.com/tesenwein/code-workbench-extension.git
cd code-workbench-extension
npm install
npm run build
npm run dist   # produces release/extension/*.vsix
```

Then install the generated VSIX as above, or press **F5** inside the project to launch an Extension Development Host.

### Prerequisites

- VS Code **1.85+**
- Node.js **20+** (for building)
- [`claude`](https://claude.com/claude-code) CLI on your `PATH` (override via `codeWorkbench.claudeCommand`)
- `git` with worktree support (any modern version)

## Quick Start

1. Open a git repository in VS Code.
2. Click the **Code Workbench** icon in the Activity Bar.
3. Run **Code Workbench: Initialize in This Repo** from the Worktrees view title bar — this scaffolds `.code-workbench/` for tasks.
4. Add a worktree (`+` in the Worktrees view) for a feature branch.
5. Hit the spark button in the Workbench panel header → pick **Claude** → start coding.
6. Create a task — Claude will see it through the tasks MCP and can update its status as it works.

## Configuration

| Setting                                   | Default                          | Description                                                                                                   |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `codeWorkbench.claudeCommand`             | `claude`                         | Command launched in Claude sessions.                                                                          |
| `codeWorkbench.claudeYoloArgs`            | `--dangerously-skip-permissions` | Extra args for the "yolo" profile.                                                                            |
| `codeWorkbench.sessionPanel`              | `panel`                          | Where sessions open: `editor` tabs, the bottom `panel`, or a locked `bottom-group` editor group.              |
| `codeWorkbench.sessionProfiles`           | `[]`                             | Custom session profiles (label + command, optional args/env/icon) shown alongside Claude/Shell in the picker. |
| `codeWorkbench.restoreSessionsOnOpen`     | `false`                          | Reopen saved session terminals for the active worktree when the workspace opens.                              |
| `codeWorkbench.mcp.tasks.enabled`         | `true`                           | Inject the bundled tasks MCP server into Claude sessions.                                                     |
| `codeWorkbench.mcp.notifications.enabled` | `true`                           | Inject the bundled notifications MCP server.                                                                  |

## Commands

All commands are available under the **Code Workbench:** prefix in the Command Palette. Highlights:

- `Code Workbench: Initialize in This Repo`
- `Code Workbench: Switch Worktree…`
- `Code Workbench: Add Worktree from GitHub Issue…`
- `Code Workbench: Clean Up Merged Worktrees…`
- `Code Workbench: Open Pull Request`
- `Code Workbench: New Session…`
- `Code Workbench: Install Workbench Skills` — Installs the bundled `cw-work` / `cw-plan` skills (usable as slash commands) into either the current project or your user `~/.claude/skills`.
- `Code Workbench: Apply Workbench Fonts` / `Apply Minimal Layout`
- `Code Workbench: Open Settings…`

## Development

```bash
npm install
npm run watch       # incremental TS build
# F5 in VS Code → Extension Development Host
```

The bundled MCP servers live under `mcp-server/` and are spawned automatically by Claude sessions when enabled.

## License

MIT
