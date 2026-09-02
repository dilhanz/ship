export const meta = {
  name: 'ship-plan-loop',
  description: 'Replan → re-review a Ship feature plan until it has no CRITICAL findings',
  phases: [
    { title: 'Plan review', detail: 'review the plan, revise it against CRITICAL findings, re-review' },
  ],
}

// args: { feature: string, answers?: string, findings?: object[], roundOffset?: number, maxPlanRounds?: number }
// `answers` carries a user Q/A transcript back into the loop after a NEEDS_INPUT
// escalation; `findings` are the CRITICALs that escalation carried (optional —
// the replanner reads them from PLAN.md when absent). `roundOffset` shifts only
// the `### Round {n}` history label the replanner writes into PLAN.md, so a
// re-invocation (which restarts the internal loop at round 1) does not collide
// with the previous run's subsections.
//
// Every result carries `nextRoundOffset` — the total number of `### Round n`
// labels consumed across all invocations so far, which the go skill threads
// back as the next `roundOffset`. Every BLOCKED result carries `blockedBy`
// ('reviewer' | 'replanner' | 'answers') so the go skill can route its fallback
// without parsing `reason`.
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
// The CRITICALs a NEEDS_INPUT escalation carried, handed back by the go skill
// so the apply-answers step knows what the answers settle. Optional: when
// absent the replanner reads the open findings from PLAN.md's `## Plan Review`.
const seedFindings = Array.isArray(parsedArgs && parsedArgs.findings) ? parsedArgs.findings : []
// Coerce: the go skill hand-builds this args object from prose, so roundOffset
// can arrive as a string — `round + "3"` would render "### Round 13".
const roundOffset = Number(parsedArgs && parsedArgs.roundOffset) || 0
// The `### Round n` label a replan writes. `labelShift` becomes 1 when an
// apply-answers step runs before the loop: it consumes a label but not a review
// round, so every later replan label (and replanner scratch name) moves by one.
let labelShift = 0
const labelRound = (round) => round + roundOffset + labelShift

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
// previous agent left behind (the reviewer's and the replanner's scratch
// records under .review-scratch/) rather than redoing it.
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
// The replanner's view of the same finding: severity as reported, plus the fix.
const replanFindingLine = (f, i) => `${i + 1}. [${f.severity || 'CRITICAL'}] Task ${f.task_id == null || f.task_id === '' ? '—' : f.task_id} / ${f.file} — ${f.description}${f.recommendation ? ` (fix: ${f.recommendation})` : ''}`

