"use strict";

module.exports = {
  name: "cw-type-safety",
  body: `---
name: cw-type-safety
description: Scan the workspace for TypeScript type-safety escape hatches — \`as\` casts, explicit \`any\`, non-null \`!\` assertions, and @ts-ignore/@ts-expect-error. Acknowledge intentional ones so they stay hidden. Requires the cw-type-safety MCP server.
---

# cw-type-safety

Find and triage TypeScript type-safety escape hatches in the current workspace.

## Procedure

1. **Scan.** Call \`mcp__cw-type-safety__detect_type_escapes\`. With no
   arguments it reads the last host-written findings file; pass
   \`force_scan: true\` to run a fresh inline scan. Narrow with \`categories\`
   (\`as-cast\`, \`any-type\`, \`non-null\`, \`ts-ignore\`).

2. **Scope to the branch (recommended for PR review).** Pass
   \`diff_only: true\` to return only findings in files changed on the current
   branch vs \`base_ref\` (defaults to \`develop\`). This answers "what did THIS
   branch introduce" instead of dumping the whole-repo backlog. The response
   carries a \`diffScope\` summary and a \`byKind\` count map.

3. **Present results.** Lead with the \`byKind\` breakdown, then group findings
   by \`kind\` and show file + line + snippet. For each, ask the user whether to
   **fix** (replace the cast/any with a proper type), **acknowledge**
   (intentional / unavoidable), **exclude directory**, or **skip**.

4. **Fix.** If the user chooses to fix a finding, replace the escape hatch with
   a correct type. Prefer narrowing/guards over casts; a real interface over
   \`any\`. Confirm the change still type-checks.

5. **Acknowledge.** If intentional, call
   \`mcp__cw-type-safety__acknowledge_type_escape\` with the item's
   \`fingerprint\` so it is hidden from future scans. To acknowledge several at
   once, pass a \`fingerprints\` array. Pass \`unack: true\` to re-surface.

6. **Exclude directory.** If a whole directory should be skipped (e.g. generated
   code, fixtures), call \`mcp__cw-type-safety__exclude_type_escape_dir\` with
   the directory basename.

7. **Summary.** Report how many items were fixed, acknowledged, and skipped.

## Rules

- Never change code without asking the user first.
- Never acknowledge without confirming it is intentional — an \`as\` cast that
  hides a real bug should be fixed, not hidden.
- \`as const\` is already excluded; do not treat it as an escape hatch.
- After fixing, re-run the scan (\`force_scan: true\`) to verify the item is gone.
- If \`detect_type_escapes\` is not available, tell the user to open the Type
  Safety panel in the workbench sidebar instead.
`,
};
