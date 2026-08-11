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

// How many builder agents a single phase may burn before we call it stuck.
// Large tasks routinely exhaust one builder's turn budget after 2-3 tasks; the
// work is committed and PLAN.md records it, so a fresh builder resumes cleanly.
const MAX_BUILD_ROUNDS = 5

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'tasks_completed', 'tasks_total', 'commits'],
  properties: {
    feature: { type: 'string' },
    scope: { type: 'string' },
    status: { enum: ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'PARTIAL', 'NEEDS_CONTEXT', 'CHECKPOINT'] },
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

// Read-only probe used when a builder returns nothing at all: PLAN.md task
// status is the ground truth for what actually landed.
const PROGRESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks_done', 'tasks_pending', 'tasks_total'],
  properties: {
    tasks_done: { type: 'number' },
    tasks_pending: { type: 'number' },
    tasks_total: { type: 'number' },
    commits: { type: 'array', items: { type: 'string' } },
    working_tree_clean: { type: 'boolean' },
    notes: { type: ['string', 'null'] },
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
    criteria_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'verdict'],
        properties: {
          criterion: { type: 'string' },
          verdict: { enum: ['PASS', 'FAIL', 'INCONCLUSIVE'] },
          evidence: { type: 'string' },
        },
      },
    },
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

// Defensive: the harness's final-JSON schema wrapper (StructuredOutput) has
// flaked and thrown even when the agent's underlying work was already
// committed and green. Retry once, then degrade to null — every call site
// below already handles a null result gracefully. Retrying an agent is safe:
// PLAN.md tracks task status and commits are atomic, so a retried builder
// sees done tasks and returns quickly.
//
// `retry: false` opts out of the internal retry for call sites that run their
// own continuation loop (the builder), so a dead agent costs one attempt there
// instead of two.
//
// `retryPrompt` makes the retry cheap instead of blind. A lost result does not
// mean the work did not happen — the reviewer has already written its findings
// to a scratch file and the verifier has already written VERIFY.md. Pointing
// the retry at that durable record turns a ~90k-token redo into a few-thousand
// token read. Falls back to the original prompt when no salvage path exists.
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

const buildPrompt = (ph) => `Build feature: ${feature}
${phaseLine(ph)}
## Key File Context (from Explore digest)

${keyFileContext}

Execute all pending tasks ${ph.id === 'all' ? 'in the plan' : 'in this phase'}. Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md, then follow your execution loop, deviation rules, and commit conventions.`

const continuePrompt = (ph, state) => `Continue building feature: ${feature}
${phaseLine(ph)}
A previous builder ran out of turn budget before finishing this phase. You are a fresh agent with no memory of that run — PLAN.md is the source of truth for what already landed.

${state}

## Key File Context (from Explore digest)

${keyFileContext}

Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md. Skip every task already marked status="done" and resume from the first pending task ${ph.id === 'all' ? 'in the plan' : 'in this phase'}. If the working tree carries uncommitted changes from the interrupted task, finish that task, run its verify command, and commit it before moving on. Then follow your normal execution loop, deviation rules, and commit conventions.`

const progressPrompt = (ph) => `Report build progress for feature: ${feature}
${phaseLine(ph)}
READ-ONLY — do not edit, write, or commit anything. Read and report only.

Read .planning/features/${feature}/PLAN.md and count the tasks ${ph.id === 'all' ? 'in the plan' : `inside <phase id="${ph.id}">`}:
- tasks_done — tasks with status="done"
- tasks_pending — tasks in scope not marked done
- tasks_total — all tasks in scope
- commits — short hashes recorded on done tasks in scope (the commit="..." attribute), oldest first
- working_tree_clean — true when \`git status --porcelain\` prints nothing
- notes — anything odd (uncommitted work, a done task with no commit), else null`

// The builder reports its commits oldest-first (one atomic commit per task, in
// task order), so the range is computable here. Handing the reviewer a finished
// range saves it the turns it used to spend re-deriving one with `git log`.
const diffRange = (commits) => (commits.length ? `${commits[0]}~1..HEAD` : null)