// Each agent() call is a fresh agent — the re-reviewer has no memory of the
// prior review, so the findings must be embedded in the prompt.
const reviewPrompt = (round, priorCriticals) => {
  // The round number names the reviewer's scratch record, which a salvage
  // retry reads instead of re-running the whole review.
  const head = `Review the plan for feature: ${feature}
Review round: ${round} (scratch record: .planning/features/${feature}/.review-scratch/plan-round-${round}.json)

Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md, then review the plan against the codebase following your review contract.`

  // After an apply-answers step the first review must check the ruling landed:
  // an approving review that never saw the answers is how one was dropped.
  if (round === 1 && answers) {
    return `${head}

The user answered these questions before this review, and a replanner applied them:

${answers}

Confirm the plan reflects each answer; an unapplied answer is a CRITICAL finding (file: PLAN.md).`
  }

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

${criticals.map(replanFindingLine).join('\n')}
${userAnswers ? `
## Answers from the user

${userAnswers}

Treat these answers as settled. Do not re-ask them.
` : ''}
Round label: \`### Round ${labelRound(round)}\`
Scratch record: .planning/features/${feature}/.review-scratch/replan-round-${labelRound(round)}.json — write it before your first edit and after every finding; a salvage retry reads it under exactly that name.

Record this revision under PLAN.md's \`## Plan Review\` section as \`### Round ${labelRound(round)}\`, appending it — never rewrite or delete an earlier round's subsection.

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

- **If the file exists and its \`plan_hash\` matches that hash:** it is a completed review of exactly the plan on disk right now. Report its findings verbatim as your result, then call StructuredOutput — that call is your final action. Do NOT re-read the plan, do NOT re-explore the codebase, do NOT revise the findings. An empty findings array is a valid result — report it as APPROVED.
- **If it is missing, empty, malformed, or its \`plan_hash\` differs:** it belongs to a different plan. Fall back to the full review below.

---

${fullPrompt}`

// Keyed on the `### Round n` label rather than the loop round so the
// apply-answers step (which has no loop round) can salvage the same way.
// Definition order matters: a prompt-slice test reads the body between this
// declaration and the delegating wrapper below, so keep them adjacent.
const salvageReplanPromptFor = (labelN, fullPrompt) => `Salvage a lost replan result for feature: ${feature}

A replanner just worked on this round, but its structured result was lost in transit — or it was cut off by its turn budget partway through. PLAN.md may already be partly or fully revised. The replanner writes a scratch record before its first edit and after every finding, so the record — not the \`### Round\` subsection, which is written last — tells you how much landed.

Read \`.planning/features/${feature}/.review-scratch/replan-round-${labelN}.json\` first.

- **If it exists, its \`round\` is ${labelN}, its \`findings\` match the CRITICAL findings listed below (by task id + file), and \`complete\` is \`true\`:** the revision already landed. Report its \`changes\` as your \`changes\` and its \`needs_input\` as yours — status \`REVISED\`, or \`NEEDS_INPUT\` if \`needs_input\` is non-empty — without touching PLAN.md, then call StructuredOutput — that call is your final action. Do NOT revise the plan again: a second pass would double-apply edits that are already in the file.
- **Same match, but \`complete\` is \`false\`:** the previous run died mid-revision. Resume from the first finding whose \`status\` is \`pending\`. Findings already marked \`revised\`, \`disproved\`, or \`escalated\` are done — never re-apply them, their edits or evidence are already in PLAN.md. Carry the record's \`changes\` and \`needs_input\` forward, keep rewriting the record as you go, and write the \`### Round ${labelN}\` subsection once every finding is resolved.
- **If it is missing, malformed, or carries a different round or different findings:** it is not this round's record. As a secondary signal, look under PLAN.md's \`## Plan Review\` for a \`### Round ${labelN}\` subsection — a complete one means the revision landed, so report its recorded changes rather than revising again. Otherwise fall back to the full replan below.

An escalation is salvaged the same way: a record whose findings are marked \`escalated\` (with matching \`needs_input\` entries) is reported as \`NEEDS_INPUT\` carrying those questions, not re-decided.

---

${fullPrompt}`

const salvageReplanPrompt = (round, fullPrompt) => salvageReplanPromptFor(labelRound(round), fullPrompt)

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

// Apply-answers step. A NEEDS_INPUT escalation means the replanner did not
// revise, so the user's ruling has never touched PLAN.md — and the loop's
// replanner only runs when a review raises CRITICALs, so an approving first
// review would drop the answer silently. Apply it before any review can.
// The step consumes a `### Round n` label but not a review round.
if (answers) {
  labelShift = 1
  const answersLabel = 1 + roundOffset
  const answersPrompt = `Apply the user's answers to the plan for feature: ${feature}

A previous replan escalated open CRITICAL findings to the user instead of resolving them. The user has answered; apply those answers to PLAN.md now, before any review runs.

## Answers from the user

${answers}

Treat these answers as settled. Do not re-ask them.

${seedFindings.length ? `The open CRITICAL findings the escalation carried:

${seedFindings.map(replanFindingLine).join('\n')}` : `No findings were passed in: read the open CRITICAL findings from the latest \`### Round n\` subsection (or the \`### Critical Issues\` list) under PLAN.md's \`## Plan Review\` section, and resolve them in light of the answers.`}

Round label: \`### Round ${answersLabel}\`
Scratch record: .planning/features/${feature}/.review-scratch/replan-round-${answersLabel}.json — write it before your first edit and after every finding; a salvage retry reads it under exactly that name.

Record this revision under PLAN.md's \`## Plan Review\` section as \`### Round ${answersLabel}\`, appending it — never rewrite or delete an earlier round's subsection.

PLAN.md is your only writable artifact: never modify CONTEXT.md. A finding the answers do not settle and that is really a requirements gap is not yours to fix — escalate it via \`needs_input\`. Disproving a finding is a valid resolution when you record the evidence in the round subsection.`

  const applied = await safeAgent(answersPrompt, {
    agentType: 'ship:ship-replanner', schema: REPLAN_SCHEMA, phase: 'Plan review',
    label: 'replan:answers',
    retryPrompt: salvageReplanPromptFor(answersLabel, answersPrompt),
  })

  if (!applied) {
    return {
      feature, status: 'BLOCKED', blockedBy: 'answers', rounds: 0, findings: seedFindings, history,
      nextRoundOffset: roundOffset + 1,
      reason: `the apply-answers replanner returned no result after retry — the user's answers may be partly applied; see .review-scratch/replan-round-${answersLabel}.json for what landed`,
      recommendation: `Re-run /ship:go ${feature} with the same answers — the retry salvages the record.`,
    }
  }

  if (applied.needs_input && applied.needs_input.length) {
    return {
      feature, status: 'NEEDS_INPUT', rounds: 0, questions: applied.needs_input,
      findings: seedFindings, changes: applied.changes || [], history,
      nextRoundOffset: roundOffset + 1,
    }
  }

  history.push({ round: 0, step: 'answers', reviewStatus: 'ANSWERS_APPLIED', criticals: 0, findings: [], changes: applied.changes || [] })
}

