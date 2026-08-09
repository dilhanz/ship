export const meta = {
  name: 'ship-plan-loop',
  description: 'Replan → re-review a Ship feature plan until it has no CRITICAL findings',
  phases: [
    { title: 'Plan review', detail: 'review the plan, revise it against CRITICAL findings, re-review' },
  ],
}

// args: { feature: string, answers?: string, roundOffset?: number }
// `answers` carries a user Q/A transcript back into the loop after a NEEDS_INPUT
// escalation. `roundOffset` shifts only the `### Round {n}` history label the
// replanner writes into PLAN.md, so a re-invocation (which restarts the internal
// loop at round 1) does not collide with the previous run's subsections.
//
// Defensive: the Workflow runtime may deliver `args` as a JSON-encoded string
// (sometimes double-encoded) instead of the parsed object the docs promise.
// Unwrap up to a couple of layers of string-encoding before reading fields.
let parsedArgs = args
for (let i = 0; i < 3 && typeof parsedArgs === 'string'; i++) {
  try { parsedArgs = JSON.parse(parsedArgs) } catch { break }
}

const feature = parsedArgs && parsedArgs.feature
const answers = (parsedArgs && parsedArgs.answers) || ''
const roundOffset = (parsedArgs && parsedArgs.roundOffset) || 0

if (!feature) throw new Error('plan.workflow: args.feature is required')

// How many reviews a single plan may burn before we call it unresolved.
// The cap check fires before the replan, so round 5 ends on a review verdict:
// 5 reviews, at most 4 replans.
const MAX_PLAN_ROUNDS = 5

const PLAN_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'findings'],
  properties: {
    feature: { type: 'string' },
    status: { enum: ['APPROVED', 'NEEDS-REVISION'] },
    examined: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'description'],
        properties: {
          severity: { enum: ['CRITICAL', 'WARNING', 'SUGGESTION'] },
          task_id: { type: ['string', 'null'] },
          file: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

// `options` bounds are load-bearing, not cosmetic: the go skill feeds each
// needs_input entry straight into AskUserQuestion, which requires 2-4 options.
// Enforcing it here means safeAgent retries a malformed escalation instead of
// the go skill improvising one at the single moment the user is interrupted.
const REPLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'changes', 'needs_input'],
  properties: {
    feature: { type: 'string' },
    status: { enum: ['REVISED', 'NEEDS_INPUT'] },
    changes: { type: 'array', items: { type: 'string' } },
    addressed: { type: 'array', items: { type: 'string' } },
    needs_input: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options', 'why_blocking'],
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
          why_blocking: { type: 'string' },
        },
      },
    },
    notes: { type: ['string', 'null'] },
  },
}

// Defensive: the harness's final-JSON schema wrapper (StructuredOutput) has
// flaked and thrown even when the agent's underlying work was already done.
// Retry once, then degrade to null — every call site below handles null.
//
// `retry: false` opts out of the internal retry for call sites that run their
// own continuation loop; unused here, kept identical to go.workflow.js.
const safeAgent = async (prompt, opts) => {
  const { retry = true, ...baseOpts } = opts && typeof opts === 'object' ? opts : {}
  const label = typeof baseOpts.label === 'string' ? baseOpts.label : ''
  const labelDisplay = label || '<no-label>'
  try { return await agent(prompt, baseOpts) } catch (e) {
    if (!retry) {
      log(`${labelDisplay} threw (${e && e.message ? e.message : e}) — treating as no result`)
      return null
    }
    log(`${labelDisplay} threw (${e && e.message ? e.message : e}) — retrying once`)
  }
  const retryOpts = { ...baseOpts, label: label ? `${label}:retry` : 'retry' }
  try { return await agent(prompt, retryOpts) } catch (e) {
    log(`${labelDisplay} threw again (${e && e.message ? e.message : e}) — treating as no result`)
    return null
  }
}

const findingLine = (f, i) => `${i + 1}. [CRITICAL] Task ${f.task_id == null || f.task_id === '' ? '—' : f.task_id} / ${f.file} — ${f.description}`

// Each agent() call is a fresh agent — the re-reviewer has no memory of the
// prior review, so the findings must be embedded in the prompt.
const reviewPrompt = (round, priorCriticals) => {
  const head = `Review the plan for feature: ${feature}

Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md, then review the plan against the codebase following your review contract.`

  if (round === 1 || !priorCriticals.length) return head

  return `${head}

A previous review raised the CRITICAL findings below, and a replanner has since revised PLAN.md:

${priorCriticals.map(findingLine).join('\n')}

You have no memory of that review — verify each one from the plan and the code. Report:
(a) whether each listed finding is now resolved, and
(b) new findings ONLY when they would actually break the build. Do not re-litigate the plan from scratch.

Disproved-finding rule: a replanner may resolve a finding by disproving it and recording the evidence under PLAN.md's \`## Plan Review\` section rather than by changing the plan. Treat such a finding as RESOLVED unless you can rebut that specific recorded evidence — and if you do re-raise it, cite the rebuttal.`
}

