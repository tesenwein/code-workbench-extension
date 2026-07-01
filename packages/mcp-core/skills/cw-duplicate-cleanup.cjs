"use strict";

module.exports = {
  name: "cw-duplicate-cleanup",
  body: `---
name: cw-duplicate-cleanup
description: Scan the active worktree for duplicate code, filter already-acknowledged groups, present results, and guide the user through refactoring or acknowledging each group. Requires the cw-ast MCP server.
---

# cw-duplicate-cleanup

Find and resolve copy-paste code in the current worktree.

## Procedure

1. **Scan for duplicates.** Call \`mcp__cw-ast__find_duplicates\` with the
   active worktree path as the root. Use default options unless the user
   requests stricter/looser thresholds.

2. **Load acknowledgements.** Call \`window.api.listDuplicatesAck\` (or the
   \`duplicates:list-ack\` IPC channel via the workbench) to get the list of
   group fingerprints the user has already acknowledged. Filter them out of
   the scan results.

3. **Present results.** For each remaining group show:
   - Clone type (\`exact\` / \`renamed\` / \`structural\`) and similarity score
   - Each member: file path, symbol name, kind, and line range
   Ask the user whether to **refactor**, **acknowledge**, or **skip** each
   group.

4. **Refactor.** If the user chooses to refactor a group:
   - Identify the best candidate for extraction (usually the most central
     file or the one in a shared module).
   - Extract the shared logic into a single named function/class and update
     all call sites.
   - Confirm the change compiles / passes lint before moving on.

5. **Acknowledge.** If the user chooses to acknowledge a group (intentional
   duplication, different contexts, etc.) call \`window.api.ackDuplicate\`
   with the group fingerprint so it is hidden from future scans.

6. **Summary.** Report how many groups were refactored, acknowledged, and
   skipped.

## Rules

- Never acknowledge a group without asking the user first.
- Prefer extraction over inline duplication: create shared helpers in the
  most appropriate shared module for the codebase.
- After refactoring, re-run the scan to confirm the group is gone.
- If \`find_duplicates\` is not available (no cw-ast MCP server), tell the
  user to open the Duplicates panel in the workbench sidebar instead.
`,
};
