// Procedures for the task-bound phase flow: Plan -> Implement -> Review -> Fix.
//
// ONE source of truth for what each phase tells its Claude session to do. Two
// consumers read from here and must never drift apart:
//   - the VS Code extension (commands/taskFlow.ts) inlines the procedure into
//     the prompt of the session it spawns for a phase;
//   - the bundled skills (skills/cw-implement.cjs & co) wrap the same procedure
//     as `/cw-<phase> <taskId>` so a phase can also be driven by hand.
//
// Procedure text carries a `{{TASK_ID}}` placeholder; `phasePrompt` swaps in a
// real id, `phaseSkillBody` swaps in `$ARGUMENTS`.
//
// CommonJS so synced consumers can `require` it; `phase-prompts.mjs` is a thin
// ESM re-export shim.

"use strict";

const TASK_ID = "{{TASK_ID}}";

/** Canonical phase order — the board's state machine. */
const PHASE_ORDER = ["plan", "implement", "review", "fix"];

/** Presentation + session config per phase. `model` is what the spawned
 *  Claude session runs on: planning wants the strongest model, the rest are
 *  execution against an already-made plan. */
const PHASE_META = {
  // No `--permission-mode plan` here: plan mode blocks the mutating cw-tasks
  // calls (task_create/task_update) the procedure needs to file its
  // deliverable. The procedure text itself forbids code edits instead.
  plan: { label: "Plan", icon: "compass", model: "opus", effort: 4 },
  implement: { label: "Implement", icon: "rocket", model: "sonnet" },
  review: { label: "Review", icon: "checklist", model: "sonnet" },
  fix: { label: "Fix", icon: "wrench", model: "sonnet" },
};

/** One-line summary of each phase, reused in skill frontmatter + panel tooltips. */
const PHASE_DESCRIPTIONS = {
  plan: "Explore the codebase and turn a Code Workbench task into an ordered set of implementation subtasks. Plans only — never edits code.",
  implement:
    "Work a Code Workbench task's plan-step subtasks in order, keeping the board in sync, until lint/typecheck/tests pass.",
  review:
    "Review the work done for a Code Workbench task and file each real finding as a review-finding subtask.",
  fix: "Fix the review-finding subtasks filed against a Code Workbench task, then re-run lint/typecheck/tests.",
};

const REREAD = `Work ONLY on task ${TASK_ID} on the shared cw-tasks board. Start by finding it via task_list or task_find_similar and re-reading its current title, description, memo, and subtasks — anything quoted to you may have gone stale.`;

/** Each phase does its own job and stops. A phase that runs the next one's work
 *  destroys the board's meaning: the handoff `task_update` becomes a lie, the
 *  card lands in a column whose work is already (half) done, and no separate
 *  session ever gives that work a fresh pair of eyes. Never advance `phase`
 *  past your own handoff, and never do the work of the phase you hand off to. */
const STAY_IN_LANE =
  "Do the work of THIS phase and nothing else. Hand off by setting `phase` exactly as instructed below — never skip a phase, never set it past the next one, and never start the next phase's work yourself, even if it looks trivial or you can already see the answer. If this phase's work turns out to be unnecessary, still hand off; do not absorb the next phase.";

/** Every phase needs a way OUT that isn't a lie: a session that can't finish
 *  must leave the board recoverable, not stranded in-progress with no signal. */
const IF_BLOCKED = `If you get blocked and cannot finish this phase (missing information, impossible step, broken environment), write what blocks you into the task's memo via task_update (id: "${TASK_ID}", memo: "...") and STOP — leave \`phase\` unchanged so the board still shows this phase as pending. Never advance \`phase\` or mark anything done to get unstuck.`;