const replanPrompt = (round, criticals, userAnswers) => `Revise the plan for feature: ${feature}

The plan review raised these CRITICAL findings:

${criticals.map((f, i) => `${i + 1}. [${f.severity}] Task ${f.task_id == null || f.task_id === '' ? '—' : f.task_id} / ${f.file} — ${f.description}${f.recommendation ? ` (fix: ${f.recommendation})` : ''}`).join('\n')}
${userAnswers ? `
## Answers from the user

${userAnswers}

Treat these answers as settled. Do not re-ask them.
` : ''}
Record this revision under PLAN.md's \`## Plan Review\` section as \`### Round ${round + roundOffset}\`, appending it — never rewrite or delete an earlier round's subsection.

PLAN.md is your only writable artifact: never modify CONTEXT.md. A CRITICAL finding that is really a requirements gap is not yours to fix — escalate it via \`needs_input\`. Disproving a finding is a valid resolution when you record the evidence in the round subsection.`

// Convergence key: task id + file, normalized. Description is deliberately
// excluded — a reworded description for the same task and file is the same
// unresolved problem, and including it would let a paraphrase masquerade as
// progress. A genuinely new problem surfaces at a different task or file.
const findingKey = (f) => `${(f.task_id == null ? '' : String(f.task_id)).trim().toLowerCase()}||${String(f.file || '').trim().toLowerCase()}`

const sameCriticalSet = (a, b) => {
  if (!a.length || !b.length) return false
  const left = new Set(a.map(findingKey))
  const right = new Set(b.map(findingKey))
  if (left.size !== right.size) return false
  for (const key of left) if (!right.has(key)) return false
  return true
}

let priorCriticals = []
const history = []

phase('Plan review')

for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
  const review = await safeAgent(reviewPrompt(round, priorCriticals), {
    agentType: 'ship:ship-plan-reviewer', schema: PLAN_REVIEW_SCHEMA, phase: 'Plan review',
    label: `plan-review:r${round}`,
  })

  if (!review) {
    return {
      feature, status: 'BLOCKED', rounds: round, findings: priorCriticals, history,
      reason: 'the plan reviewer returned no result after retry — a plan is never approved without a completed review',
      recommendation: `Run /ship:plan-verify ${feature} to review the plan once manually.`,
    }
  }

  const criticals = review.findings.filter((f) => f.severity === 'CRITICAL')
  history.push({ round, reviewStatus: review.status, criticals: criticals.length, findings: review.findings })

  // Trust the findings over the verdict in both directions: zero CRITICALs
  // approves even if status says NEEDS-REVISION, and a non-empty CRITICAL list
  // never approves.
  if (criticals.length === 0) {
    return {
      feature, status: 'APPROVED', rounds: round,
      findings: review.findings.filter((f) => f.severity !== 'CRITICAL'),
      examined: review.examined || [],
      history,
    }
  }

  if (priorCriticals.length && sameCriticalSet(criticals, priorCriticals)) {
    log(`plan loop converged at round ${round} — the same ${criticals.length} CRITICAL finding(s) survived a replan`)
    return {
      feature, status: 'STUCK', rounds: round, findings: criticals, history,
      reason: `the same CRITICAL finding(s) recurred after a replan — the replanner cannot resolve them`,
      recommendation: `Run /ship:plan ${feature} to rework the plan by hand.`,
    }
  }

  if (round === MAX_PLAN_ROUNDS) {
    return {
      feature, status: 'UNRESOLVED', rounds: round, findings: criticals, history,
      reason: `${MAX_PLAN_ROUNDS} review round(s) spent with CRITICAL findings still open`,
      recommendation: `Run /ship:plan ${feature} to rework the plan by hand, then /ship:plan-verify ${feature}.`,
    }
  }

  const replan = await safeAgent(replanPrompt(round, criticals, answers), {
    agentType: 'ship:ship-replanner', schema: REPLAN_SCHEMA, phase: 'Plan review',
    label: `replan:r${round}`,
  })

  if (!replan) {
    return {
      feature, status: 'BLOCKED', rounds: round, findings: criticals, history,
      reason: 'the replanner returned no result after retry — the plan still carries CRITICAL findings',
      recommendation: `Run /ship:plan ${feature} to revise the plan by hand.`,
    }
  }

  if (replan.needs_input && replan.needs_input.length) {
    return {
      feature, status: 'NEEDS_INPUT', rounds: round, questions: replan.needs_input,
      findings: criticals, changes: replan.changes || [], history,
    }
  }

  priorCriticals = criticals
}
