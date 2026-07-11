// Bundled Claude Workbench agent definitions (Claude Code subagents), shared
// by the Electron app and the VS Code extension. ONE source of truth — each
// consumer installs these as `.claude/agents/<name>.md` files (user or
// project scope).
//
// The agent bodies are GENERATED from the shared phase procedures in
// `phase-prompts.cjs`, so an agent, the matching `/cw-<phase>` skill, and the
// prompt the Phase Board spawns for that phase can never drift apart.
//
// CommonJS so synced consumers can `require` it; `agents.mjs` is a thin ESM
// re-export shim.

"use strict";

const { PHASE_META, PHASE_DESCRIPTIONS, phaseProcedure } = require("./phase-prompts.cjs");

/** Placeholder the agent is told to substitute with the id from its prompt. */
const TASK_ID = "<taskId>";

/** Board tools every phase agent needs to keep the shared board in sync. */
const TASK_TOOLS = [
  "mcp__cw-code__task_list",
  "mcp__cw-code__task_create",
  "mcp__cw-code__task_update",
  "mcp__cw-code__task_find_similar",
];

/**
 * Build one `.claude/agents/<name>.md` record for a phase. `agentName` is the
 * installed file name (distinct from the `cw-<phase>` skill names so an agent
 * never shadows a skill in prose). `tools` limits the agent's toolset; omit to
 * inherit everything.
 */
function phaseAgent(phase, agentName, description, { tools, extra = [] } = {}) {
  const frontmatter = [
    "---",
    `name: ${agentName}`,
    `description: ${description}`,
    ...(tools ? [`tools: ${tools.join(", ")}`] : []),
    `model: ${PHASE_META[phase].model}`,
    "---",
  ];
  const body = [
    ...frontmatter,
    "",
    `You run the **${PHASE_META[phase].label}** phase of the Code Workbench task flow for ONE task on the shared cw-tasks board.`,
    "",
    `The task id is given in your prompt. Wherever the procedure below says \`${TASK_ID}\`, substitute that id. If your prompt names no task id, stop and report that you need one — never guess which task is meant.`,
    "",
    "As a subagent you cannot spawn further subagents — where the procedure mentions dispatching work via subagents, work those steps yourself, sequentially, in order.",
    "",
    "Your final message is returned to the session that delegated to you: report what you did, the board updates you made, and anything that blocked you.",
    ...(extra.length ? ["", ...extra] : []),
    "",
    "## Procedure",
    "",
    phaseProcedure(phase, TASK_ID),
    "",
  ];
  return { name: agentName, body: body.join("\n") };
}

const CW_IMPLEMENTER = phaseAgent(
  "implement",
  "cw-implementer",
  `Run the Implement phase of a Code Workbench (cw-tasks) board task. ${PHASE_DESCRIPTIONS.implement} Use when a board task in the Implement phase should be worked in an isolated context.`,
);

const CW_REVIEWER = phaseAgent(
  "review",
  "cw-reviewer",
  `Run the Review phase of a Code Workbench (cw-tasks) board task. ${PHASE_DESCRIPTIONS.review} Read-only for code — it can never edit files. Use when a board task in the Review phase needs a fresh pair of eyes.`,
  {
    // No Edit/Write/NotebookEdit: the review contract forbids fixing, and a
    // restricted toolset enforces that harder than prose can.
    tools: ["Bash", "Read", "Grep", "Glob", ...TASK_TOOLS],
    extra: [
      "Your toolset is read-only for code on purpose: a review that edits its own findings is a review nobody checked. Use Bash only for read-only inspection (git status/diff/log, running tests) — never to mutate files.",
    ],
  },
);

const CW_FIXER = phaseAgent(
  "fix",
  "cw-fixer",
  `Run the Fix phase of a Code Workbench (cw-tasks) board task. ${PHASE_DESCRIPTIONS.fix} Use when a board task in the Fix phase has open review-finding subtasks to resolve.`,
);

/** Every agent definition the workbench installs. */
const BUNDLED_AGENTS = [CW_IMPLEMENTER, CW_REVIEWER, CW_FIXER];

/**
 * Agent file names shipped by older versions — removed on (re)install so a
 * stale copy can't linger under a legacy name. None yet.
 */
const LEGACY_AGENT_NAMES = [];

module.exports = { BUNDLED_AGENTS, LEGACY_AGENT_NAMES };
