"use strict";

module.exports = {
  name: "cw-arch-audit",
  body: `---
name: cw-arch-audit
description: Audit the architecture wiki (cw-arch MCP) for drift and inconsistency with the actual code. Auto-corrects the arch where the fix is unambiguous; asks the user with multiple choices where it is not.
---

# cw-arch-audit

Check that the architecture wiki still matches the code, and reconcile it.

This skill is repo-agnostic — it works for any project that has cw-arch cards.
Never assume the Claude Workbench codebase specifically; resolve every path
against the current workspace.

## Procedure

1. **Detect drift.** Call \`mcp__cw-arch__arch_audit\` to get cards whose
   referenced files no longer exist. If the wiki is empty, stop and tell the
   user there is nothing to audit.

2. **Load the cards.** Call \`mcp__cw-arch__arch_list\`, then
   \`mcp__cw-arch__arch_get\` for each card (start with the drifted ones).

3. **Cross-check each card against the code.** For every card verify:
   - **Referenced files/paths exist** — flagged by step 1, plus any paths
     mentioned in the description, guidelines, or decisions.
   - **Description still matches** the component's actual responsibility.
   - **Guidelines / anti_patterns** are still true of the code (e.g. a rule
     that says "use X" when the code has moved to Y).
   - **Dependencies / tags** reflect what the component actually imports and
     how it would be searched for.
   Use \`Grep\`, \`Glob\`, \`Read\`, and the \`cw-ast\` tools (\`search_code\`,
   \`get_file_outline\`) to confirm — do not guess.

4. **Classify each inconsistency:**
   - **Auto-fixable** — the correct value is unambiguous from the code: a
     renamed/moved file, a stale path, an obsolete guideline whose
     replacement is obvious, a missing tag, a description that is simply
     out of date. Fix these directly.
   - **Needs a decision** — code and card genuinely disagree on *intent*, the
     component looks deleted/merged/split, or there are multiple plausible
     corrections. Do not guess these.

5. **Apply auto-fixes.** For each auto-fixable card call
   \`mcp__cw-arch__arch_upsert\` with the corrected fields. Keep cards concise
   per the repo's CLAUDE.md arch-card rules (short imperative guidelines,
   1–2 sentence description, ≤3 decisions, 3–6 tags).

6. **Ask about the rest.** For each "needs a decision" item, present the user
   a numbered multiple-choice question, e.g.:
   - Card \`<name>\`: referenced file \`<path>\` is gone.
     1) Repoint to \`<best-guess path>\`  2) Delete the card (component removed)
     3) Merge into card \`<other>\`  4) Leave as-is / I'll handle it
   Apply the chosen action (\`arch_upsert\` or \`arch_delete\`).

7. **Summary.** Report counts: cards checked, auto-fixed, deleted, and
   resolved by the user — and list any cards still flagged.

## Rules

- Never delete a card without asking the user first.
- Auto-fix only when the correct value is unambiguous; when in doubt, ask.
- Verify against real code before changing a card — drift cuts both ways, the
  card may be right and the code wrong (surface that to the user).
- Do not invent components or pad cards into documentation; they are
  navigation aids. See [[cw-arch]] for arch-card conventions.
`,
};
