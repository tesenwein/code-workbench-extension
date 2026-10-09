# Contributing to Code Workbench

Thanks for your interest in improving Code Workbench! This is a pnpm monorepo
(VS Code extension and shared MCP core).

## Getting started

```bash
pnpm install
pnpm run dev:extension    # extension watch build (press F5 in VS Code)
```

Requires **Node 20+** and **pnpm**, plus the [`claude` CLI](https://docs.claude.com/en/docs/claude-code)
on your `PATH` for Claude sessions.

## Branching

- Base your work on **`develop`** and open PRs against `develop`.
- `main` is the release branch — merging into it bumps the version, builds the
  `.vsix`, and cuts a GitHub Release (`.github/workflows/release.yml`).
- A follow-up job (`.github/workflows/publish-stores.yml`) publishes the release tag to the VS Code Marketplace and Open VSX when the
  repository secrets `VSCE_PAT` (Azure DevOps PAT with Marketplace _Manage_ scope
  for publisher `tesenwein`) and `OVSX_PAT` (open-vsx.org token) exist. Each
  store step is skipped when its secret is missing. If a store publish fails,
  re-run the failed job (or run `publish-stores.yml` with the release tag) —
  it builds from the tag, so the version is not bumped again, and an
  already-published version is skipped. `vsce` is a lockfile-pinned dev
  dependency; `ovsx` is pinned to an exact version in the workflow. The store build strips
  `enabledApiProposals`, which the stores reject.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `refactor:`, `chore:`, `docs:`, `test:`, `style:`, `perf:`.

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm -r lint
pnpm format:check
pnpm -r build
pnpm -r test
```

## Project layout

```
packages/
├─ extension/    VS Code extension
├─ ui/           Shared React UI components
├─ git-utils/    Git helpers
└─ mcp-core/     Bundled MCP servers (tasks, notify, arch, AST, dead-code, clone-detect)
```

> **Note:** files under `packages/mcp-core` follow a committed code style that differs from
> the repo `.prettierrc.json` — don't run `prettier --write` on them.

## Reporting issues

[Open an issue](https://github.com/tesenwein/code-workbench-monorepo/issues) with steps to
reproduce, your OS, and the extension version.
