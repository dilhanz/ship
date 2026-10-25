export const meta = {
  name: 'ship-go',
  description: 'Build (per-phase, with review) then verify a planned Ship feature — agent output stays out of the main context',
  phases: [
    { title: 'Build', detail: 'execute each phase: builder → reviewer (re-verify + diff review) → one fix round' },
    { title: 'Verify', detail: 'acceptance criteria + adversarial bug hunt → VERIFY.md' },
  ],
}

// args: { feature: string, phases: [{ id, name }], keyFileContext?: string,
//         profile?: string, reviewGate?: boolean, verifyDepth?: string, maxBuildRounds?: number,
//         syncMain?: boolean }
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

// Explicit true only — merge main into the branch before verifying. A trial
// merge that conflicts fails the verify, and on rpfs 7 of the FAILs in two
// weeks were nothing but rows both sides appended to the same shared file;
// each one cost a fix round and a full re-verify to resolve what a sync step
// resolves for a few thousand tokens. The go skill always passes it; absent
// means the previous behavior, like every other knob here.
const syncMain = !!(parsedArgs && (parsedArgs.syncMain === true || parsedArgs.syncMain === 'true'))

// What gates a phase. A critical or high finding always does. A medium does
// when the reviewer reproduced it with a command: the verifier reproduced 195
// carried findings across 64 rpfs features, and every reproduced medium failed
// the verify, so it went through a fix round and a full re-verify instead of
// the in-phase fix round that costs a tenth of that while the builder still has
// the context. An unreproduced medium keeps travelling to the verifier as a
// located target — about 40% of carried findings did not reproduce, and gating
// on those would spend fix rounds on non-bugs.
const isBlocking = (f) => !!f && (f.severity === 'critical' || f.severity === 'high' ||
  (f.severity === 'medium' && f.reproduced === true))

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
          // True only when the reviewer ran a command that demonstrated the
          // defect at HEAD. A reproduced medium gates the phase (isBlocking).
          reproduced: { type: 'boolean' },
          // The defect class, and every place in the diff it occurs. One
          // finding per pattern, so a fix covers the class instead of the
          // one call site the reviewer happened to read first.
          pattern: { type: 'string' },
          sites: { type: 'array', items: { type: 'string' } },
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
    // Ordering corruption the probe can see from PLAN.md alone. Optional, so a
    // probe result without it still validates.
    out_of_order: { type: 'array', items: { type: 'string' } },
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
          // See REVIEW_SCHEMA findings — one bug per defect class, every
          // instance listed, so the fix task sweeps them all in one round.
          pattern: { type: 'string' },
          sites: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    anti_patterns: { type: 'number' },
    gaps: { type: 'array', items: { type: 'string' } },
    // The verify gates (Stage 2b): one row per checklist item decided, and the
    // trial merge with main. Optional, so an older verifier still validates.
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'source', 'verdict', 'evidence'],
        properties: {
          item: { type: 'string' },
          source: { enum: ['generic', 'repo'] },
          verdict: { enum: ['PASS', 'FAIL', 'N/A'] },
          evidence: { type: 'string' },
        },
      },
    },
    trial_merge: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['outcome'],
      properties: {
        outcome: { enum: ['PASS', 'FAIL', 'NOT_RUNNABLE'] },
        target: { type: 'string' },
        command: { type: 'string' },
        evidence: { type: 'string' },
      },
    },
    // See REVIEW_SCHEMA.salvaged — same channel, same reason.
    salvaged: { enum: ['adopted', 'rejected'] },
  },
}

const SYNC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome'],
  properties: {
    outcome: { enum: ['up-to-date', 'merged', 'conflict-aborted', 'not-runnable'] },
    target: { type: ['string', 'null'] },
    commit: { type: ['string', 'null'] },
    conflicted_files: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
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
  // A spent usage window stops every agent exactly as a dropped connection
  // does, and waiting is the only remedy for either.
  /(session|usage) limit/i,
]

