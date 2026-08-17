export const meta = {
  name: 'ship-plan-loop',
  description: 'Replan → re-review a Ship feature plan until it has no CRITICAL findings',
  phases: [
    { title: 'Plan review', detail: 'review the plan, revise it against CRITICAL findings, re-review' },
  ],
}

// args: { feature: string, answers?: string, roundOffset?: number, maxPlanRounds?: number }
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
// Coerce: the go skill hand-builds this args object from prose, so roundOffset
// can arrive as a string — `round + "3"` would render "### Round 13".
const roundOffset = Number(parsedArgs && parsedArgs.roundOffset) || 0

if (!feature) throw new Error('plan.workflow: args.feature is required')

// How many reviews a single plan may burn before we call it unresolved.
// The cap check fires before the replan, so round N ends on a review verdict:
// N reviews, at most N-1 replans. The value arrives pre-resolved from the go
// skill's profile resolution; absent (or zero/NaN) means today's 5.
const MAX_PLAN_ROUNDS = Number(parsedArgs && parsedArgs.maxPlanRounds) || 5

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

// Defensive: an agent can finish its work and still lose the result in transit
// (most often by ending its turn without calling StructuredOutput). Retry once,
// then degrade to null — every call site below handles null.
//
// `retry: false` opts out of the internal retry for call sites that run their
// own continuation loop; unused here, kept identical to go.workflow.js.
//
// `retryPrompt` makes the retry cheap instead of blind: a lost result is not
// proof the work never happened, so the retry reads the durable record the
// previous agent left behind (the reviewer's scratch file, the replanner's
// round subsection in PLAN.md) rather than redoing it.
const safeAgent = async (prompt, opts) => {
  const { retry = true, retryPrompt = null, ...baseOpts } = opts && typeof opts === 'object' ? opts : {}
  const label = typeof baseOpts.label === 'string' ? baseOpts.label : ''
  const labelDisplay = label || '<no-label>'
  try { return await agent(prompt, baseOpts) } catch (e) {
    if (!retry) {
      log(`${labelDisplay} threw (${e && e.message ? e.message : e}) — treating as no result`)
      return null
    }
    log(`${labelDisplay} threw (${e && e.message ? e.message : e}) — retrying once${retryPrompt ? ' (salvage)' : ''}`)
  }
  const retryOpts = { ...baseOpts, label: label ? `${label}:retry` : 'retry' }
  try { return await agent(retryPrompt || prompt, retryOpts) } catch (e) {
    log(`${labelDisplay} threw again (${e && e.message ? e.message : e}) — treating as no result`)
    return null
  }
}

const findingLine = (f, i) => `${i + 1}. [CRITICAL] Task ${f.task_id == null || f.task_id === '' ? '—' : f.task_id} / ${f.file} — ${f.description}`

// Each agent() call is a fresh agent — the re-reviewer has no memory of the
// prior review, so the findings must be embedded in the prompt.
const reviewPrompt = (round, priorCriticals) => {
  // The round number names the reviewer's scratch record, which a salvage
  // retry reads instead of re-running the whole review.
  const head = `Review the plan for feature: ${feature}
Review round: ${round} (scratch record: .planning/features/${feature}/.review-scratch/plan-round-${round}.json)

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

// Salvage retries. A plan review re-reads the plan against the whole codebase;
// a replan rewrites PLAN.md. Redoing either because a result was dropped in
// transit is pure waste, so the retry checks the durable record first.
//
// Staleness is keyed on the PLAN.md content hash rather than the round number:
// a replan always changes PLAN.md, so a scratch file from an earlier round (or
// from a previous /ship:plan-verify run) fingerprints differently. A record
// that matches the current plan byte-for-byte is a valid review of that plan
// no matter which run produced it.
const salvagePlanReviewPrompt = (round, fullPrompt) => `Salvage a lost plan review result for feature: ${feature}

A plan reviewer just completed this review, but its structured result was lost in transit. The work is very likely already done and recorded.

Read \`.planning/features/${feature}/.review-scratch/plan-round-${round}.json\` and run \`git hash-object .planning/features/${feature}/PLAN.md\`.

- **If the file exists and its \`plan_hash\` matches that hash:** it is a completed review of exactly the plan on disk right now. Report its findings verbatim as your result and stop. Do NOT re-read the plan, do NOT re-explore the codebase, do NOT revise the findings. An empty findings array is a valid result — report it as APPROVED.
- **If it is missing, empty, malformed, or its \`plan_hash\` differs:** it belongs to a different plan. Fall back to the full review below.

---

${fullPrompt}`

const salvageReplanPrompt = (round, fullPrompt) => `Salvage a lost replan result for feature: ${feature}

A replanner just revised this plan, but its structured result was lost in transit. PLAN.md was very likely already rewritten.

Read \`.planning/features/${feature}/PLAN.md\` and look under \`## Plan Review\` for a \`### Round ${round + roundOffset}\` subsection.

- **If that subsection exists and is complete:** the revision already landed. Report its recorded changes as your \`changes\`, set status \`REVISED\` with an empty \`needs_input\`, and stop. Do NOT revise the plan again — a second pass would double-apply edits that are already in the file.
- **If that subsection is absent or was left half-written:** the previous run died mid-revision. Read the plan carefully to see what (if anything) already changed, finish the revision below without duplicating work already applied, and record the round subsection.

Note: an escalation is not recoverable this way — if the previous run escalated instead of revising, there is no subsection, and re-deciding the escalation below is correct.

---

${fullPrompt}`

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
  const reviewFull = reviewPrompt(round, priorCriticals)
  const review = await safeAgent(reviewFull, {
    agentType: 'ship:ship-plan-reviewer', schema: PLAN_REVIEW_SCHEMA, phase: 'Plan review',
    label: `plan-review:r${round}`,
    retryPrompt: salvagePlanReviewPrompt(round, reviewFull),
  })

  if (!review) {
    return {
      feature, status: 'BLOCKED', rounds: round, findings: priorCriticals, history,
      reason: 'the plan reviewer returned no result after retry — a plan is never approved without a completed review',
      recommendation: `Run /ship:plan-verify ${feature} to review the plan once manually.`,
    }
  }

  // `findings` is schema-required, but a flaked StructuredOutput wrapper has
  // dropped required fields before. A result without it is an incomplete
  // review, not a clean one — block rather than throw a TypeError out of the
  // workflow, and never let it fall through to APPROVED.
  if (!Array.isArray(review.findings)) {
    return {
      feature, status: 'BLOCKED', rounds: round, findings: priorCriticals, history,
      reason: 'the plan reviewer returned a result with no findings array — an incomplete review is never an approval',
      recommendation: `Run /ship:plan-verify ${feature} to review the plan once manually.`,
    }
  }

  const reviewFindings = review.findings
  const criticals = reviewFindings.filter((f) => f.severity === 'CRITICAL')
  history.push({ round, reviewStatus: review.status, criticals: criticals.length, findings: reviewFindings })

  // Trust the findings over the verdict in both directions: zero CRITICALs
  // approves even if status says NEEDS-REVISION, and a non-empty CRITICAL list
  // never approves.
  if (criticals.length === 0) {
    return {
      feature, status: 'APPROVED', rounds: round,
      findings: reviewFindings.filter((f) => f.severity !== 'CRITICAL'),
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

  const replanFull = replanPrompt(round, criticals, answers)
  const replan = await safeAgent(replanFull, {
    agentType: 'ship:ship-replanner', schema: REPLAN_SCHEMA, phase: 'Plan review',
    label: `replan:r${round}`,
    retryPrompt: salvageReplanPrompt(round, replanFull),
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
