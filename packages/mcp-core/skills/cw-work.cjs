"use strict";

module.exports = {
  name: "cw-work",
  body: `---
name: cw-work
description: Work through Claude Workbench tasks. Fetches open tasks via the cw-tasks MCP, breaks each into Claude TaskCreate items, and keeps both the workbench task status and Claude tasks in sync as work proceeds.
---

# cw-work

Process the Claude Workbench task queue for this workspace.

## Procedure

1. **Fetch open work.** Call \`mcp__cw-tasks__task_list\` with
   \`status: "open"\`. The list is scoped to this worktree but also surfaces the
   shared backlog of **unassigned** tasks, each marked \`[unassigned]\`. If
   nothing is returned, stop and tell the user the queue is empty.
2. **Pick the next task.** Tasks are returned sorted by priority then status.
   Take the first task **assigned to this worktree** unless the user names a
   specific id. Do NOT pick a task marked \`[unassigned]\` on your own — see
   Rules.
3. **Mark it in-progress.** Immediately call
   \`mcp__cw-tasks__task_update\` with
   \`status: "in-progress"\` so the workbench reflects current work.
4. **Break it down.** Read the task title, description and memo carefully.
   Create one Claude task per concrete step with \`TaskCreate\`. Keep steps
   small and verifiable. Set the first step to \`in_progress\`.
5. **Execute step by step.** As each Claude task finishes, mark it
   \`completed\` and the next one \`in_progress\` — do not batch updates.
6. **Mirror progress back to the workbench.** When meaningful state changes
   (blocker found, scope shift, partial completion) call \`task_update\` with
   a \`memo\` describing the situation. Do NOT overwrite \`description\`.
7. **Close the loop.** When all Claude tasks for the workbench task are
   \`completed\`, call \`task_update\` with \`status: "done"\`. Then loop back
   to step 1 if the user asked to drain the queue.

## Rules

- **Unassigned tasks are visible but not yours to start.** The queue surfaces
  the shared backlog as root tasks marked \`[unassigned]\` (only roots carry the
  marker — their subtasks inherit the root's assignment and stay unmarked).
  **Never begin an \`[unassigned]\` task unless the user explicitly asks** for
  it (by id or by pointing you at it). When draining the queue in step 7, loop
  only over root tasks assigned to this worktree — skip any \`[unassigned]\`
  root and all of its subtasks.
- **Claim an unassigned task before working it.** When the user directs you to
  an \`[unassigned]\` task, first claim it for this worktree with
  \`mcp__cw-tasks__task_update\` — set \`worktree\` to this worktree's root
  folder name (the basename of the path \`git rev-parse --show-toplevel\`
  prints; the server lowercases it) so a parallel session doesn't grab it too.
  Then proceed from step 3.
- Never edit task .md files directly — always use the MCP tools.
- One workbench task → many Claude tasks. Don't mash unrelated workbench
  tasks into one TaskCreate batch.
- Keep workbench status truthful: \`open\` → \`in-progress\` the moment you
  start, \`done\` only when the work is actually finished.
- If a task is ambiguous, ask the user before breaking it down. Don't invent
  scope.
`,
};