// The patterns above only see what the harness puts in the thrown message, and
// in the field that is almost never the cause. An agent that dies on ENOTFOUND
// or a session limit ends on a synthetic "API Error" message, and what the
// harness then throws is the generic `subagent completed without calling
// StructuredOutput` — byte-identical to a turn-cap death. An audit of 114 runs
// found every logged throw classified `[agent]` and none `[transport]`, across
// ~60 outage deaths: the classification below never fired, and outages burned
// every continuation round "retrying blind" before being reported as EXHAUSTED.
//
// So an outage is also recognised by its *shape*: a trivial read-only agent —
// the progress probe on the build path, the canary below on the verify path —
// has no turn budget to exhaust and no work to get wrong, so when it dies
// right after a long-running agent did, the thing that failed is the
// connection. MAX_BLIND_ROUNDS is how many consecutive build rounds may end
// that way: the first is retried, because a laptop waking from sleep kills
// the agents in flight and the next one succeeds; the second is an outage.
const MAX_BLIND_ROUNDS = 2

const CANARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
}

const canaryPrompt = `Connection check. Do not read files, run commands, or use any other tool. Call StructuredOutput with {"ok": true} as your only action.`

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
- out_of_order — any task marked status="done" whose depends list names a task that is NOT marked done, as "task {id} depends on {unmet ids}"; empty array when the ordering is clean
- notes — anything odd (uncommitted work, a done task with no commit), else null`

// The builder reports its commits oldest-first (one atomic commit per task, in
// task order), so the range is computable here. Handing the reviewer a finished
// range saves it the turns it used to spend re-deriving one with `git log`.
const diffRange = (commits) => (commits.length ? `${commits[0]}~1..HEAD` : null)

const rangeInstruction = (range) => range
  ? `Diff range: \`${range}\` — already derived from the phase commits (oldest first). Use it directly with \`git diff ${range}\`; do not spend turns re-deriving it.

Only if that range is unusable — \`git diff --stat ${range}\` errors or comes back empty, or \`${range.split('~')[0]}\` is the repository's root commit so \`~1\` does not resolve — fall back: \`git log --oneline -20\` to locate the true range, or \`git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD\` (the empty tree) when the phase starts at the root commit.`
  : 'No commits were reported for this phase, so no range was precomputed. Derive it yourself: the `commit="..."` attributes on this phase\'s done tasks in PLAN.md give the oldest commit, and the range is `{oldest}~1..HEAD`. Only when no task records a commit is the work uncommitted — then review the working tree against the merge-base (`git diff $(git merge-base HEAD main)`, falling back to `master`). Never review a bare `git diff HEAD`: on a committed phase it is empty, and an empty diff is not a clean review.'

const reviewPrompt = (ph, commits) => `Review feature: ${feature}
${phaseLine(ph)}Phase commits: ${commits.length ? commits.join(', ') : '(none reported)'}

${rangeInstruction(diffRange(commits))}

Re-run each task's verify command (trust-but-verify), then review the phase diff. Read .planning/features/${feature}/PLAN.md and .planning/features/${feature}/CONTEXT.md.`

// One finding line, shared by every prompt that hands findings on. The pattern
// and sites travel with it: a fix that sees only the first call site fixes only
// that one, and the next verify finds the second.
const findingTags = (f) => [f.severity, f.reproduced === true ? 'reproduced' : null].filter(Boolean).join(', ')
const findingExtras = (f) => `${f.pattern ? ` Pattern: ${f.pattern}.` : ''}${Array.isArray(f.sites) && f.sites.length ? ` Sites: ${f.sites.join(', ')}.` : ''}`
const findingLine = (f) => `[${findingTags(f)}] ${f.file} — ${f.description}${findingExtras(f)}`