const PHASE_PROCEDURES = {
  plan: [
    REREAD,
    STAY_IN_LANE,
    IF_BLOCKED,
    "",
    "Explore the codebase enough to design a concrete implementation approach — do not guess at unfamiliar code. If the architecture wiki has cards for the area you touch (`arch_search`, `arch_get`), respect their guidelines.",
    "",
    'If the task ALREADY has "plan-step" subtasks (a previous Plan run), reconcile instead of duplicating: update or delete stale ones and only add what is missing — never file a second copy of an existing step.',
    "",
    "When you have an approach:",
    `1. Write it into the task's memo via task_update (id: "${TASK_ID}", memo: "...").`,
    `2. Break it into concrete implementation subtasks via task_create (parentId: "${TASK_ID}", tags: ["plan-step"]). Set \`order\` on each (0, 1, 2, ...) to fix the sequence the Implement phase must follow — lower runs first, and subtasks with no \`order\` sort last.`,
    `3. Finally task_update the task itself: id: "${TASK_ID}", phase: "implement".`,
    "",
    "Stop once the plan and subtasks are filed. You may NOT implement: no code edits, no writing the change 'to prove the plan works'. Producing the plan IS the deliverable.",
  ].join("\n"),

  implement: [
    REREAD,
    STAY_IN_LANE,
    IF_BLOCKED,
    "",
    'Work its subtasks tagged "plan-step" strictly one at a time, in `order` (lower first, unordered last; ties break by creation time — if there are none, work the task\'s description directly). Do the work yourself in THIS session — do not delegate subtasks to subagents. Mark each subtask in-progress before you start it and done when it passes. Run whatever lint, typecheck, and test scripts the project has; treat a failure as unfinished work, not a separate finding.',
    "",
    'You may NOT review: do not audit the diff for findings, do not file "review-finding" subtasks, and do not clear `phase` or mark the task done. A failing check is yours to fix; a code smell you notice in passing is the Review phase\'s to find.',
    "",
    `When every "plan-step" subtask (or the task itself, if it had none) is done, task_update the task: id: "${TASK_ID}", phase: "review".`,
  ].join("\n"),

  review: [
    REREAD,
    STAY_IN_LANE,
    IF_BLOCKED,
    "",
    "Review the work done for this task: `git status --short`, `git diff`, `git diff --staged`, and this branch's commits vs its base (resolve origin/HEAD, else develop, else main/master). Read surrounding files for context. Look for correctness bugs, logic errors, missing error handling, type-safety escapes, security issues, and needless complexity.",
    "",
    "You may NOT fix: change no code, not even a one-line typo or an obviously-correct rename. Every finding leaves this phase as a subtask, and the Fix phase applies it. A review that edits its own findings is a review nobody checked.",
    "",
    `File each real finding as a subtask via task_create (parentId: "${TASK_ID}", tags: ["review-finding"], priority reflecting severity, description: "file:line, what is wrong, why it matters, suggested fix"). Set \`order\` on each (0, 1, 2, ...) to fix the sequence the Fix phase should follow.`,
    "",
    `Then hand off via task_update on the task: if you filed any findings, id: "${TASK_ID}", phase: "fix". If you filed none and no other subtasks are still open, id: "${TASK_ID}", phase: "" (clear it), status: "done". If you filed none but other subtasks ARE still open, note in the memo what is left and set phase: "implement" so the remaining work gets picked up — never leave the task with no phase while it is unfinished.`,
  ].join("\n"),

  fix: [
    REREAD,
    STAY_IN_LANE,
    IF_BLOCKED,
    "",
    'List the subtasks tagged "review-finding" that were open when you started, and fix each one strictly one at a time, in `order` (lower first, unordered last; ties break by creation time). Do the work yourself in THIS session — do not delegate findings to subagents. Mark each finding in-progress before you start it and done once fixed. Re-run lint, typecheck, and tests at the end.',
    "",
    'You may NOT review: fix the findings already on the board and no more. If you spot a NEW problem while fixing, file it as another "review-finding" subtask but do NOT fix it — it belongs to the next Review/Fix round.',
    "",
    `Then hand off via task_update on the task: if you filed any NEW findings (or had to change code beyond trivial finding fixes), id: "${TASK_ID}", phase: "review" so the new work gets reviewed. Otherwise, once every "review-finding" subtask is done: id: "${TASK_ID}", phase: "" (clear it), status: "done".`,
  ].join("\n"),
};

function assertPhase(phase) {
  if (!Object.prototype.hasOwnProperty.call(PHASE_PROCEDURES, phase)) {
    throw new Error(`Unknown phase: ${phase}`);
  }
}

