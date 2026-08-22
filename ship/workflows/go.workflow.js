export const meta = {
  name: 'ship-go',
  description: 'Build (per-phase, with review) then verify a planned Ship feature — agent output stays out of the main context',
  phases: [
    { title: 'Build', detail: 'execute each phase: builder → reviewer (re-verify + diff review) → one fix round' },
    { title: 'Verify', detail: 'acceptance criteria + adversarial bug hunt → VERIFY.md' },
  ],
}

// args: { feature: string, phases: [{ id, name }], keyFileContext?: string,
//         profile?: string, reviewGate?: boolean, verifyDepth?: string, maxBuildRounds?: number }
// `phases` is the list of pending phases the go skill extracted from PLAN.md, in order.
// A flat (unphased) plan is passed as a single pseudo-phase { id: 'all', name: 'all' }.
// The policy knobs arrive pre-resolved from the go skill's profile resolution;
// every one of them defaults to today's behavior when absent.
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

// Display-only: the profile name appears in reports and records, never in logic.
const profileName = (parsedArgs && parsedArgs.profile) || null

// How many builder agents a single phase may burn before we call it stuck.
// Large tasks routinely exhaust one builder's turn budget after 2-3 tasks; the
// work is committed and PLAN.md records it, so a fresh builder resumes cleanly.
const MAX_BUILD_ROUNDS = Number(parsedArgs && parsedArgs.maxBuildRounds) || 5

// Explicit false only — anything else keeps the per-phase review gate on. The
// string form is accepted because the go skill hand-builds args from prose
// (same reason plan.workflow coerces roundOffset).
const reviewGate = !(parsedArgs && (parsedArgs.reviewGate === false || parsedArgs.reviewGate === 'false'))

// 'criteria-only' narrows Stage 2 of verification; anything else is full depth.
const verifyDepth = (parsedArgs && parsedArgs.verifyDepth) === 'criteria-only' ? 'criteria-only' : 'full'

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

// `verify_runs` and `files_reviewed` are required, not decorative: without them
// an APPROVED review with no findings is byte-identical whether the reviewer
// re-ran every verify command and read the whole diff or read nothing at all.
// They are the only evidence the gate actually ran, and they carry the
// not_runnable count — the widest escape hatch in the reviewer's contract.
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'status', 'findings', 'verify_runs', 'files_reviewed'],
  properties: {
    feature: { type: 'string' },
    scope: { type: 'string' },
    status: { enum: ['APPROVED', 'NEEDS_FIXES'] },
    verify_runs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'verdict'],
        properties: {
          task_id: { type: ['string', 'null'] },
          command: { type: 'string' },
          exit_code: { type: ['number', 'null'] },
          verdict: { enum: ['pass', 'fail', 'not_runnable'] },
        },
      },
    },
    files_reviewed: { type: 'array', items: { type: 'string' } },
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
          // Re-reviews only: true marks a problem the fix round introduced, so
          // the reconcile records it as new rather than as a leftover.
          new_issue: { type: 'boolean' },
        },
      },
    },
    // Salvage retries only: whether the retry reused a durable record or redid
    // the work. Optional — a first-attempt result never carries it — but it
    // must be declared, because additionalProperties is false and a compliant
    // salvage result would otherwise be rejected outright.
    salvaged: { enum: ['adopted', 'rejected'] },
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
    status: { enum: ['PASS', 'FAIL', 'INCONCLUSIVE', 'DEFERRED'] },
    criteria_passed: { type: 'number' },
    criteria_failed: { type: 'number' },
    criteria_inconclusive: { type: 'number' },
    criteria_deferred: { type: 'number' },
    criteria_total: { type: 'number' },
    criteria_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'verdict'],
        properties: {
          criterion: { type: 'string' },
          verdict: { enum: ['PASS', 'FAIL', 'INCONCLUSIVE', 'DEFERRED'] },
          evidence: { type: 'string' },
        },
      },
    },
    // Present when any criterion is DEFERRED: the in-lane record of shared
    // .project-manager/ edits only the PM layer may apply.
    pm_handoff: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        edits: { type: 'number' },
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
    // See REVIEW_SCHEMA.salvaged — same channel, same reason.
    salvaged: { enum: ['adopted', 'rejected'] },
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
// Salvage observability. Every retry that pointed at a durable record lands one
// entry here: an `adopted` event is the machinery working — a lost result
// recovered for a few thousand tokens instead of a ~90k-token re-run — while a
// `rejected` one means the record did not match this build and the work was
// redone. Surfacing both is what makes the next field audit a read of the
// GO COMPLETE report rather than a reconstruction from session transcripts.
const salvageEvents = []