// The sweep rule, stated once for the fix builder. On rpfs, 16 verify FAILs in
// two weeks were the same defect at a call site the previous fix had not
// touched — workorder-photos-closure-label fixed last-writer-wins saves one
// method per round, through five verifies.
const sweepInstruction = `Fix the defect class, not the instance. Before you change anything for a finding, search this feature's changed files (\`git diff --name-only $(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)..HEAD\`) for every other occurrence of the same pattern — the listed sites are where the reviewer found it, not a promise there are no others. Fix every occurrence, and cover each one with a test (one parametrized test is fine). Name every site you fixed in the commit body. An occurrence outside the changed files is pre-existing: leave it, and record it in your concerns.`

const fixPrompt = (ph, findings) => `Fix review findings for feature: ${feature}
${phaseLine(ph)}
The phase reviewer found blocking issues — critical/high, or a medium it reproduced with a command. Fix ONLY these — do not refactor beyond them:

${findings.map((f, i) => `${i + 1}. ${findingLine(f)}${f.recommendation ? ` (fix: ${f.recommendation})` : ''}`).join('\n')}

${sweepInstruction}

For each fix: implement it, re-run the affected task's verify command, and commit with "fix(${feature}): {short description}". Emit an updated build_result.`

// Each agent() call is a fresh agent — the re-reviewer has no memory of the
// original review, so the findings must be embedded in the prompt.
const rereviewPrompt = (ph, findings, fixCommits) => `Re-review feature: ${feature}
${phaseLine(ph)}A previous review found these blocking issues, and a builder has applied fixes${fixCommits.length ? ` (fix commits: ${fixCommits.join(', ')})` : ''}:

${findings.map((f, i) => `${i + 1}. ${findingLine(f)}`).join('\n')}

${rangeInstruction(diffRange(fixCommits))}

You have no memory of that review — verify from the code. Two jobs, per the Re-Reviews section of your instructions:

1. Re-run the affected verify commands and confirm from the code whether each finding above is actually resolved — at every site, not just the first. Search the phase's changed files for the finding's pattern: an occurrence the fix missed means the finding is not resolved. Report every one that is not, at its original severity, with the missed sites in \`sites\`. A medium you report as unresolved keeps \`"reproduced": true\` only if you reproduced it again.
2. Review the fix commits as a diff in their own right and report any NEW critical/high problem the fixes introduced, marked \`"new_issue": true\`.

Do not re-review the rest of the phase.`

