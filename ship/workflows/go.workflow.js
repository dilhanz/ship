export const meta = {
  name: 'ship-go',
  description: 'Build (per-phase, with review) then verify a planned Ship feature — agent output stays out of the main context',
  phases: [
    { title: 'Build', detail: 'execute each phase: builder → reviewer (re-verify + diff review) → one fix round' },
    { title: 'Verify', detail: 'acceptance criteria + adversarial bug hunt → VERIFY.md' },
  ],
}

// args: { feature: string, phases: [{ id, name }], keyFileContext?: string }
// `phases` is the list of pending phases the go skill extracted from PLAN.md, in order.
// A flat (unphased) plan is passed as a single pseudo-phase { id: 'all', name: 'all' }.
//
// Defensive: the Workflow runtime may deliver `args` as a JSON-encoded string
// (sometimes double-encoded) instead of the parsed object the docs promise.
// Unwrap up to a couple of layers of string-encoding before reading fields.
let parsedArgs = args
for (let i = 0; i < 3 && typeof parsedArgs === 'string'; i++) {
  try { parsedArgs = JSON.parse(parsedArgs) } catch { break }
}

const feature = parsedArgs && parsedArgs.feature
const phases = (parsedArgs && parsedArgs.phases) || []
const keyFileContext = (parsedArgs && parsedArgs.keyFileContext) || 'No key file context provided.'

if (!feature) throw new Error('go.workflow: args.feature is required')

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'tasks_completed', 'tasks_total', 'commits'],
  properties: {
    feature: { type: 'string' },
    scope: { type: 'string' },
    status: { enum: ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'CHECKPOINT'] },
    tasks_completed: { type: 'number' },
    tasks_total: { type: 'number' },
    commits: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    missing: { type: ['string', 'null'] },
    stopped_at: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    recommendation: { type: ['string', 'null'] },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'findings'],
  properties: {
    feature: { type: 'string' },
    scope: { type: 'string' },
    status: { enum: ['APPROVED', 'NEEDS_FIXES'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'description'],
        properties: {
          id: { type: 'number' },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          description: { type: 'string' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'criteria_total', 'criteria_passed'],
  properties: {
    feature: { type: 'string' },
    status: { enum: ['PASS', 'FAIL', 'INCONCLUSIVE'] },
    criteria_passed: { type: 'number' },
    criteria_failed: { type: 'number' },
    criteria_inconclusive: { type: 'number' },
    criteria_total: { type: 'number' },
    tests_written: { type: 'number' },
    tests_passed: { type: 'number' },
    tests_failed: { type: 'number' },
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          description: { type: 'string' },
          file: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    anti_patterns: { type: 'number' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const phaseLine = (ph) => (ph.id === 'all' ? '' : `Phase: ${ph.id} — ${ph.name}\n`)

const buildPrompt = (ph) => `Build feature: ${feature}
${phaseLine(ph)}
## Key File Context (from Explore digest)

${keyFileContext}

Execute all pending tasks ${ph.id === 'all' ? 'in the plan' : 'in this phase'}. Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md, then follow your execution loop, deviation rules, and commit conventions.`

const reviewPrompt = (ph, commits) => `Review feature: ${feature}
${phaseLine(ph)}Phase commits: ${commits.length ? commits.join(', ') : '(none reported)'}

Determine the diff range from the first phase commit (\`<first-commit>~1..HEAD\`; if no commits were reported, review the working tree against the merge-base). Re-run each task's verify command (trust-but-verify), then review the phase diff. Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md.`

const fixPrompt = (ph, findings) => `Fix review findings for feature: ${feature}
${phaseLine(ph)}
The phase reviewer found critical/high issues. Fix ONLY these — do not refactor beyond them:

${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.description}${f.recommendation ? ` (fix: ${f.recommendation})` : ''}`).join('\n')}

For each fix: implement it, re-run the affected task's verify command, and commit with "fix(${feature}): {short description}". Emit an updated build_result.`

phase('Build')
const completed = []
let stoppedAt = null

for (let i = 0; i < phases.length; i++) {
  const ph = phases[i]
  const label = ph.id === 'all' ? 'all' : ph.id

  const build = await agent(buildPrompt(ph), {
    agentType: 'ship:ship-builder', schema: BUILD_SCHEMA, label: `build:${label}`, phase: 'Build',
  })

  if (!build || build.status === 'NEEDS_CONTEXT' || build.status === 'CHECKPOINT') {
    stoppedAt = { phase: ph, build: build || { status: 'NO_RESULT' } }
    log(`Build stopped at phase ${label}: ${build ? build.status : 'no result'} — surfacing to the user.`)
    break
  }

  const review = await agent(reviewPrompt(ph, build.commits || []), {
    agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `review:${label}`, phase: 'Build',
  })

  let fixRound = null
  let rereview = null
  const blocking = review && review.status === 'NEEDS_FIXES'
    ? review.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
    : []

  if (blocking.length) {
    fixRound = await agent(fixPrompt(ph, blocking), {
      agentType: 'ship:ship-builder', schema: BUILD_SCHEMA, label: `fix:${label}`, phase: 'Build',
    })
    rereview = await agent(
      `Re-review feature: ${feature}\n${phaseLine(ph)}The builder applied fixes for your critical/high findings. Re-run the affected verify commands and re-review ONLY whether each critical/high finding is now resolved. Emit an updated review_result.`,
      { agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `rereview:${label}`, phase: 'Build' },
    )
  }

  const unresolved = rereview && rereview.status === 'NEEDS_FIXES'
    ? rereview.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
    : []

  completed.push({
    phaseId: ph.id, phaseName: ph.name,
    tasksCompleted: build.tasks_completed, tasksTotal: build.tasks_total,
    commits: build.commits || [], concerns: build.concerns || [],
    reviewStatus: review ? review.status : 'SKIPPED',
    findings: review ? review.findings : [],
    fixApplied: !!fixRound, unresolved,
  })
}

let verdict = null
if (!stoppedAt) {
  phase('Verify')
  verdict = await agent(
    `Verify feature: ${feature}\n\nRead .planning/features/${feature}/CONTEXT.md and PLAN.md, then verify acceptance criteria, hunt bugs with adversarial tests, scan for anti-patterns, and write VERIFY.md per your instructions.`,
    { agentType: 'ship:ship-verifier', schema: VERIFY_SCHEMA, label: 'verify', phase: 'Verify' },
  )
}

return { feature, stoppedAt, completed, verdict }
