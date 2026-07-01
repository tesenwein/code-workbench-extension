"use strict";

module.exports = {
  name: "cw-arch",
  body: `---
name: cw-arch
description: Consult the Claude Workbench architecture wiki (cw-arch MCP) before designing or changing code, so work matches the recorded component guidelines, anti-patterns, and decisions.
---

# cw-arch

This repo has an architecture wiki of component cards exposed via the \`cw-arch\`
MCP server. Consult it before designing or changing code so your work matches
the recorded guidelines and decisions.

## When to use it

- At plan-mode start: call \`mcp__cw-arch__arch_list\` to see the component
  landscape.
- Before changing a component: \`mcp__cw-arch__arch_search\` for the area, then
  \`mcp__cw-arch__arch_get\` the matching card to read its guidelines,
  anti_patterns, and decisions.
- Before relying on a card: call \`mcp__cw-arch__arch_audit\` to detect drift —
  it flags cards whose referenced files no longer exist. Do not trust a drifted
  card; verify against the code and fix the card.
- After a significant change: \`mcp__cw-arch__arch_upsert\` to record new
  components or update guidance. Pass \`tags\` (synonyms) so future searches
  find the card even when the query uses different wording.

## Available tools

\`arch_list\`, \`arch_get\`, \`arch_search\`, \`arch_upsert\`, \`arch_delete\`,
\`arch_audit\`.

## Rules

- The wiki is the source of truth for component intent — when code and a card
  disagree, surface it to the user rather than silently picking one.
- Keep cards current: after a change that alters a component's behavior,
  guidelines, or dependencies, update its card in the same session.
- Don't invent components. Only record a card for a real, identifiable part
  of the system.
`,
};