// Sync main into the branch before verifying, so the verifier's trial merge is
// a check that passes rather than the cheapest way to fail. A builder does it:
// the verifier must never touch the branch, and the reviewer is read-only.
const syncPrompt = `Sync feature branch with main before verification: ${feature}

You are not executing PLAN.md tasks. Do NOT edit PLAN.md or CONTEXT.md, do not run the task loop, never rebase, never push, never force anything. Your only job is to bring main into this branch with a merge commit, or to leave the branch exactly as it was.

1. **Preconditions.** If \`git rev-parse -q --verify MERGE_HEAD\` resolves, a previous sync died mid-merge: run \`git merge --abort\` first and carry on from a clean branch. Then run \`git status --porcelain\` and \`git rev-parse --abbrev-ref HEAD\`. If the tree is dirty, HEAD is detached, or the current branch IS the default branch (main/master), report \`not-runnable\` with the reason and stop — do not stash, do not switch branches. Also stop with \`not-runnable\` when \`.planning/features/${feature}/.review-scratch/verify.json\` exists: a verification of this head is part-way done, and moving HEAD would void the record its salvage resumes from.
2. **Target.** Fetch and pick the target exactly as the verifier's trial merge does:
   \`git remote get-url origin >/dev/null 2>&1 && git fetch -q origin main || true\`, then the first of \`origin/main\`, \`main\`, \`master\` that resolves. None → \`not-runnable\`.
3. **Already contained?** \`git merge-base --is-ancestor {target} HEAD\` exiting 0 → report \`up-to-date\` and stop. Nothing else to do.
4. **Merge.** \`git merge --no-edit {target}\`.
   - **Clean** → report \`merged\` with the merge commit's short hash. Do not run the build: the verifier's gates run next, against this exact head.
   - **Conflicts** → resolve ONLY mechanical ones: both sides appended separate rows, entries, imports, registrations, footnotes or changelog lines at the same spot, and the honest resolution keeps both, in a sensible order. If ANY conflicted hunk needs you to choose between two behaviours, two wordings of the same row, or to understand what either side intended, run \`git merge --abort\` and report \`conflict-aborted\` with every conflicted file — the verifier's trial merge will report it, and a wrong resolution here would land silently.
   - After resolving mechanical conflicts, run the \`Build:\` line of \`.planning/verify-checklist.md\` (else the project's build/test command). Red → \`git merge --abort\` and report \`conflict-aborted\` with the failing output tail in \`notes\`. Green → stage each resolved file by name (never a bulk add) and commit the merge with \`git commit --no-edit\` in the same command, then report \`merged\` with the hash, listing the files you resolved in \`conflicted_files\`.

Your structured result is NOT a build_result. Call StructuredOutput with exactly these fields and nothing else: \`outcome\`, \`target\`, \`commit\` (or null), \`conflicted_files\`, \`notes\`.`

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
- **If it matches but its \`stage\` is \`verify-only\`:** the previous reviewer finished every verify run (Step 1 and the neighbouring tests of Step 1b) and died before reviewing the diff. Carry its \`verify_runs\` forward verbatim, skip Step 1 and 1b, and do Step 2 only.
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
- **\`valid: true\` with \`stage: "criteria"\` or \`"bughunt"\`:** a previous verifier died part-way through THIS build. Adopt every recorded criterion verdict and carried-finding outcome verbatim, resume at the first criterion the record does not cover, and do NOT re-author any test file the record's \`tests[]\` shows as already committed — re-writing a committed test file is the exact waste this record exists to prevent. Also adopt the record's \`checklist\` rows and its \`trial_merge\` verbatim: resume at the first checklist item the record has not decided, and do NOT repeat a trial merge the record has already decided.
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
  // Concerns raised by this phase's own machinery (as opposed to the builder's
  // own). They must reach every exit: the builder that corrupted the ordering is
  // gone, so the probe's report is the only surviving trace of it.
  const phaseConcerns = []
  let priorTasks = 0
  let lastDone = null // absolute done-count from the last probe, when we have one
  let lastTotal = 0
  // One salvage round is granted, once, for a dead builder that left the
  // working tree dirty — see the `landed` decision below.
  let salvagedDirtyTree = false
  // Set when the salvage is granted, consumed by the next round's prompt.
  let salvageNotePending = false
  // Consecutive rounds in which the builder and the probe both died.
  let blindRounds = 0

  for (let round = 1; round <= MAX_BUILD_ROUNDS; round++) {
    const suffix = round === 1 ? '' : `:cont${round - 1}`
    const base = lastDone === null
      ? `Committed so far this phase: ${priorCommits.length ? priorCommits.join(', ') : '(none reported)'}.`
      : `PLAN.md showed ${lastDone} of ${lastTotal} task(s) done in this scope when the previous builder stopped.`
    // The salvage round exists for the dirty tree, so say so rather than
    // leaving the builder to find it: this round is the work's last chance.
    const state = salvageNotePending
      ? `${base}\n\n**The previous builder died with uncommitted changes in the working tree.** That is finished work from an interrupted task, not scratch. Before anything else: run \`git status\` and \`git diff\`, complete that task if it is incomplete, run its \`<verify>\`, and commit it. This is the only round that will do it — a phase that ends with those changes still uncommitted loses them.`
      : base
    salvageNotePending = false

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
        concerns: [...(build.concerns || []), ...phaseConcerns],
        rounds: round,
      }
    }

    let landed
    if (build) {
      blindRounds = 0
      landed =(build.commits || []).length > 0 || (build.tasks_completed || 0) > 0
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
          concerns: [...phaseConcerns],
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
        // Blind round: the builder and the probe both failed. The probe reads
        // one file and has two attempts, so it does not die of anything a
        // builder dies of — this is the outage shape (see MAX_BLIND_ROUNDS).
        // One blind retry is allowed, and a fresh builder is cheap when
        // nothing is pending (it returns COMPLETE immediately). Out of blind
        // retries or out of rounds, the honest status is INFRASTRUCTURE either
        // way: EXHAUSTED claims the tasks were too big, and a run that could
        // not even read PLAN.md has no evidence of that.
        blindRounds += 1
        if (blindRounds >= MAX_BLIND_ROUNDS || round >= MAX_BUILD_ROUNDS) {
          log(`build:${label} stopping: builder and progress probe both died in ${blindRounds} consecutive round(s) — this is an outage, not an exhausted budget`)
          return {
            feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
            status: 'INFRASTRUCTURE',
            tasks_completed: priorTasks, tasks_total: lastTotal,
            commits: uniq(priorCommits),
            stopped_at: `phase ${label}`,
            reason: `the builder and the read-only progress probe both died in ${blindRounds} consecutive round(s) — a probe has no turn budget to exhaust, so the connection or the usage limit failed, not the plan${lastFailure ? ` (last error: ${lastFailure.message})` : ''}`,
            recommendation: infraRecommendation,
            concerns: [...phaseConcerns],
            rounds: round,
          }
        }
        landed = true
        log(`build:${label} round ${round} returned no result and the progress probe failed — retrying blind (${blindRounds} of ${MAX_BLIND_ROUNDS})`)
      } else {
        blindRounds = 0
        priorCommits.push(...(progress.commits || []))
        // The probe reads PLAN.md's declared ordering, so it can see a task
        // marked done ahead of a dependency it declared. Surface it: the
        // builder that did it is gone, and an already-corrupted plan must not
        // become invisible just because nobody is left to report it.
        for (const entry of progress.out_of_order || []) {
          const concern = `phase ${label}: PLAN.md ordering violated — ${entry}`
          if (!phaseConcerns.includes(concern)) phaseConcerns.push(concern)
        }
        if (progress.tasks_pending === 0) {
          log(`build:${label} round ${round} returned no result, but PLAN.md shows every task done — treating the phase as complete`)
          return {
            feature, scope: ph.id === 'all' ? 'all' : `phase:${ph.id}`,
            status: 'COMPLETE_WITH_CONCERNS',
            tasks_completed: progress.tasks_done, tasks_total: progress.tasks_total,
            commits: uniq(priorCommits),
            concerns: [`phase ${label}: a builder exhausted its turn budget without reporting; completion confirmed from PLAN.md task status${progress.working_tree_clean === false ? ' (working tree not clean — check for uncommitted leftovers)' : ''}`, ...phaseConcerns],
            rounds: round,
          }
        }
        landed = lastDone === null || progress.tasks_done > lastDone

        // A dead builder that left the tree dirty did work the done-count
        // cannot see. The commit is the last step of a task, so a builder cut
        // off just before it has the whole task sitting in the working tree —
        // finished and verified, but uncommitted, unmarked, and by this
        // count indistinguishable from a builder that achieved nothing. Ending
        // the phase there discards it and escalates a run that was minutes
        // from done; one more builder commits it, because that is exactly what
        // `continuePrompt` tells a continuation to do first.
        //
        // Granted ONCE per phase (`salvagedDirtyTree`). A tree that is still
        // dirty after the salvage round is not an interrupted commit — it is
        // something no builder is going to finish, and looping on it would
        // burn the whole round budget discovering that.
        if (!landed && progress.working_tree_clean === false && !salvagedDirtyTree) {
          salvagedDirtyTree = true
          salvageNotePending = true
          landed = true
          const concern = `phase ${label}: a builder died leaving uncommitted work in the tree; granted one salvage round to commit it`
          if (!phaseConcerns.includes(concern)) phaseConcerns.push(concern)
          log(`build:${label} round ${round} landed no new done tasks, but the working tree is dirty — granting one salvage round to commit the interrupted task`)
        }

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
    concerns: [...phaseConcerns],
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
      rereviewStatus: null, rereviewFindings: [], rereviewVerifyRuns: [], rereviewFilesReviewed: [],
      recorded: [],
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
  // a blocking finding is contradictory and must not skip the fix round.
  const blocking = review ? review.findings.filter(isBlocking) : []

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
  // The re-review's own evidence. It is held to the same standard as the first
  // review: a re-reviewer that re-ran nothing and read nothing has confirmed
  // nothing, and its APPROVED would otherwise convert every blocking finding
  // into "fixed in fix round" on no evidence at all — the one place a rubber
  // stamp does the most damage. Such a re-review counts as no re-review.
  const rereviewVerifyRuns = (rereview && rereview.verify_runs) || []
  const rereviewFilesReviewed = (rereview && rereview.files_reviewed) || []
  const rereviewUnsubstantiated = !!rereview && !rereviewVerifyRuns.length && !rereviewFilesReviewed.length
  const surviving = rereview ? rereview.findings.filter(isBlocking) : []
  const unresolved = blocking.length && (!rereview || rereviewUnsubstantiated) ? blocking : surviving
  // Subset of `unresolved`, for labelling only: problems the fix round created
  // rather than leftovers it failed to clear.
  const introducedByFix = surviving.filter((f) => f.new_issue === true && !rereviewUnsubstantiated)

  const verifyRuns = (review && review.verify_runs) || []
  const filesReviewed = (review && review.files_reviewed) || []
  const notRunnable = verifyRuns.filter((v) => v.verdict === 'not_runnable').length

  // Everything the reviewers found that did not gate the build: medium/low
  // findings from the review, plus any medium/low the re-review raised about
  // the fix commits. Nothing downstream used to read these — the fix round and
  // the verifier's carried block were critical/high only — yet across 455
  // reviewed phases they outnumbered critical+high two to one, and the last
  // three verifiers that pulled them in on their own initiative reproduced
  // every medium as a real bug. They travel to the verifier as located targets.
  // A reproduced medium is not among them: it gated the phase (isBlocking), so
  // it is either fixed or carried as unresolved.
  const recorded = [
    ...(review ? review.findings.filter((f) => !isBlocking(f)) : []),
    ...(rereview && !rereviewUnsubstantiated ? rereview.findings.filter((f) => !isBlocking(f)) : []),
  ]

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
    reviewConcerns.push(`phase ${label} fix builder ${fixSkipped} — ${blocking.length} blocking finding(s) left unresolved, no re-review ran`)
  }
  if (rereviewUnsubstantiated) {
    reviewConcerns.push(`phase ${label} re-review re-ran no verify commands and reviewed no files — its ${rereview.status} verdict confirms nothing, ${blocking.length} blocking finding(s) kept unresolved`)
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
    // The re-review as its own record, so REVIEW.md can carry a round-2 block
    // with the same evidence lines round 1 gets. Null status means none ran.
    rereviewStatus: rereview ? rereview.status : null,
    rereviewFindings: rereview ? rereview.findings : [],
    rereviewVerifyRuns, rereviewFilesReviewed,
    recorded,
  })
}

