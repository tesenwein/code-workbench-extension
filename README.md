<div align="center">

<img src="packages/extension/media/icon.png" width="110" alt="Code Workbench logo" />

# Code Workbench

**A VS Code extension built around Claude Code.**

Git worktrees, per-worktree Claude sessions, and a shared task board — all inside your editor, kept in sync with the agent through bundled MCP servers.

[![License](https://img.shields.io/github/license/tesenwein/code-workbench-extension)](LICENSE)
[![Releases](https://img.shields.io/github/v/release/tesenwein/code-workbench-extension?include_prereleases&label=release)](https://github.com/tesenwein/code-workbench-extension/releases)
[![CI](https://github.com/tesenwein/code-workbench-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/tesenwein/code-workbench-extension/actions/workflows/ci.yml)

[Download](https://github.com/tesenwein/code-workbench-extension/releases/latest) · [Features](#-features) · [Quick start](#-quick-start) · [Development](#%EF%B8%8F-development)

</div>

---

## Overview

Working with Claude Code across several branches means juggling worktrees, terminals, and a running mental list of what each agent is doing. The Code Workbench VS Code extension puts the worktree + session + task workflow inside your editor: spin up a Git worktree, launch a Claude session inside it, and track tasks on a board that Claude can read and update directly through bundled MCP servers — so the agent stays in sync with what you're working on.

## ✨ Features

|                             |                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🌳 **Worktree-first**       | Create, switch, and prune Git worktrees per repo — each with branch, ahead/behind, and uncommitted count. Start a worktree from a branch, task, or GitHub issue.                                                                                                |
| 🤖 **Claude sessions**      | Per-worktree Claude, Claude Yolo (`--dangerously-skip-permissions`), or plain shell, each with a pickable tab icon.                                                                                                                                             |
| ✅ **Shared task board**    | Markdown-backed tasks with priority, status, subtasks, and due dates — kept in sync by the bundled tasks MCP server. Edit in the sidebar or a full-page Task Board.                                                                                             |
| 🔄 **Task phase flow**      | Drive a task through Plan → Implement → Review → Fix on the **Phase Board**: one column per phase, and a Start button that spawns a Claude session bound to that task, on the model that phase calls for.                                                       |
| 🔔 **Notifications MCP**    | Toast notifications from Claude sessions (`notify_done`, `notify_needs_input`, `notify_info`) plus tab renaming.                                                                                                                                                |
| 🔎 **Semantic code search** | AST-backed hybrid search (`search_code`) so Claude finds symbols by intent, plus file outlines and symbol source lookup — with a results page showing code snippets.                                                                                            |
| 🗺️ **Architecture wiki**    | Git-tracked component cards (`arch` MCP) capturing guidelines, anti-patterns, and decisions — with drift auditing and semantic card search.                                                                                                                     |
| 🧹 **Code health**          | Duplicate detection (exact/renamed/structural), dead-code scanning (unused exports/locals, commented code), and type-safety escape hatch detection (`as`/`any`/`!`/`@ts-ignore`) — full editor-tab pages with clickable snippets and per-repo acknowledgements. |
| 🧩 **Bundled skills**       | Ships `cw-*` Claude Code skills (`cw-work`, `cw-plan`, `cw-implement`, `cw-review`, `cw-fix`, `cw-arch`, `cw-dead-code`, `cw-duplicate-cleanup`, `cw-type-safety`, …), installable per-user or per-worktree and auto-synced when updated.                       |
| 🎨 **Theme-aware UI**       | Webview panels derive their palette from the active VS Code theme, tinted per-worktree, with high-contrast support.                                                                                                                                             |
| 🌐 **Language**             | Set the natural language Claude replies in (and, independently, the language for code comments) in **Settings → Language** — locale/sprache. Applies to sessions started after the change; identifiers, commit messages, and PR titles stay English.          |

## 💻 Installation

Code Workbench isn't on the Marketplace yet — install it from the packaged `.vsix`:

1. **Download** the latest `code-workbench-*.vsix` from the [**GitHub Releases**](https://github.com/tesenwein/code-workbench-extension/releases/latest) page (under **Assets**).
2. In VS Code, open the Command Palette (`Cmd/Ctrl + Shift + P`) and run **Extensions: Install from VSIX…**, then pick the file you downloaded.
   - Or from a terminal: `code --install-extension code-workbench-<version>.vsix`.
3. Reload VS Code if prompted, then open the **Code Workbench** icon in the Activity Bar.

You'll also need the [`claude` CLI](https://docs.claude.com/en/docs/claude-code) on your `PATH` for Claude sessions.

> Building from source instead? Run `pnpm run dist:extension` to produce your own `.vsix` under `release/extension/` (see [Development](#%EF%B8%8F-development)).

## 🚀 Quick start

1. Open a git repo in VS Code and click the **Code Workbench** icon in the Activity Bar.
2. Run **Code Workbench: Initialize in This Repo**.
3. Add a worktree (`+` in the Worktrees view), hit the spark button → **Claude**, and start coding.
4. Create a task; Claude sees it through the tasks MCP and updates its status as it works.

## 🔄 Task phase flow

A task can be driven through four phases, each run by its own Claude session bound to that one task:

| Phase         | Default model | What the session does                                                                                                                     |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan**      | `opus`        | Explores the code read-only (`--permission-mode plan`), writes the approach into the task's memo, and files ordered `plan-step` subtasks. |
| **Implement** | `sonnet`      | Works the `plan-step` subtasks in order until lint, typecheck, and tests pass.                                                            |
| **Review**    | `sonnet`      | Reviews the branch diff and files each finding as a `review-finding` subtask.                                                             |
| **Fix**       | `sonnet`      | Fixes the `review-finding` subtasks, then re-runs the checks.                                                                             |

Open the **Phase Board** from the Tasks view toolbar (or **Code Workbench: Open Phase Board**). It shows one column per phase — plus **Unstarted** for tasks not yet in the flow — with a task count per column and a Start button on every card.

The task's `phase` field names the phase to run **next**, so the column a card sits in is exactly the phase its Start button launches. Each session hands off by setting `phase` on the task when it finishes, which moves the card to the next column. The board is the state machine, not the chat transcript: close a session and reopen the task later and nothing is lost.

To run a phase by hand instead, use the bundled skills — `/cw-plan`, `/cw-implement <taskId>`, `/cw-review <taskId>`, `/cw-fix <taskId>`. They follow the same procedure the board's Start button injects, because both are generated from `packages/mcp-core/phase-prompts.cjs`.

### Choosing the model per phase

Defaults are the table above. Override them in two places, most specific wins:

- **Globally** — _Code Workbench · Settings_ → **Task Flow**.
- **Per worktree** — the worktree's Claude settings → **Task Flow**. Each phase can _inherit_ (showing what it resolves to) or pin a model.

## 🛠️ Development

A pnpm monorepo built with **React 19**, **TypeScript**, and **esbuild**. Requires **Node 20+** and **pnpm**.

```bash
# install dependencies
pnpm install

# extension dev build in watch mode (then press F5 in VS Code)
pnpm run dev:extension

# lint, build, and test everything
pnpm -r lint
pnpm -r build
pnpm -r test

# package the extension
pnpm run dist:extension   # produces release/extension/*.vsix
```

### Project structure

```
packages/
├─ extension/    VS Code extension
├─ ui/           Shared React UI components
├─ git-utils/    Git helpers shared across packages
└─ mcp-core/     Bundled MCP servers (notify, tasks, arch, AST/code search, dead-code, type-safety), unified behind one `cw-code` endpoint
```

At package time the `mcp-core` server scripts are bundled into the extension under an `mcp-server/` folder — that path exists in built artifacts, not in the source tree.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## 🔁 CI / Releases

Two GitHub Actions workflows drive the project:

- **CI** — on every push to `develop` and PRs to `main`/`develop`: ESLint, formatting, type-check (build), tests, and a gitleaks secret scan.
- **Release** — when `develop` is merged into `main`: bumps the extension version, builds the VSIX, and publishes a GitHub Release with the `.vsix` attached.

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome — [open an issue](https://github.com/tesenwein/code-workbench-extension/issues) or submit a PR against `develop`.

## 📄 License

[MIT](LICENSE) © Theo Esenwein

---

<div align="center"><sub>Built for developers who live in Claude Code.</sub></div>
