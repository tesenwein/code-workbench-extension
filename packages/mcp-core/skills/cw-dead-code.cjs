"use strict";

module.exports = {
  name: "cw-dead-code",
  body: `---
name: cw-dead-code
description: Scan the workspace for dead code — unused exports, unused locals, and commented-out code blocks. Acknowledge false positives so they stay hidden. Requires the cw-dead-code MCP server.
---

# cw-dead-code

Find and triage dead code in the current workspace.

## Procedure

1. **Scan.** Call \`mcp__cw-dead-code__detect_dead_code\` (no arguments for a
   full scan, or pass \`categories\` to narrow to \`exports\`, \`locals\`, or
   \`comments\`).

2. **Present results.** Group findings by \`kind\` and show file + line for each.
   Ask the user whether to **delete**, **acknowledge** (intentional / false
   positive), **exclude directory**, or **skip** each item.

3. **Delete.** If the user chooses to delete a finding, remove the dead code
   from the file. Confirm the change compiles / passes lint.

4. **Acknowledge.** If intentional, call
   \`mcp__cw-dead-code__acknowledge_dead_code\` with the item's \`fingerprint\`
   so it is hidden from future scans. To acknowledge several items at once,
   pass a \`fingerprints\` array instead.

5. **Exclude directory.** If a whole directory should be skipped (e.g. generated
   code, fixtures), call \`mcp__cw-dead-code__exclude_dead_code_dir\` with the
   directory basename.

6. **Summary.** Report how many items were deleted, acknowledged, and skipped.

## Rules

- Never delete code without asking the user first.
- Never acknowledge without confirming it is intentional.
- After deleting, re-run the scan to verify the item is gone.
- If \`detect_dead_code\` is not available, tell the user to open the Dead Code
  panel in the workbench sidebar instead.
`,
};