// A phase is marked done even when its blocking findings survive the one
// fix round, on the stated grounds that the verifier is the backstop. That only
// holds if the verifier is told what to catch. It cannot read this run's
// REVIEW.md — the go skill persists that after this workflow returns — so the
// findings travel in the prompt. (On the manual /ship:verify path REVIEW.md is
// already on disk, which is why the verifier reads it there.)
const carried = completed.flatMap((p) =>
  (p.unresolved || []).map((f) => {
    const origin = (p.introducedByFix || []).includes(f) ? ' (introduced by the fix round)' : ''
    return `- [${findingTags(f)}] phase ${p.phaseId} — ${f.file}: ${f.description}${findingExtras(f)}${origin}`
  }))

const unresolvedBlock = carried.length
  ? `

## Unresolved Review Findings — mandatory targets

The per-phase review gate found these blocking defects — critical/high, or a medium the reviewer reproduced — and the single fix round did not clear them. They are not speculation: a reviewer read the diff and evidenced each one. Target every finding below directly in Stage 2b — write a test or attempt a reproduction — and record the outcome for each in VERIFY.md, including the ones you cannot reproduce. A phase carrying unresolved findings is still marked done, so "the phase is done" is not evidence that any of these were fixed.

${carried.join('\n')}`
  : ''