const rangeInstruction = (range) => range
  ? `Diff range: \`${range}\` — already derived from the phase commits (oldest first). Use it directly with \`git diff ${range}\`; do not spend turns re-deriving it.

Only if that range is unusable — \`git diff --stat ${range}\` errors or comes back empty, or \`${range.split('~')[0]}\` is the repository's root commit so \`~1\` does not resolve — fall back: \`git log --oneline -20\` to locate the true range, or \`git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD\` (the empty tree) when the phase starts at the root commit.`
  : 'No commits were reported for this phase — review the uncommitted working-tree changes via `git diff HEAD`.'

const reviewPrompt = (ph, commits) => `Review feature: ${feature}
${phaseLine(ph)}Phase commits: ${commits.length ? commits.join(', ') : '(none reported)'}

${rangeInstruction(diffRange(commits))}

Re-run each task's verify command (trust-but-verify), then review the phase diff. Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md.`

const fixPrompt = (ph, findings) => `Fix review findings for feature: ${feature}
${phaseLine(ph)}
The phase reviewer found critical/high issues. Fix ONLY these — do not refactor beyond them:

${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.description}${f.recommendation ? ` (fix: ${f.recommendation})` : ''}`).join('\n')}

For each fix: implement it, re-run the affected task's verify command, and commit with "fix(${feature}): {short description}". Emit an updated build_result.`

// Each agent() call is a fresh agent — the re-reviewer has no memory of the
// original review, so the findings must be embedded in the prompt.
const rereviewPrompt = (ph, findings, fixCommits) => `Re-review feature: ${feature}
${phaseLine(ph)}A previous review found these critical/high issues, and a builder has applied fixes${fixCommits.length ? ` (fix commits: ${fixCommits.join(', ')})` : ''}:

${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.description}`).join('\n')}

${rangeInstruction(diffRange(fixCommits))}

You have no memory of that review — verify from the code. Re-run the affected verify commands and review ONLY whether each finding above is now resolved. Report any still-unresolved findings in your review_result.`

// Salvage retry: a lost structured result is a transport failure, not proof the
// review never happened. The previous reviewer wrote its findings to a scratch
// file before returning, so the retry reads that instead of re-running every
// verify command and re-reading the diff. Falls through to a full review only
// when the scratch file is genuinely absent.
const salvageReviewPrompt = (ph, scope, fullPrompt) => `Salvage a lost review result for feature: ${feature}
${phaseLine(ph)}
A reviewer just completed this exact review, but its structured result was lost in transit. The work is very likely already done and recorded.

Read \`.planning/features/${feature}/.review-scratch/${scope}.json\`.

- **If it exists, its \`scope\` is \`${scope}\`, and its \`head\` matches \`git rev-parse HEAD\`:** report those findings verbatim as your result and stop. Do NOT re-run verify commands, do NOT re-read the diff, do NOT revise the findings. An empty findings array is a valid result — report it as APPROVED.
- **If it is missing, empty, malformed, or stamped with a different scope or head:** it is not this review. Fall back to the full review below.

---

${fullPrompt}`

// Same principle for the verifier, which writes VERIFY.md before it returns.
//
// Staleness is keyed on the `**Head:**` stamp the verifier writes into the
// report. A FAIL verdict sends the feature back for a fix round, so a complete
// VERIFY.md from the previous round is exactly what a re-verification finds on
// disk — the date alone cannot separate the two. No stamp means the report
// predates the rule, and an unverifiable record is not salvageable.
const salvageVerifyPrompt = (fullPrompt) => `Salvage a lost verification result for feature: ${feature}

A verifier just completed this exact verification, but its structured result was lost in transit. VERIFY.md is very likely already written.

Read \`.planning/features/${feature}/VERIFY.md\` and run \`git rev-parse HEAD\`.

- **If it exists, is complete (all stages filled, no placeholders), and its \`**Head:**\` line matches that SHA:** report its verdict, counts, criteria verdicts, bugs, and gaps as your result and stop. Do NOT re-run criteria, re-hunt bugs, or rewrite the file.
- **If it is missing, partial, stamped with a different head, or carries no \`**Head:**\` line at all:** it is not this verification. Fall back to the full verification below.

---

${fullPrompt}`