for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
  const reviewFull = reviewPrompt(round, priorCriticals)
  const review = await safeAgent(reviewFull, {
    agentType: 'ship:ship-plan-reviewer', schema: PLAN_REVIEW_SCHEMA, phase: 'Plan review',
    label: `plan-review:r${round}`,
    retryPrompt: salvagePlanReviewPrompt(round, reviewFull),
  })

  if (!review) {
    return {
      feature, status: 'BLOCKED', blockedBy: 'reviewer', rounds: round, findings: priorCriticals, history,
      nextRoundOffset: roundOffset + labelShift + round,
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
      feature, status: 'BLOCKED', blockedBy: 'reviewer', rounds: round, findings: priorCriticals, history,
      nextRoundOffset: roundOffset + labelShift + round,
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
      nextRoundOffset: roundOffset + labelShift + round,
    }
  }

  if (priorCriticals.length && sameCriticalSet(criticals, priorCriticals)) {
    log(`plan loop converged at round ${round} — the same ${criticals.length} CRITICAL finding(s) survived a replan`)
    return {
      feature, status: 'STUCK', rounds: round, findings: criticals, history,
      nextRoundOffset: roundOffset + labelShift + round,
      reason: `the same CRITICAL finding(s) recurred after a replan — the replanner cannot resolve them`,
      recommendation: `Run /ship:plan ${feature} to rework the plan by hand.`,
    }
  }

  if (round === MAX_PLAN_ROUNDS) {
    return {
      feature, status: 'UNRESOLVED', rounds: round, findings: criticals, history,
      nextRoundOffset: roundOffset + labelShift + round,
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
      feature, status: 'BLOCKED', blockedBy: 'replanner', rounds: round, findings: criticals, history,
      nextRoundOffset: roundOffset + labelShift + round,
      reason: `the replanner returned no result after retry — PLAN.md may already be partly or fully revised; see .review-scratch/replan-round-${labelRound(round)}.json for what landed`,
      recommendation: `Re-run /ship:go ${feature} — the retry salvages the record.`,
    }
  }

  if (replan.needs_input && replan.needs_input.length) {
    return {
      feature, status: 'NEEDS_INPUT', rounds: round, questions: replan.needs_input,
      findings: criticals, changes: replan.changes || [], history,
      nextRoundOffset: roundOffset + labelShift + round,
    }
  }

  priorCriticals = criticals
}