// The lower-severity findings travel too. REVIEW.md is written only after this
// workflow returns, so on this path the prompt is the only way they reach the
// verifier — a verifier that had to go and read the reviewers' scratch files to
// find a medium that then turned out to be a real bug is how this block earned
// its place.
const recordedCarried = completed.flatMap((p) =>
  (p.recorded || []).map((f) => `- [${findingTags(f)}] phase ${p.phaseId} — ${f.file}: ${f.description}${findingExtras(f)}`))

const recordedBlock = recordedCarried.length
  ? `

## Recorded Review Findings — located targets

The per-phase reviewers also recorded these lower-severity findings. They did not gate the build and no fix round touched them, but each one is already located in the diff, so they are the cheapest bugs available to you. Give each a reproduction attempt in Stage 2b after the mandatory targets and the gates and before any discretionary test, and record its outcome in the Carried Review Findings table. A reproduced one goes into Bug Findings at the reviewer's severity: a medium is an Open bug and fails the verify, a low is recorded as Left open and does not.

${recordedCarried.join('\n')}`
  : ''

const carriedBlock = `${unresolvedBlock}${recordedBlock}`

// Prompt-scoped narrowing of Stage 2. The verifier's contract permits it only
// on an explicit instruction like this one — never on its own judgment — and
// carried findings stay mandatory targets regardless of depth.
const depthBlock = verifyDepth === 'criteria-only'
  ? `

## Verification depth: criteria-only

This run's profile${profileName ? ` (${profileName})` : ''} narrows Stage 2: skip test-framework discovery (2a), the discretionary risk-category adversarial tests, and the anti-pattern scan (2c). Stage 1 (every acceptance criterion, real commands) and Stage 3 (VERIFY.md + verdict) run in full, and the verdict rules are unchanged. The trial merge with main and the repo checklist from .planning/verify-checklist.md still run at this depth; only the generic checklist items are skipped. EXCEPTION: any findings under 'Unresolved Review Findings' above remain mandatory Stage 2b targets at this depth — narrowing never waives them. Record the narrowing in VERIFY.md's Stage 2 section per your instructions.`
  : ''

