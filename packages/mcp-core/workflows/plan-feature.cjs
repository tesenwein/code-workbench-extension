"use strict";

module.exports = {
  name: "cw-plan-feature",
  script: `export const meta = {
  name: 'cw-plan-feature',
  description: 'Design a feature via a fleet of subagents and return a hierarchical implementation plan',
  phases: [
    { title: 'Context', detail: 'repo map, arch wiki cards, prior art', model: 'sonnet' },
    { title: 'Design', detail: 'three independent stances', model: 'sonnet' },
    { title: 'Judge', detail: 'three lenses score each design', model: 'haiku' },
    { title: 'Synthesize', detail: 'merge winner + best runner-up ideas', model: 'opus' },
    { title: 'Critique', detail: 'completeness critic, loop until dry', model: 'opus' },
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

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    keySteps: { type: 'array', items: { type: 'string' } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    tradeoffs: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach', 'keySteps', 'filesTouched', 'risks', 'tradeoffs'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['score', 'reason'],
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

const STANCES = [
  {
    key: 'mvp-first',
    label: 'MVP-first',
    angle: 'Optimize for the smallest change that delivers real value. Prefer reusing existing patterns over new abstractions. Defer anything not needed for a working first version.',
  },
  {
    key: 'risk-first',
    label: 'risk-first',
    angle: 'Optimize for identifying and de-risking the hardest or most uncertain part of this feature first. Call out what could break, what is hard to reverse, and sequence steps to surface risk early.',
  },
  {
    key: 'architecture-first',
    label: 'architecture-first',
    angle: 'Optimize for long-term fit with the existing architecture. Favor consistency with established patterns and conventions over speed. Call out where this feature should mirror an existing component.',
  },
]

const JUDGE_LENSES = [
  { key: 'architecture-fit', prompt: 'Judge how well this design fits the existing architecture and conventions (from the context brief below) rather than fighting them.' },
  { key: 'risk-complexity', prompt: 'Judge this design on risk and complexity: is it as simple as it can be, are the risks called out and mitigated, is anything needlessly hard to reverse?' },
  { key: 'completeness', prompt: 'Judge how completely this design addresses the original feature request below — does it leave out anything the request clearly asked for?' },
]

async function judgeDesign(design, index) {
  const verdicts = await parallel(
    JUDGE_LENSES.map((lens, lensIndex) => () =>
      agent(
        [
          lens.prompt,
          '',
          \`Feature request: "\${request}"\`,
          '',
          \`Design under judgment: \${JSON.stringify(design)}\`,
          '',
          'Score 0-10 and give a one or two sentence reason.',
        ].join('\\n'),
        { label: \`judge:\${index}:\${lensIndex}\`, model: 'haiku', phase: 'Judge', schema: JUDGE_SCHEMA },
      ),
    ),
  )
  const total = verdicts.filter(Boolean).reduce((sum, v) => sum + (v.score || 0), 0)
  return { design, score: total, verdicts }
}

phase('Context')
const contextResults = await parallel(
  CONTEXT_TASKS.map(t => () => agent(t.prompt, { label: \`context:\${t.key}\`, model: 'sonnet', phase: 'Context', schema: CONTEXT_SCHEMA })),
)
const contextBrief = contextResults
  .filter(Boolean)
  .map(c => [c.summary, ...(c.facts || []).map(f => \`- \${f}\`), ...(c.files || []).map(f => \`file: \${f}\`)].join('\\n'))
  .join('\\n\\n')

phase('Design')
const judged = await pipeline(
  STANCES,
  stance =>
    agent(
      [
        \`Design an approach for this feature request, from a \${stance.label} stance: \${stance.angle}\`,
        '',
        \`Feature request: "\${request}"\`,
        '',
        'Context gathered about this repository:',
        contextBrief,
        '',
        'Return approach (prose), keySteps, filesTouched (existing or new files this design would touch), risks, and tradeoffs. Do not touch any code — this is design only.',
      ].join('\\n'),
      { label: \`design:\${stance.key}\`, model: 'sonnet', phase: 'Design', schema: DESIGN_SCHEMA },
    ),
  (design, stance, index) => (design ? judgeDesign({ ...design, stance: stance.key }, index) : null),
)

const ranked = judged.filter(Boolean).sort((a, b) => b.score - a.score)
if (!ranked.length) {
  throw new Error('No design survived judging')
}
const winner = ranked[0]
const runnersUp = ranked.slice(1)

phase('Synthesize')
let plan = await agent(
  [
    \`Synthesize a final implementation plan for this feature request: "\${request}"\`,
    '',
    \`Winning design (stance: \${winner.design.stance}, score \${winner.score}): \${JSON.stringify(winner.design)}\`,
    '',
    'Runner-up designs — graft in any good ideas they have that the winner lacks:',
    JSON.stringify(runnersUp.map(r => r.design)),
    '',
    'Context gathered about this repository:',
    contextBrief,
    '',
    "Return summary (what will be built and why), openQuestions (anything that needs a human decision before implementation), and tasks: a hierarchical breakdown where each task has title, description, priority, and subtasks (each with title, description, order). Assign each subtask an 'order' (0, 1, 2, ...) reflecting the sequence it must be implemented in — lower runs first. Do not touch any code — this is planning only.",
  ].join('\\n'),
  { model: 'opus', phase: 'Synthesize', schema: PLAN_SCHEMA },
)
if (!plan) {
  throw new Error('Synthesize agent failed to produce a plan')
}

phase('Critique')
const seenGaps = new Set()
for (let round = 0; round < 2; round++) {
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
  const fresh = (critique?.gaps || []).filter(g => !seenGaps.has(g.gap.toLowerCase()))
  if (!fresh.length) break
  fresh.forEach(g => seenGaps.add(g.gap.toLowerCase()))

  const revised = await agent(
    [
      \`Re-synthesize this implementation plan to close the gaps below, for feature request: "\${request}"\`,
      '',
      \`Current plan: \${JSON.stringify(plan)}\`,
      '',
      \`Gaps to close: \${JSON.stringify(fresh)}\`,
      '',
      'Return the full updated plan in the same shape: summary, openQuestions, tasks (with subtasks, each keeping/assigning order per the same rules as before). Do not touch any code — this is planning only.',
    ].join('\\n'),
    { model: 'opus', phase: 'Synthesize', schema: PLAN_SCHEMA },
  )
  // A failed re-synthesis must not replace a working plan with null.
  if (revised) plan = revised
}

return { request, summary: plan.summary, openQuestions: plan.openQuestions, tasks: plan.tasks }
`,
};