/** The phase's instructions with `{{TASK_ID}}` replaced by `taskId`. */
function phaseProcedure(phase, taskId) {
  assertPhase(phase);
  return PHASE_PROCEDURES[phase].split(TASK_ID).join(taskId);
}

/**
 * Full prompt for a spawned phase session: a phase banner, the task's current
 * fields (a convenience — the procedure still tells the session to re-read
 * them), then the procedure itself.
 */
function phasePrompt(phase, task) {
  assertPhase(phase);
  const header = `${PHASE_META[phase].label.toUpperCase()} phase for task ${task.id}.`;
  const context = [`Task ${task.id}: ${task.title}`];
  if (task.description) context.push("", task.description);
  if (phase === "implement" && task.memo) context.push("", `Plan memo:\n${task.memo}`);
  return [header, "", ...context, "", phaseProcedure(phase, task.id)].join("\n");
}

/**
 * Full prompt for ONE session that runs `phase` across several tasks, one after
 * another. The per-task procedure is repeated verbatim with each task's id
 * substituted, so a batched task is instructed exactly as it would be in its own
 * session — including its own handoff `task_update`. Strictly sequential:
 * the phases mutate the board and the working tree, and a batch that interleaves
 * them would produce diffs no Review phase can attribute to a task.
 */
function phasePromptBulk(phase, tasks) {
  assertPhase(phase);
  if (tasks.length === 1) return phasePrompt(phase, tasks[0]);
  // Stable-sort by `order` (nulls last) so the batch runs in the planner's
  // intended sequence no matter how the caller ordered it.
  tasks = tasks
    .map((task, i) => ({ task, i }))
    .sort((a, b) => {
      const ao = a.task.order ?? Infinity;
      const bo = b.task.order ?? Infinity;
      return ao === bo ? a.i - b.i : ao - bo;
    })
    .map(({ task }) => task);
  const label = PHASE_META[phase].label;
  const header = [
    `${label.toUpperCase()} phase for ${tasks.length} tasks, run in THIS one session.`,
    "",
    `Work them in the order below, STRICTLY ONE AT A TIME: finish a task's ${label} phase completely — including its handoff task_update — before you read the next one. Never batch the board writes, and never delegate a task to a subagent.`,
    `If one task blocks you, record the blocker in its memo as its procedure says, then CONTINUE with the next task; one blocked task must not abandon the rest. When every task below is finished, report a one-line result per task.`,
  ].join("\n");

  const blocks = tasks.map((task, i) => {
    const context = [`Task ${task.id}: ${task.title}`];
    if (task.description) context.push("", task.description);
    if (phase === "implement" && task.memo) context.push("", `Plan memo:\n${task.memo}`);
    return [
      `--- Task ${i + 1} of ${tasks.length} — ${task.id} ---`,
      "",
      ...context,
      "",
      phaseProcedure(phase, task.id),
    ].join("\n");
  });

  return [header, "", ...blocks].join("\n\n");
}

/** `.claude/skills/cw-<phase>/SKILL.md` body — the same procedure, driven by
 *  hand as `/cw-<phase> <taskId>`. */
function phaseSkillBody(phase) {
  assertPhase(phase);
  const name = `cw-${phase}`;
  return [
    "---",
    `name: ${name}`,
    `description: ${PHASE_DESCRIPTIONS[phase]}`,
    "---",
    "",
    `# ${name}`,
    "",
    `Run the **${PHASE_META[phase].label}** phase of the Code Workbench task flow against the task id given in \`$ARGUMENTS\`. If no id was given, ask for one — never guess which task is meant.`,
    "",
    "## Procedure",
    "",
    phaseProcedure(phase, "$ARGUMENTS"),
  ].join("\n");
}

/** A `{ name, body }` skill record for a phase, shaped for BUNDLED_SKILLS. */
function phaseSkill(phase) {
  return { name: `cw-${phase}`, body: `${phaseSkillBody(phase)}\n` };
}

module.exports = {
  PHASE_ORDER,
  PHASE_META,
  PHASE_DESCRIPTIONS,
  phaseProcedure,
  phasePrompt,
  phasePromptBulk,
  phaseSkillBody,
  phaseSkill,
};
