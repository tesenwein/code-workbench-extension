"use strict";

module.exports = {
  name: "cw-plan-feature",
  script: `export const meta = {
  name: 'cw-plan-feature',
  description: 'Gather context, draft an implementation plan, and critique it once for completeness',
  phases: [
    { title: 'Context', detail: 'repo map, arch wiki cards, prior art', model: 'sonnet' },
    { title: 'Plan', detail: 'single design + hierarchical plan', model: 'opus' },
    { title: 'Critique', detail: 'one completeness pass, one revision', model: 'opus' },
  ],
}

const request = typeof args === 'string' ? args : args && args.request
if (!request) {
  throw new Error('cw-plan-feature requires a feature request via args (string or { request })')
}

const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    facts: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'facts', 'files'],
}

const SUBTASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    order: { type: 'number' },
  },
  required: ['title', 'description', 'order'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          subtasks: { type: 'array', items: SUBTASK_SCHEMA },
        },
        required: ['title', 'description', 'priority', 'subtasks'],
      },
    },
  },
  required: ['summary', 'openQuestions', 'tasks'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gap: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['gap', 'why'],
      },
    },
  },
  required: ['gaps'],
}

const CONTEXT_TASKS = [
  {
    key: 'repo-map',
    prompt: \`Map this repository at a high level for someone about to plan a new feature. Report the overall structure (key packages/dirs and what they own) and the build/test/lint commands (from package.json scripts, Makefile, or CI config). Do not design anything — only gather facts. The feature request for context: "\${request}". Return summary, facts (bullet facts about structure/conventions relevant to this request), and files (key existing files a design should be aware of).\`,
  },
  {
    key: 'arch-wiki',
    prompt: \`Consult the architecture wiki via the cw-arch MCP tools: call arch_list for the component landscape, then arch_search for terms relevant to this feature request, then arch_get the best-matching cards. Feature request: "\${request}". Return summary, facts (guidelines, anti-patterns, and decisions recorded in matching cards), and files (files referenced by those cards). If the wiki has nothing relevant, say so in summary and return empty facts/files.\`,
  },
  {
    key: 'prior-art',
    prompt: \`Look for prior art relevant to this feature request: "\${request}". Use task_find_similar with status:'done' against the request text to find similar completed work (read memos for decisions/blockers), and search_code to locate existing related code. Return summary, facts (what prior tasks did and any reusable decisions), and files (existing files relevant to this request).\`,
  },
]

phase('Context')
const contextResults = await parallel(
  CONTEXT_TASKS.map(t => () => agent(t.prompt, { label: \`context:\${t.key}\`, model: 'sonnet', phase: 'Context', schema: CONTEXT_SCHEMA })),
)
const contextBrief = contextResults
  .filter(Boolean)
  .map(c => [c.summary, ...(c.facts || []).map(f => \`- \${f}\`), ...(c.files || []).map(f => \`file: \${f}\`)].join('\\n'))
  .join('\\n\\n')

phase('Plan')
let plan = await agent(
  [
    \`Design an implementation plan for this feature request: "\${request}"\`,
    '',
    'Context gathered about this repository:',
    contextBrief,
    '',
    'Prefer the smallest change that delivers the request, reusing existing patterns and staying consistent with the architecture above; briefly weigh alternatives where the choice is not obvious, and surface real risks in the task descriptions.',
    '',
    "Return summary (what will be built and why), openQuestions (anything that needs a human decision before implementation), and tasks: a hierarchical breakdown where each task has title, description, priority, and subtasks (each with title, description, order). Assign each subtask an 'order' (0, 1, 2, ...) reflecting the sequence it must be implemented in — lower runs first. Do not touch any code — this is planning only.",
  ].join('\\n'),
  { model: 'opus', phase: 'Plan', schema: PLAN_SCHEMA },
)
if (!plan) {
  throw new Error('Plan agent failed to produce a plan')
}

phase('Critique')
const critique = await agent(
  [
    \`Critique this implementation plan for completeness against the original feature request: "\${request}"\`,
    '',
    \`Plan: \${JSON.stringify(plan)}\`,
    '',
    'Look specifically for: files that clearly need to change but are untouched by any task, assumptions the plan relies on that are never verified, and missing test/doc/migration steps. Do not flag stylistic preferences. Return gaps: [] if the plan is complete.',
  ].join('\\n'),
  { model: 'opus', phase: 'Critique', schema: CRITIQUE_SCHEMA },
)
// A failed critique agent (null) means no gaps to act on — keep the plan.
const gaps = (critique && critique.gaps) || []
if (gaps.length) {
  const revised = await agent(
    [
      \`Revise this implementation plan to close the gaps below, for feature request: "\${request}"\`,
      '',
      \`Current plan: \${JSON.stringify(plan)}\`,
      '',
      \`Gaps to close: \${JSON.stringify(gaps)}\`,
      '',
      'Return the full updated plan in the same shape: summary, openQuestions, tasks (with subtasks, each keeping/assigning order per the same rules as before). Do not touch any code — this is planning only.',
    ].join('\\n'),
    { model: 'opus', phase: 'Plan', schema: PLAN_SCHEMA },
  )
  // A failed revision must not replace a working plan with null.
  if (revised) plan = revised
}

return { request, summary: plan.summary, openQuestions: plan.openQuestions, tasks: plan.tasks }
`,
};
