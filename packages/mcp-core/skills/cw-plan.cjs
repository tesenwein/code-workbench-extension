"use strict";

module.exports = {
  name: "cw-plan",
  body: `---
name: cw-plan
description: Plan a feature and persist it as Claude Workbench tasks and subtasks via the cw-tasks MCP. Use when the user wants a feature designed and recorded — not just discussed.
---

# cw-plan

Turn a feature request into a structured, persisted plan. **Never implement anything.**

## Procedure

1. **Investigate.** Read relevant code and consult the architecture wiki
   (\`arch_list\`, \`arch_search\`, \`arch_get\`) so the plan respects existing
   guidelines. Ask clarifying questions only when a decision can't be made
   from the codebase.
2. **Draft the plan.** Short hierarchical structure:
   - One top-level item per coherent piece of work.
   - Concrete subtasks under each.
3. **Confirm with the user.** Present the plan and wait for approval before
   persisting.
4. **Persist.** For each approved top-level item call \`task_create\` with
   title + rationale in \`description\` + \`priority\` + \`phase: "implement"\`
   (so the Phase Board files it in Implement, not Unstarted), capture the id,
   then call \`task_create\` for each subtask with \`parentId\` and
   \`tags: ["plan-step"]\`.
5. **Report.** List the created task ids so the user can find them in the
   workbench.

## Rules

- Planning only — no code changes, no file edits, ever.
- Titles are short and imperative ("add X", "migrate Y").
- Put the *why* in \`description\`, not the title.
- No placeholder tasks. If a step isn't concrete enough to act on, refine it first.
- Implementation is [[cw-work]]'s job.
`,
};