const uniq = (list) => Array.from(new Set(list.filter((c) => typeof c === 'string' && c)))

// Build one phase, spanning as many builder agents as it takes.
//
// A builder that runs out of turns is the common case on large tasks, not an
// error: its finished tasks are committed and marked done in PLAN.md, so a
// fresh builder picks up at the first pending task. Two shapes signal it —
// an explicit PARTIAL result, or no structured result at all (the agent died
// mid-turn). Both continue; we only stop when a whole round lands nothing,
// which is the real "stuck" signal.
const buildPhase = async (ph, label) => {
  const priorCommits = []
  let priorTasks = 0
  let lastDone = null // absolute done-count from the last probe, when we have one
  let lastTotal = 0

  for (let round = 1; round <= MAX_BUILD_ROUNDS; round++) {
    const suffix = round === 1 ? '' : `:cont${round - 1}`
    const state = lastDone === null
      ? `Committed so far this phase: ${priorCommits.length ? priorCommits.join(', ') : '(none reported)'}.`
      : `PLAN.md showed ${lastDone} of ${lastTotal} task(s) done in this scope when the previous builder stopped.`

    const build = await safeAgent(round === 1 ? buildPrompt(ph) : continuePrompt(ph, state), {
      agentType: 'ship:ship-builder', schema: BUILD_SCHEMA, phase: 'Build', retry: false,
      label: `build:${label}${suffix}`,
    })

    if (build && build.status !== 'PARTIAL') {
      // Terminal result. Fold in the earlier rounds so the reviewer's diff
      // range covers the whole phase, not just this builder's slice.
      const done = priorTasks + (build.tasks_completed || 0)
      return {
        ...build,
        commits: uniq([...priorCommits, ...(build.commits || [])]),
        tasks_completed: build.tasks_total ? Math.min(done, build.tasks_total) : done,
        rounds: round,
      }
    }

    let landed
    if (build) {
      landed = (build.commits || []).length > 0 || (build.tasks_completed || 0) > 0
      priorCommits.push(...(build.commits || []))
      priorTasks += build.tasks_completed || 0
      lastTotal = build.tasks_total || lastTotal
      log(`build:${label} round ${round} returned PARTIAL — ${build.tasks_completed || 0} task(s) landed, continuing with a fresh builder`)
    } else {
      // No result at all — ask PLAN.md what actually landed before deciding.
      const progress = await safeAgent(progressPrompt(ph), {
        agentType: 'Explore', schema: PROGRESS_SCHEMA, phase: 'Build', effort: 'low',
        label: `progress:${label}${suffix}`,
      })
      if (!progress) {
        // Blind round: the builder and the probe both failed. One fresh builder
        // is cheap when nothing is pending (it returns COMPLETE immediately).
        landed = round < MAX_BUILD_ROUNDS
        log(`build:${label} round ${round} returned no result and the progress probe failed — ${landed ? 'retrying blind' : 'giving up'}`)
      } else {
        priorCommits.push(...(progress.commits || []))
        if (progress.tasks_pending === 0) {
          log(`build:${label} round ${round} returned no result, but PLAN.md shows every task done — treating the phase as complete`)
          return {
            feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
            status: 'COMPLETE_WITH_CONCERNS',
            tasks_completed: progress.tasks_done, tasks_total: progress.tasks_total,
            commits: uniq(priorCommits),
            concerns: [`phase ${label}: a builder exhausted its turn budget without reporting; completion confirmed from PLAN.md task status${progress.working_tree_clean === false ? ' (working tree not clean — check for uncommitted leftovers)' : ''}`],
            rounds: round,
          }
        }
        landed = lastDone === null || progress.tasks_done > lastDone
        lastDone = progress.tasks_done
        lastTotal = progress.tasks_total
        priorTasks = progress.tasks_done
        log(`build:${label} round ${round} returned no result — PLAN.md shows ${progress.tasks_done}/${progress.tasks_total} done, ${progress.tasks_pending} pending; ${landed ? 'continuing with a fresh builder' : 'no progress since the last round'}`)
      }
    }

    if (!landed) break
  }

  return {
    feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
    status: 'EXHAUSTED',
    tasks_completed: priorTasks, tasks_total: lastTotal,
    commits: uniq(priorCommits),
    stopped_at: `phase ${label}`,
    reason: `builders stopped making progress after ${MAX_BUILD_ROUNDS} round(s) — turn budget exhausted with tasks still pending`,
    recommendation: `Run /ship:build ${feature} to continue this phase interactively, or split its remaining tasks into smaller ones with /ship:plan ${feature}.`,
    rounds: MAX_BUILD_ROUNDS,
  }
}