// The verifier sweeps each bug for its siblings, so one fix task covers the
// class. Stated in the prompt as well as the agent file because the go path is
// where the repeated rounds happened.
const sweepBlock = `

## One bug per defect class

For every bug you record at medium or above, name its defect class in \`pattern\` and search the feature's changed files for every other occurrence before you write the fix task. List each occurrence in \`sites\` (file:line). One bug — and one fix task — per pattern, covering every site. A fix round that repairs one call site of a class and leaves the rest for the next verify is the most expensive loop this workflow has.`

let verdict = null
let sync = null
if (!stoppedAt) {
  phase('Verify')
  if (syncMain) {
    sync = await safeAgent(syncPrompt, {
      agentType: 'ship:ship-builder', schema: SYNC_SCHEMA, label: 'sync:main', phase: 'Verify',
    })
    log(`sync:main → ${sync ? sync.outcome : 'no result'}${sync && sync.commit ? ` (${sync.commit})` : ''}`)
  }
  const verifyFull = `Verify feature: ${feature}\n\nRead .planning/features/${feature}/CONTEXT.md and PLAN.md, then verify acceptance criteria, hunt bugs with adversarial tests, run the trial merge with main and the verify checklist (generic items plus .planning/verify-checklist.md if present), scan for anti-patterns, and write VERIFY.md per your instructions.${carriedBlock}${depthBlock}${sweepBlock}`
  verdict = await safeAgent(verifyFull, {
    agentType: 'ship:ship-verifier', schema: VERIFY_SCHEMA, label: 'verify', phase: 'Verify',
    retryPrompt: salvageVerifyPrompt(verifyFull), salvageRecord: '.review-scratch/verify.json',
  })
  // Trust the findings over the verdict: a PASS or INCONCLUSIVE that still
  // carries an Open bug, a failed checklist item, or a failed trial merge is
  // contradictory. #236 shipped PASS 7/7 with 4 Open bugs in its own report.
  // The verifier's rules already say any Open bug fails; this enforces it
  // mechanically, for fresh and salvaged verdicts alike. A FAIL or a clean
  // PASS passes through as the same object. A low bug is Left open, not Open:
  // each fix round is reviewed again and a reviewer can always find one more
  // low, so letting lows fail the verify looped one feature through four FAILs
  // with every criterion passing.
  if (verdict && (verdict.status === 'PASS' || verdict.status === 'INCONCLUSIVE')) {
    const openBugs = (verdict.bugs || []).filter((b) => !b || b.severity !== 'low').length
    const failedItems = (verdict.checklist || []).filter((row) => row && row.verdict === 'FAIL').length
    const mergeFailed = !!(verdict.trial_merge && verdict.trial_merge.outcome === 'FAIL')
    if (openBugs > 0 || failedItems > 0 || mergeFailed) {
      const parts = []
      if (openBugs > 0) parts.push(`${openBugs} open bug(s)`)
      if (failedItems > 0) parts.push(`${failedItems} failed checklist item(s)`)
      if (mergeFailed) parts.push('trial merge failed')
      const original = verdict.status
      verdict = {
        ...verdict,
        status: 'FAIL',
        downgraded_from: original,
        downgrade_reason: `${parts.join(', ')} reported under a ${original} verdict`,
      }
      log(`Verify downgraded ${original} → FAIL: ${verdict.downgrade_reason}.`)
    }
  }
  // A verifier lost to the same outage is reported through the one
  // INFRASTRUCTURE rendering path — as a pseudo-phase, since `stoppedAt` is the
  // only channel the go skill renders — rather than as a bare null verdict the
  // report would have to explain some other way.
  //
  // The test here is the *classification*, not `MAX_TRANSPORT_RETRIES`. The cap
  // counts deaths per `safeAgent` call, and verification is a single call that
  // has already spent both of its attempts on the outage, so a plain verifier
  // outage leaves the counter at 1 and a cap test would never fire — dropping
  // the run back to a null verdict reported as an unrecoverable `error`. One
  // classified death here is already the sustained outage the cap exists to
  // detect on the multi-round build path.
  //
  // The message rarely carries the cause (see MAX_BLIND_ROUNDS), and the verify
  // path has no progress probe to double as one, so an unclassified double
  // death asks the canary: a verifier can spend two turn budgets, a one-call
  // agent cannot. The canary's own failure text is not what is reported — it is
  // the same generic message — so the verifier's is kept.
  let verifyOutage = null
  if (!verdict && lastFailure && lastFailure.transport) {
    verifyOutage = `the verifier died on a transport error after both attempts: ${lastFailure.message}`
  } else if (!verdict) {
    const verifierFailure = lastFailure
    const alive = await safeAgent(canaryPrompt, {
      agentType: 'Explore', schema: CANARY_SCHEMA, phase: 'Verify', effort: 'low',
      label: 'canary:verify', retry: false,
    })
    if (!alive) {
      verifyOutage = `the verifier died on both attempts and a one-call connection check died after it — the connection or the usage limit failed, not the verification${verifierFailure ? ` (last error: ${verifierFailure.message})` : ''}`
    }
  }
  if (verifyOutage) {
    stoppedAt = {
      phase: { id: 'verify', name: 'verify' },
      build: {
        status: 'INFRASTRUCTURE',
        tasks_completed: 0, tasks_total: 0, commits: [],
        stopped_at: 'verify',
        reason: verifyOutage,
        recommendation: infraRecommendation,
      },
    }
    log('Verify stopped: the verifier died on a transport error — the build is intact, the connection is not.')
  }
}

return { feature, stoppedAt, completed, verdict, salvageEvents, sync }