// An agent that dies because the connection dropped has not spent a round: it
// never ran. Reporting that as turn-budget exhaustion is how a network outage
// came to be answered with advice to split tasks that did not need splitting,
// so the two causes are classified apart here and named apart downstream.
const MAX_TRANSPORT_RETRIES = 3

const TRANSPORT_PATTERNS = [
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /socket hang up/i,
  /overloaded/i,
  // An HTTP 5xx marker: the status code alone is too generic to match on, so
  // it only counts when it sits next to a status/error word.
  /(status|error)[^0-9]{0,20}50\d/i,
]

const isTransportError = (e) => {
  const message = String((e && e.message) || e || '')
  if (!message) return false
  return TRANSPORT_PATTERNS.some((re) => re.test(message))
}

// `safeAgent` cannot signal a cause through its return value — every call site
// tests `if (result)`, so a sentinel would read as success. The classification
// reaches `buildPhase` through this script-level state instead.
let lastFailure = null
let consecutiveTransportDeaths = 0

const infraRecommendation = `Re-run /ship:go ${feature} — the plan is sound and every committed task is preserved; this run lost its connection.`

const safeAgent = async (prompt, opts) => {
  const { retry = true, retryPrompt = null, salvageRecord = null, ...baseOpts } = opts && typeof opts === 'object' ? opts : {}
  const label = typeof baseOpts.label === 'string' ? baseOpts.label : ''
  const labelDisplay = label || '<no-label>'
  // Retry path only: a first attempt that succeeded salvaged nothing.
  const recordSalvage = (outcome) => {
    if (!retryPrompt) return
    salvageEvents.push({ agent: labelDisplay, record: salvageRecord, outcome })
    log(`salvage: ${labelDisplay}${salvageRecord ? ` (${salvageRecord})` : ''} → ${outcome}`)
  }
  // A returned result proves the connection is back, whatever it contains.
  const noteSuccess = () => { lastFailure = null; consecutiveTransportDeaths = 0 }
  const noteFailure = (e) => {
    const message = String(e && e.message ? e.message : e)
    const transport = isTransportError(e)
    lastFailure = { transport, message, label: labelDisplay }
    return transport
  }
  // Both attempts are gone. Only *consecutive* transport deaths count toward
  // the cap: a genuine agent failure in between proves the connection was fine,
  // so three outages spread across a healthy multi-hour build must not add up.
  const noteDeath = () => {
    if (lastFailure && lastFailure.transport) {
      consecutiveTransportDeaths += 1
      log(`${labelDisplay} died on a transport error — ${consecutiveTransportDeaths} consecutive (cap ${MAX_TRANSPORT_RETRIES})`)
    } else {
      consecutiveTransportDeaths = 0
    }
  }

  try {
    const result = await agent(prompt, baseOpts)
    noteSuccess()
    return result
  } catch (e) {
    const transport = noteFailure(e)
    if (!retry) {
      log(`${labelDisplay} threw (${e && e.message ? e.message : e}) [${transport ? 'transport' : 'agent'}] — treating as no result`)
      noteDeath()
      return null
    }
    log(`${labelDisplay} threw (${e && e.message ? e.message : e}) [${transport ? 'transport' : 'agent'}] — retrying once${retryPrompt ? ' (salvage)' : ''}`)
  }
  const retryOpts = { ...baseOpts, label: label ? `${label}:retry` : 'retry' }
  try {
    const result = await agent(retryPrompt || prompt, retryOpts)
    noteSuccess()
    // The retried agent is the only one that knows whether it reused the
    // record; absent that field the event records `unknown` rather than guessing.
    recordSalvage(result ? (result.salvaged || 'unknown') : 'no-result')
    return result
  } catch (e) {
    const transport = noteFailure(e)
    log(`${labelDisplay} threw again (${e && e.message ? e.message : e}) [${transport ? 'transport' : 'agent'}] — treating as no result`)
    noteDeath()
    recordSalvage('no-result')
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

You have no memory of that review — verify from the code. Two jobs, per the Re-Reviews section of your instructions:

1. Re-run the affected verify commands and confirm from the code whether each finding above is actually resolved. Report every one that is not, at its original severity.
2. Review the fix commits as a diff in their own right and report any NEW critical/high problem the fixes introduced, marked \`"new_issue": true\`.

Do not re-review the rest of the phase.`

// Salvage retry: a lost structured result is a transport failure, not proof the
// review never happened. The previous reviewer wrote its findings to a scratch
// file before returning, so the retry reads that instead of re-running every
// verify command and re-reading the diff. Falls through to a full review only
// when the scratch file is genuinely absent.
const salvageReviewPrompt = (ph, scope, fullPrompt) => `Salvage a lost review result for feature: ${feature}
${phaseLine(ph)}
A reviewer just completed this exact review, but its structured result was lost in transit. The work is very likely already done and recorded.

Read \`.planning/features/${feature}/.review-scratch/${scope}.json\`.

- **If it exists, its \`scope\` is \`${scope}\`, its \`head\` matches \`git rev-parse HEAD\`, and its \`stage\` is \`complete\`:** report its findings, \`verify_runs\`, and \`files_reviewed\` verbatim as your result and stop. Do NOT re-run verify commands, do NOT re-read the diff, do NOT revise the findings. An empty findings array is a valid result — report it as APPROVED.
- **If it matches but its \`stage\` is \`verify-only\`:** the previous reviewer finished the verify re-runs and died before reviewing the diff. Carry its \`verify_runs\` forward verbatim, skip Step 1, and do Step 2 only.
- **If it is missing, empty, malformed, stamped with a different scope or head, or carries no \`stage\` key at all:** it is not this review (an unstamped record predates this contract). Fall back to the full review below.

Whichever branch you take, report a \`"salvaged"\` field in your structured result: \`"adopted"\` when you reused any recorded work, \`"rejected"\` when the record was absent or did not match and you redid the review from scratch.

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

A verifier just ran this exact verification, but its structured result was lost in transit. Its work is very likely already recorded. Check the scratch record FIRST — it is the only artifact that survives a death part-way through Stage 1 or Stage 2 — and only then VERIFY.md.

**1. The scratch record.** Run \`node "\${CLAUDE_PLUGIN_ROOT}/ship/verify-scratch.cjs" ${feature}\` and read the JSON verdict it prints. The helper never throws and always exits 0; a verdict you cannot parse is a reject.

- **\`valid: true\` with \`stage: "complete"\`:** the verification finished. Adopt its criteria verdicts, carried-finding outcomes, and tests verbatim, confirm \`.planning/features/${feature}/VERIFY.md\` is on disk, and report the result without re-running anything.
- **\`valid: true\` with \`stage: "criteria"\` or \`"bughunt"\`:** a previous verifier died part-way through THIS build. Adopt every recorded criterion verdict and carried-finding outcome verbatim, resume at the first criterion the record does not cover, and do NOT re-author any test file the record's \`tests[]\` shows as already committed — re-writing a committed test file is the exact waste this record exists to prevent.
- **\`valid: false\`:** the record is not this build's. Ignore it and fall through to VERIFY.md below.

**2. VERIFY.md.** Read \`.planning/features/${feature}/VERIFY.md\` and run \`git rev-parse HEAD\`.

- **If it exists, is complete (all stages filled, no placeholders), and its \`**Head:**\` line matches that SHA:** report its verdict, counts, criteria verdicts, bugs, and gaps as your result and stop. Do NOT re-run criteria, re-hunt bugs, or rewrite the file.
- **If it carries \`**Status:** IN PROGRESS — Stage 1 only\`:** it is a Stage 1 flush from a run that died, not a verdict. Never report it as your result — its criteria table is evidence, and the scratch record above supersedes it.
- **If it is missing, partial, stamped with a different head, or carries no \`**Head:**\` line at all:** it is not this verification. Fall back to the full verification below.

**3.** Whichever branch you take, report a \`"salvaged"\` field in your structured result: \`"adopted"\` when you reused any recorded work, \`"rejected"\` when nothing matched and you redid the verification from scratch.

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
    } else if (lastFailure && lastFailure.transport) {
      // The builder died on the connection, not on its turn budget. It never
      // ran, so this round is not charged against MAX_BUILD_ROUNDS — and the
      // progress probe is skipped, being itself an agent call that would just
      // die the same way. The transport cap is what stops this looping forever,
      // so it is checked first and returns rather than falling through.
      if (consecutiveTransportDeaths >= MAX_TRANSPORT_RETRIES) {
        log(`build:${label} stopping: ${consecutiveTransportDeaths} consecutive transport failure(s) — this is an outage, not an exhausted budget`)
        return {
          feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
          status: 'INFRASTRUCTURE',
          tasks_completed: priorTasks, tasks_total: lastTotal,
          commits: uniq(priorCommits),
          stopped_at: `phase ${label}`,
          reason: `${consecutiveTransportDeaths} consecutive agent(s) died on a transport error: ${lastFailure.message}`,
          recommendation: infraRecommendation,
          rounds: round,
        }
      }
      log(`build:${label} round ${round} died on a transport error (${lastFailure.message}) — not charging the round, retrying`)
      round -= 1
      continue
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

  // The reason is derived from what actually happened. A run that stalled with
  // the connection down is not a run whose tasks were too big, and saying so
  // unconditionally is what sent operators off splitting healthy tasks.
  const endedOnTransport = !!(lastFailure && lastFailure.transport)
  return {
    feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
    status: 'EXHAUSTED',
    tasks_completed: priorTasks, tasks_total: lastTotal,
    commits: uniq(priorCommits),
    stopped_at: `phase ${label}`,
    reason: endedOnTransport
      ? `builders stopped making progress after ${MAX_BUILD_ROUNDS} round(s); the last agent died on a transport error: ${lastFailure.message}`
      : `builders stopped making progress after ${MAX_BUILD_ROUNDS} round(s) — turn budget exhausted with tasks still pending`,
    recommendation: endedOnTransport
      ? infraRecommendation
      : `Run /ship:build ${feature} to continue this phase interactively, or split its remaining tasks into smaller ones with /ship:plan ${feature}.`,
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

  if (!build || build.status === 'EXHAUSTED' || build.status === 'NEEDS_CONTEXT' || build.status === 'CHECKPOINT' || build.status === 'INFRASTRUCTURE') {
    stoppedAt = { phase: ph, build: build || { status: 'NO_RESULT' } }
    log(`Build stopped at phase ${label}: ${build ? build.status : 'no result'} — surfacing to the user.`)
    break
  }

  // Review gate off by profile: no reviewer, no fix round, no re-review. The
  // entry carries empty collections (never nulls — the go skill's reconcile
  // filters and maps them) and a status distinct from the reconcile-side
  // 'SKIPPED', which means the review failed to run. A deliberate skip must
  // never look like a broken gate, so it raises no review concerns either.
  if (!reviewGate) {
    completed.push({
      phaseId: ph.id, phaseName: ph.name,
      tasksCompleted: build.tasks_completed, tasksTotal: build.tasks_total,
      builderRounds: build.rounds || 1,
      commits: build.commits || [],
      concerns: [...(build.concerns || [])],
      reviewStatus: 'SKIPPED_BY_PROFILE',
      findings: [],
      verifyRuns: [], filesReviewed: [],
      fixApplied: false, unresolved: [], introducedByFix: [],
    })
    log(`Phase ${label}: per-phase review skipped by profile${profileName ? ` (${profileName})` : ''}.`)
    continue
  }

  const reviewScope = ph.id === 'all' ? 'all' : `phase-${ph.id}`
  const reviewFull = reviewPrompt(ph, build.commits || [])
  const review = await safeAgent(reviewFull, {
    agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `review:${label}`, phase: 'Build',
    retryPrompt: salvageReviewPrompt(ph, reviewScope, reviewFull), salvageRecord: `.review-scratch/${reviewScope}.json`,
  })

  let fixRound = null
  let rereview = null
  let fixSkipped = null
  // Trust the findings over the verdict: an APPROVED review that still lists
  // critical/high findings is contradictory and must not skip the fix round.
  const blocking = review
    ? review.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
    : []

  if (blocking.length) {
    fixRound = await safeAgent(fixPrompt(ph, blocking), {
      agentType: 'ship:ship-builder', schema: BUILD_SCHEMA, label: `fix:${label}`, phase: 'Build',
    })
    const fixCommits = (fixRound && fixRound.commits) || []
    // A fix round that committed nothing fixed nothing anyone can point at, and
    // sending a re-reviewer after it is worse than sending none: with no fix
    // commits there is no range, so it inspects `git diff HEAD`, finds a clean
    // tree, and plausibly returns APPROVED — which the reconcile would record
    // as "fixed in fix round" against every finding. Mark them unresolved
    // instead and let the verifier (which now reads REVIEW.md) test them.
    if (!fixCommits.length) {
      fixSkipped = fixRound ? 'reported no commits' : 'returned no result'
      log(`fix:${label} ${fixSkipped} — skipping the re-review and marking ${blocking.length} finding(s) unresolved`)
    } else {
      const rereviewFull = rereviewPrompt(ph, blocking, fixCommits)
      rereview = await safeAgent(rereviewFull, {
        agentType: 'ship:ship-reviewer', schema: REVIEW_SCHEMA, label: `rereview:${label}`, phase: 'Build',
        retryPrompt: salvageReviewPrompt(ph, `${reviewScope}-rereview`, rereviewFull), salvageRecord: `.review-scratch/${reviewScope}-rereview.json`,
      })
    }
  }

  // If blocking findings existed but no re-review confirmed them resolved —
  // because it was skipped for want of fix commits, or because it produced no
  // result — report them as unresolved rather than claiming a clean phase.
  const surviving = rereview
    ? rereview.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
    : []
  const unresolved = blocking.length && !rereview ? blocking : surviving
  // Subset of `unresolved`, for labelling only: problems the fix round created
  // rather than leftovers it failed to clear.
  const introducedByFix = surviving.filter((f) => f.new_issue === true)

  const verifyRuns = (review && review.verify_runs) || []
  const filesReviewed = (review && review.files_reviewed) || []
  const notRunnable = verifyRuns.filter((v) => v.verdict === 'not_runnable').length

  // Everything here is a way the gate can report safety it does not have, so
  // each one travels the concerns channel the go skill already surfaces.
  const reviewConcerns = []
  if (!review) {
    reviewConcerns.push(`phase ${label} review never ran (no result after retry) — the diff went unreviewed`)
  } else if (!verifyRuns.length && !filesReviewed.length) {
    reviewConcerns.push(`phase ${label} review re-ran no verify commands and reviewed no files — treat its ${review.status} verdict as unsubstantiated`)
  }
  if (notRunnable) {
    reviewConcerns.push(`phase ${label}: ${notRunnable} of ${verifyRuns.length} verify command(s) could not be re-run in this environment`)
  }
  if (fixSkipped) {
    reviewConcerns.push(`phase ${label} fix builder ${fixSkipped} — ${blocking.length} critical/high finding(s) left unresolved, no re-review ran`)
  }

  completed.push({
    phaseId: ph.id, phaseName: ph.name,
    tasksCompleted: build.tasks_completed, tasksTotal: build.tasks_total,
    // >1 means the phase outlived at least one builder's turn budget and was
    // finished by a fresh continuation builder.
    builderRounds: build.rounds || 1,
    commits: build.commits || [],
    concerns: [...(build.concerns || []), ...reviewConcerns],
    reviewStatus: review ? review.status : 'SKIPPED',
    findings: review ? review.findings : [],
    verifyRuns, filesReviewed,
    fixApplied: !!fixRound && !fixSkipped, unresolved, introducedByFix,
  })
}

// A phase is marked done even when its critical/high findings survive the one
// fix round, on the stated grounds that the verifier is the backstop. That only
// holds if the verifier is told what to catch. It cannot read this run's
// REVIEW.md — the go skill persists that after this workflow returns — so the
// findings travel in the prompt. (On the manual /ship:verify path REVIEW.md is
// already on disk, which is why the verifier reads it there.)
const carried = completed.flatMap((p) =>
  (p.unresolved || []).map((f) => {
    const origin = (p.introducedByFix || []).includes(f) ? ' (introduced by the fix round)' : ''
    return `- [${f.severity}] phase ${p.phaseId} — ${f.file}: ${f.description}${origin}`
  }))

const carriedBlock = carried.length
  ? `

## Unresolved Review Findings — mandatory targets

The per-phase review gate found these critical/high defects and the single fix round did not clear them. They are not speculation: a reviewer read the diff and evidenced each one. Target every finding below directly in Stage 2b — write a test or attempt a reproduction — and record the outcome for each in VERIFY.md, including the ones you cannot reproduce. A phase carrying unresolved findings is still marked done, so "the phase is done" is not evidence that any of these were fixed.

${carried.join('\n')}`
  : ''

// Prompt-scoped narrowing of Stage 2. The verifier's contract permits it only
// on an explicit instruction like this one — never on its own judgment — and
// carried findings stay mandatory targets regardless of depth.
const depthBlock = verifyDepth === 'criteria-only'
  ? `

## Verification depth: criteria-only

This run's profile${profileName ? ` (${profileName})` : ''} narrows Stage 2: skip test-framework discovery (2a), the discretionary risk-category adversarial tests, and the anti-pattern scan (2c). Stage 1 (every acceptance criterion, real commands) and Stage 3 (VERIFY.md + verdict) run in full, and the verdict rules are unchanged. EXCEPTION: any findings under 'Unresolved Review Findings' above remain mandatory Stage 2b targets at this depth — narrowing never waives them. Record the narrowing in VERIFY.md's Stage 2 section per your instructions.`
  : ''

let verdict = null
if (!stoppedAt) {
  phase('Verify')
  const verifyFull = `Verify feature: ${feature}\n\nRead .planning/features/${feature}/CONTEXT.md and PLAN.md, then verify acceptance criteria, hunt bugs with adversarial tests, scan for anti-patterns, and write VERIFY.md per your instructions.${carriedBlock}${depthBlock}`
  verdict = await safeAgent(verifyFull, {
    agentType: 'ship:ship-verifier', schema: VERIFY_SCHEMA, label: 'verify', phase: 'Verify',
    retryPrompt: salvageVerifyPrompt(verifyFull), salvageRecord: '.review-scratch/verify.json',
  })
  // A verifier lost to the same outage is reported through the one
  // INFRASTRUCTURE rendering path — as a pseudo-phase, since `stoppedAt` is the
  // only channel the go skill renders — rather than as a bare null verdict the
  // report would have to explain some other way.
  if (!verdict && consecutiveTransportDeaths >= MAX_TRANSPORT_RETRIES) {
    stoppedAt = {
      phase: { id: 'verify', name: 'verify' },
      build: {
        status: 'INFRASTRUCTURE',
        tasks_completed: 0, tasks_total: 0, commits: [],
        stopped_at: 'verify',
        reason: `${consecutiveTransportDeaths} consecutive agent(s) died on a transport error: ${lastFailure ? lastFailure.message : 'connection lost'}`,
        recommendation: infraRecommendation,
      },
    }
    log(`Verify stopped: ${consecutiveTransportDeaths} consecutive transport failure(s) — the build is intact, the connection is not.`)
  }
}

return { feature, stoppedAt, completed, verdict, salvageEvents }