phase('Build')
const completed = []
let stoppedAt = null

for (let i = 0; i < phases.length; i++) {
  const ph = phases[i]
  const label = ph.id === 'all' ? 'all' : ph.id

  const build = await buildPhase(ph, label)

  if (!build || build.status === 'EXHAUSTED' || build.status === 'NEEDS_CONTEXT' || build.status === 'CHECKPOINT') {
    stoppedAt = { phase: ph, build: build || { status: 'NO_RESULT' } }
    log(`Build stopped at phase ${label}: ${build ? build.status : 'no result'} — surfacing to the user.`)
    break
  }

  const reviewScope = ph.id === 'all' ? 'all' : `phase-${ph.id}`
  const reviewFull = reviewPrompt(ph, build.commits || [])
  const review = await safeAgent(reviewFull, {
    agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `review:${label}`, phase: 'Build',
    retryPrompt: salvageReviewPrompt(ph, reviewScope, reviewFull),
  })

  let fixRound = null
  let rereview = null
  // Trust the findings over the verdict: an APPROVED review that still lists
  // critical/high findings is contradictory and must not skip the fix round.
  const blocking = review
    ? review.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
    : []

  if (blocking.length) {
    fixRound = await safeAgent(fixPrompt(ph, blocking), {
      agentType: 'ship:ship-builder', schema: BUILD_SCHEMA, label: `fix:${label}`, phase: 'Build',
    })
    const rereviewFull = rereviewPrompt(ph, blocking, (fixRound && fixRound.commits) || [])
    rereview = await safeAgent(rereviewFull, {
      agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `rereview:${label}`, phase: 'Build',
      retryPrompt: salvageReviewPrompt(ph, `${reviewScope}-rereview`, rereviewFull),
    })
  }

  // If blocking findings existed but the re-review produced no result, we
  // could not confirm resolution — report them as unresolved rather than
  // silently claiming a clean phase.
  const unresolved = blocking.length && !rereview
    ? blocking
    : rereview
      ? rereview.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
      : []

  completed.push({
    phaseId: ph.id, phaseName: ph.name,
    tasksCompleted: build.tasks_completed, tasksTotal: build.tasks_total,
    // >1 means the phase outlived at least one builder's turn budget and was
    // finished by a fresh continuation builder.
    builderRounds: build.rounds || 1,
    commits: build.commits || [],
    // A dead reviewer must not read as a clean phase — surface it through the
    // concerns channel the go skill already reports to the user.
    concerns: review
      ? build.concerns || []
      : [...(build.concerns || []), `phase ${label} review never ran (no result after retry) — the diff went unreviewed`],
    reviewStatus: review ? review.status : 'SKIPPED',
    findings: review ? review.findings : [],
    fixApplied: !!fixRound, unresolved,
  })
}

let verdict = null
if (!stoppedAt) {
  phase('Verify')
  const verifyFull = `Verify feature: ${feature}\n\nRead .planning/features/${feature}/CONTEXT.md and PLAN.md, then verify acceptance criteria, hunt bugs with adversarial tests, scan for anti-patterns, and write VERIFY.md per your instructions.`
  verdict = await safeAgent(verifyFull, {
    agentType: 'ship:ship-verifier', schema: VERIFY_SCHEMA, label: 'verify', phase: 'Verify',
    retryPrompt: salvageVerifyPrompt(verifyFull),
  })
}

return { feature, stoppedAt, completed, verdict }
