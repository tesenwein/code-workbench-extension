"use strict";

module.exports = {
  name: "cw-code-review",
  script: `export const meta = {
  name: 'cw-code-review',
  description: 'Multi-dimension review of the current changes with adversarial verification',
  phases: [
    { title: 'Scope', detail: 'resolve base branch and enumerate the diff', model: 'sonnet' },
    { title: 'Review', detail: 'one finder per review dimension', model: 'sonnet' },
    { title: 'Verify', detail: 'three-lens adversarial refutation per finding' },
    { title: 'Checks', detail: 'run whatever lint/typecheck/test scripts exist', model: 'sonnet' },
  ],
}

const SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    baseBranch: { type: 'string' },
    empty: { type: 'boolean' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['baseBranch', 'empty', 'changedFiles', 'commits', 'summary'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          suggestedFix: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          rootCause: { type: 'string' },
        },
        required: ['file', 'line', 'summary', 'detail', 'priority'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const CHECKS_SCHEMA = {
  type: 'object',
  properties: {
    ran: { type: 'array', items: { type: 'string' } },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          check: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['check', 'summary'],
      },
    },
  },
  required: ['ran', 'failures'],
}

const DIMENSIONS = [
  {
    key: 'correctness',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for CORRECTNESS & LOGIC bugs: wrong conditionals, off-by-one errors, incorrect assumptions, broken control flow. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
  {
    key: 'lifecycle',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for ERROR HANDLING, CONCURRENCY & RESOURCE LIFECYCLE issues: missing error handling, races, deadlocks, leaked resources (handles, listeners, timers), unclosed connections. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
  {
    key: 'types',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for TYPE SAFETY & API CONTRACT issues: unsafe casts, any escapes, contract mismatches between callers and callees, incorrect generic usage. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
  {
    key: 'security',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for SECURITY & DATA HANDLING issues: injection, unsafe deserialization, secrets in code, missing auth checks, unsafe handling of user input. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
  {
    key: 'complexity',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for DEAD CODE, DUPLICATION & NEEDLESS COMPLEXITY: unreachable code, copy-pasted logic that should be shared, unnecessary abstractions, over-engineering. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
  {
    key: 'coverage',
    prompt: 'Review the current changes (uncommitted work plus commits on this branch not on the base branch) for TESTS & DOCS COVERAGE gaps: new behavior without tests, changed behavior with stale tests, missing or misleading documentation/comments. Read surrounding files for context — never judge a hunk in isolation. Resolve the base branch yourself (origin/HEAD, else develop, else main/master) and diff against it plus uncommitted changes.',
  },
]

function findingKey(f) {
  return \`\${f.file}:\${f.line}:\${f.summary}\`
}

async function verifyFinding(f, index) {
  const lenses = [
    \`Does this finding actually reproduce given the described file and line? Finding: \${JSON.stringify(f)}. Try to REFUTE it — if you cannot confirm the file/line/behavior described, default to refuted: true.\`,
    \`Is this finding even part of the current diff (not pre-existing, untouched code)? Finding: \${JSON.stringify(f)}. Try to REFUTE it — if you are unsure whether this is actually part of the changed hunk, default to refuted: true.\`,
    \`Is the reasoning behind this finding sound — is it really a bug/issue and not a stylistic false positive? Finding: \${JSON.stringify(f)}. Try to REFUTE it — if the reasoning seems weak or you are uncertain, default to refuted: true.\`,
  ]
  const verdicts = await parallel(
    lenses.map((lensPrompt, lensIndex) => () =>
      agent(lensPrompt, {
        label: \`verify:\${index}:\${lensIndex}\`,
        phase: 'Verify',
        schema: VERDICT_SCHEMA,
      }),
    ),
  )
  const refutedCount = verdicts.filter(Boolean).filter(v => v.refuted).length
  return refutedCount >= 2 ? null : f
}

phase('Scope')
const scopePromise = agent(
  [
    'Resolve the review scope for this repository. Do not review anything — only gather facts.',
    'Resolve the base branch: try origin/HEAD, then develop, then main or master.',
    'Run: git status --short; git diff; git diff --staged; git diff <base>...HEAD; git log --oneline <base>..HEAD.',
    'Return baseBranch, whether there is nothing to review (empty), the list of changed files, the list of commit summaries, and a short overall summary.',
  ].join('\\n'),
  { model: 'sonnet', effort: 'low', phase: 'Scope', schema: SCOPE_SCHEMA },
)

const checksPromiseFactory = () =>
  agent(
    [
      'Discover what project checks exist (package.json scripts, Makefile targets, CI config) and run whatever of lint, format check, typecheck, and test exists for the current changes. Skip silently whatever does not exist.',
      'Return the list of checks you actually ran, and for each failing check an entry with the check name and a summary of the failure.',
    ].join('\\n'),
    { model: 'sonnet', phase: 'Checks', schema: CHECKS_SCHEMA },
  )

const scope = await scopePromise
if (!scope) {
  throw new Error('Scope agent failed to resolve the review scope')
}
if (scope.empty) {
  return { baseBranch: scope.baseBranch, empty: true, findings: [], checks: null }
}

phase('Review')
const [dimensionResults, checks] = await parallel([
  () =>
    pipeline(
      DIMENSIONS,
      d => agent(d.prompt, { label: \`review:\${d.key}\`, phase: 'Review', model: 'sonnet', schema: FINDINGS_SCHEMA }),
      review => parallel((review.findings || []).map((f, i) => () => verifyFinding(f, \`\${review.findings.length}-\${i}\`))),
    ),
  checksPromiseFactory,
])

const survivors = dimensionResults.flat().filter(Boolean)
const seen = new Map()
for (const f of survivors) {
  const key = findingKey(f)
  if (!seen.has(key)) seen.set(key, f)
}
const priorityRank = { high: 0, medium: 1, low: 2 }
const findings = [...seen.values()].sort(
  (a, b) => (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3),
)

return { baseBranch: scope.baseBranch, empty: false, findings, checks }
`,
};
