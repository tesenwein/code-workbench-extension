"use strict";

module.exports = {
  name: "cw-work",
  body: `---
name: cw-work
description: Work through Claude Workbench tasks. Fetches open tasks via the cw-tasks MCP, breaks each into Claude TaskCreate items, and keeps both the workbench task status and Claude tasks in sync as work proceeds.
---

# cw-work

Drain this worktree's Claude Workbench task queue.

## Loop

1. \`mcp__cw-tasks__task_list\` (\`status: "open"\`). Take the first root task
   assigned to this worktree, or the id the user named. Empty queue → say so and stop.
2. Set it \`in-progress\`, then work it: break it into \`TaskCreate\` steps if
   useful, execute, and keep both boards truthful (\`in-progress\` when you start,
   \`done\` only when finished). Log blockers/scope shifts via \`task_update\`
   \`memo\` — never overwrite \`description\`.
3. When done, set the workbench task \`done\` and loop back to step 1 (skip
   \`[unassigned]\` roots).

## Parallel subtasks

Subtasks flagged \`parallel: true\` under the same parent are safe to run
concurrently. Dispatch each parallel wave — parallel siblings sharing an
\`order\` — as simultaneous subagents (one Agent call per subtask, in one
message), then wait for the wave before moving on. Run non-parallel subtasks
sequentially in \`order\`.

## Rules

- \`[unassigned]\` roots are the shared backlog — never start one unless the user
  points you at it. When they do, first claim it (\`task_update\` \`worktree\` =
  this worktree's folder basename) so a parallel session doesn't grab it too.
- Use the MCP tools only; never hand-edit task .md files.
- Ambiguous task → ask before inventing scope.
`,
};
