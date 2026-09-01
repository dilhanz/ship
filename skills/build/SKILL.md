---
name: build
description: Use when a feature plan has been verified and is ready for implementation — executes tasks with atomic commits
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, SendMessage, AskUserQuestion
argument-hint: "[feature-name]"
---

Build the active feature by executing its plan phase by phase.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `plan-verified` or `building` (resuming)
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no buildable features were found

## Prerequisites

Before starting, verify:
1. `.planning/features/{name}/PLAN.md` exists with pending tasks
2. Git is initialized and working directory is clean (no uncommitted changes)

If prerequisites fail, stop and tell the user what's missing.

## Pre-Build Context Loading

The Explore digest is conditional — an optimization for large or unfamiliar phases, not a required step.

1. Read `.planning/features/{name}/PLAN.md` in full.
2. Extract all `<files>` elements across all pending tasks. Deduplicate the paths.
3. Filter to files that already exist (skip files the plan creates from scratch — use Glob to check existence; also skip binary, lock, and generated files).
4. **Decide whether a digest is worth it:** skip the digest and use an empty Key File Context block when the phase is small (roughly ≤5 unique existing files across its tasks) or the area is already well understood from this conversation. Delegate to an Explore digest subagent only when the phase touches many or unfamiliar files.
5. **Do NOT Read the candidate file bodies into this conversation.**
6. When the digest runs, delegate the read to the built-in `Explore` agent via the Agent tool — this keeps raw file bodies out of the orchestrator window. Use "medium" search breadth and send it this prompt:

   ```
   Read these files and return ONLY a `## Key File Context` block: {deduped existing file list}.
   For each file: one sentence on its structure and the patterns/conventions a builder should preserve.
   Do not return file bodies — only the summary block.
   ```

7. Consume ONLY the returned `## Key File Context` summary from the Explore agent. Do not re-read or expand the files.

If the Explore agent errors or returns no usable `## Key File Context`, proceed with an empty Key File Context block and record a "Key File Context unavailable — digest subagent failed" concern; never stop the build. The digest is an optimization, never a gate.

This context block is embedded into each builder agent invocation below.

## Phase Detection

Read PLAN.md and check if it contains `<phase>` elements:

- **If phased:** Identify all phases and their statuses. Find the first phase with `status` != `done`.
- **If flat (no phases):** Treat the entire plan as a single phase.

If all phases/tasks are already done, skip to Completion.

## Execute Phase Loop

For each pending phase (or once for flat plans):

### 1. Mark Phase Building

If phased, mark the current phase `status="building"` in PLAN.md.

Update CONTEXT.md frontmatter to `status: building` (if not already set).

### 2. Invoke Builder Agent

Use the Agent tool to invoke the `ship-builder` agent with this prompt:

```
Build feature: {name}
Phase: {phase-id} — {phase-name}

## Key File Context (from Explore digest)

{paste the Key File Context block from Pre-Build Context Loading here}

Execute all pending tasks in this phase. Read:
- .planning/features/{name}/PLAN.md
- .planning/features/{name}/CONTEXT.md

Follow your instructions for the execution loop, deviation rules, and commit conventions.
```

For flat plans, omit the Phase line.

### 2.5. Auto-Continue While the Phase Is Progressing

After the Agent tool returns, extract the `build_result` JSON block from the builder's output. Look for a fenced code block tagged `build_result` and parse the JSON inside it.

A builder running out of turns mid-phase is expected on large tasks, not a failure: its finished tasks are committed and marked `status="done"` in PLAN.md, so a continuation picks up exactly where it stopped. Two shapes signal it — a `build_result` with status `PARTIAL`, or no parseable `build_result` at all (the agent died mid-turn). Both continue.

**Continuation round** (run for either shape, up to 4 rounds per phase):

1. Read PLAN.md and count tasks in this phase marked `status="done"` — this is the ground truth for progress, not the builder's self-report.
2. **If no pending tasks remain**, the phase is done: treat it as `COMPLETE_WITH_CONCERNS` with the concern "builder exhausted its turn budget without reporting; completion confirmed from PLAN.md", and go to the Review Gate (3.1) using the commit hashes recorded on the phase's done tasks.
3. **If the done-count did not increase since the previous round**, the phase is genuinely stuck — go to BUILDER EXHAUSTED below.
4. Otherwise continue: `SendMessage` to the builder agent (or invoke a fresh `ship-builder` if the agent is gone) with:

   ```
   You were building feature "{name}", phase {phase-id}, and stopped before finishing.
   Read PLAN.md: skip every task marked status="done" and resume from the first pending task
   in this phase. If the working tree has uncommitted changes from an interrupted task,
   finish that task, run its <verify> command, and commit it before moving on.
   When all tasks in this phase are done, emit your build_result JSON block.
   ```

5. Re-parse the result and route it back through this section (a `COMPLETE`/`COMPLETE_WITH_CONCERNS` result ends the loop and goes to ### 3; another `PARTIAL`/no-result starts the next round).

When the phase completes across several rounds, the commits list for the Review Gate is the union of every round's commits — the diff range must cover the whole phase, so take the oldest.

**BUILDER EXHAUSTED** — after 4 continuation rounds, or when a round lands no new done tasks:

```
## BUILDER EXHAUSTED

Feature: {name}
Phase: {phase-id} — {phase-name}
Builder rounds: {N}
Tasks completed: [count from PLAN.md]
Tasks remaining: [count from PLAN.md]

Completed tasks are committed — the phase is partially built.
The remaining tasks are likely too large for one builder's turn budget.
Run /ship:build to continue, or /ship:plan {name} to split them into smaller tasks.
```

- Leave CONTEXT.md status as `building`
- **Stop the loop** — do not continue to the next phase

**If a valid `build_result` JSON with a terminal status is found** (from the original Agent call or any continuation round): proceed to the status handling below (### 3).

### 3. Handle Agent Result

Parse the builder agent's `build_result` JSON block. Extract the `status` field. (`PARTIAL` never reaches here — section 2.5 continues the phase until a terminal status.)

**If status is "COMPLETE":**
Proceed directly to the Review Gate (3.1), then mark the phase done. The orchestrator does not re-run verify commands itself — the ship-reviewer's Step 1 re-runs every phase verify command and treats a failure as a critical finding, which triggers the fix round below.

**If status is "COMPLETE_WITH_CONCERNS":**
Proceed directly to the Review Gate (3.1), then mark the phase done.

### 3.1 Review Gate

1. Compute the phase diff range: take the first commit hash from `result.commits` and run `git rev-parse {first-commit}~1` to get the base. The range is `{base}..HEAD`. If `result.commits` is empty or git rev-parse fails, skip the review with a "review skipped: no diff range" concern and proceed to mark the phase done.
2. Invoke the `ship-reviewer` agent via the Agent tool:

```
Review feature: {name}
Phase: {phase-id} — {phase-name}
Diff range: {base}..HEAD

Review the phase diff per your instructions. Read:
- .planning/features/{name}/PLAN.md
- .planning/features/{name}/CONTEXT.md

Emit your review_result JSON block when done.
```

3. Parse the fenced `review_result` JSON block from the reviewer's output. **If the Agent call errors, or no valid review_result block is found:** do NOT retry. Append to REVIEW.md (format below) a "Review skipped — reviewer failed or returned no parseable result" line for this phase, add "review skipped for phase {id}" to the phase's concerns, and proceed to mark the phase done. A broken reviewer must never block a working build.
**Before branching on `status`, check the review's own evidence.** The block carries `verify_runs` (one entry per re-run verify command, each `pass` / `fail` / `not_runnable`) and `files_reviewed`. Both go into REVIEW.md, and both are read literally:

- If **both are empty**, the reviewer re-ran nothing and read nothing — its verdict is unsubstantiated. Record it in REVIEW.md as given, and add "phase {id} review reported no verify runs and no files reviewed — verdict unsubstantiated" to the phase's concerns. Do not treat it as a clean review, and do not re-run the reviewer.
- If any entry is `not_runnable`, add "phase {id}: {N} of {M} verify command(s) not re-runnable in this environment" to the phase's concerns.

4. **If status is "APPROVED":** append all findings (if any) to REVIEW.md marked `recorded`. Proceed to mark the phase done.
5. **If status is "NEEDS_FIXES":** append all findings to REVIEW.md, then run exactly one fix round:
   a. SendMessage to the **builder** agent (the same agent from step 2 of the phase loop):

```
The phase reviewer found issues that must be fixed before this phase can complete.
Fix ONLY these findings — do not refactor beyond them:

{numbered list of critical and high findings: severity, file, description, recommendation}

For each fix: implement it, re-run the affected task's <verify> command, and commit
with "fix({feature-name}): {short description}". Then emit an updated build_result JSON block.
```

   b. **Check the fix round produced commits before re-reviewing.** If the builder's `build_result` lists no commits (or no parseable result came back), nothing verifiable was fixed: skip the re-review, mark every round-1 critical/high finding `unresolved` in REVIEW.md, add "phase {id} fix builder landed no commits — {N} finding(s) unresolved, no re-review ran" to the phase's concerns, and go to step 6. Sending a reviewer at an empty diff is worse than sending none — it finds a clean tree and approves, which would record those findings as fixed.
   c. With fix commits in hand, SendMessage to the **reviewer** agent: "The builder applied fixes for your critical/high findings. Fix commits: {hashes}. New diff range: {base}..HEAD. Two jobs: (1) confirm from the code whether each critical/high finding from your previous review is actually resolved, re-running the verify commands it touched; (2) review the fix commits as a diff in their own right and report any NEW critical/high problem they introduced, marked `"new_issue": true`. Do not re-review the rest of the phase. Emit an updated review_result JSON block." If this SendMessage fails or returns no parseable review_result, treat all findings from round 1 as unresolved concerns (do not loop).
   d. **One round only.** If the re-review still reports critical/high findings, record them in REVIEW.md as `unresolved` (or `new (round 2)` where `new_issue` is true), add each to the phase's concerns list, and proceed to mark the phase done. Surface unresolved findings in the PHASE COMPLETE output under "Concerns".
6. Update REVIEW.md outcome markers: findings fixed in step 5a get `fixed in {commit-hash}`; medium/low get `recorded`; leftover critical/high get `unresolved`; re-review findings flagged `new_issue` get `new (round 2)`.
7. Delete `.planning/features/{name}/.review-scratch/` if the reviewer created one. It is a crash-recovery cache for a single review; once REVIEW.md carries the findings, a leftover file would let a later run's salvage retry report findings from the wrong build.

**REVIEW.md format** (orchestrator-owned; create `.planning/features/{name}/REVIEW.md` on first append):

```markdown
# Review Log — {feature-name}

## Phase {id} — {phase-name} (round {1|2})
Status: {APPROVED | NEEDS_FIXES | SKIPPED}
Verify: {N} re-run — {P} pass, {F} fail, {X} not runnable
Reviewed: {M} file(s)
- [{severity}] {file}: {description} — {fixed in {hash} | unresolved | new (round 2) | recorded}
```

The `Verify` and `Reviewed` lines come straight from the review's `verify_runs` and `files_reviewed`. They are what makes a verdict auditable after the fact: `Verify: 0 re-run` under an APPROVED heading records that the phase was approved without a single command being executed. The `unresolved` markers are read later — `ship-verifier` treats each one as a mandatory verification target, so the marker is a live handoff, not an archive note.

After the Review Gate completes:
- If phased, mark the current phase `status="done"` in PLAN.md
- Output to the user (use values from the JSON fields):

```
## PHASE COMPLETE

Feature: {result.feature}
Phase: [M] / [total] — [phase name]
Tasks completed: {result.tasks_completed} / {result.tasks_total} in this phase
Overall progress: [done_across_all_phases] / [total_across_all_phases] tasks
Commits: {result.commits joined with ", "}
Review: {APPROVED | {N} findings ({M} fixed, {K} unresolved) | skipped}
Review evidence: {P} verify command(s) re-run ({F} failed, {X} not runnable), {M} file(s) reviewed
```

- For COMPLETE_WITH_CONCERNS, also surface the `concerns` array plus any review concerns:

```
## PHASE COMPLETE (with concerns)

Feature: {result.feature}
Phase: [M] / [total] — [phase name]
Tasks completed: {result.tasks_completed} / {result.tasks_total} in this phase
Commits: {result.commits joined with ", "}
Review: {APPROVED | {N} findings ({M} fixed, {K} unresolved) | skipped}
Review evidence: {P} verify command(s) re-run ({F} failed, {X} not runnable), {M} file(s) reviewed

Concerns flagged by builder:
- {each item from result.concerns}

Continuing to next phase. Review concerns after build completes.
```

- Then **continue the loop** to the next pending phase

**If status is "NEEDS_CONTEXT":**
- Do NOT stop. The builder agent is still alive and holds warm context — collect the missing information and send it back.
- Track how many NEEDS_CONTEXT rounds have occurred for this phase (start at 0, increment each time).

a. Use AskUserQuestion with one question built from `result.missing`: question text "The builder needs missing context to continue: {result.missing} — how should it proceed?", header "Context". Offer 2-4 plausible answer options when `result.missing` implies a choice (e.g. naming, approach, config value); when it is open-ended (e.g. an API key or URL), offer your best-guess options anyway — the user can always select "Other" and type a free-form answer.
b. SendMessage to the builder agent:

```
The user provided the missing context you asked for:

Question: {result.missing}
Answer: {user's answer}

Continue with the remaining tasks in this phase and emit an updated build_result JSON block when done.
```

c. Parse the new build_result from the SendMessage response and route it back through section 3's status handling (COMPLETE → Review Gate 3.1; another NEEDS_CONTEXT → repeat this flow).
d. **Cap: 2 NEEDS_CONTEXT rounds per phase.** On a third NEEDS_CONTEXT in the same phase, stop the loop, leave CONTEXT.md status as `building`, and output:

```
## CONTEXT NEEDED

Feature: {result.feature}
Tasks completed: {result.tasks_completed} / {result.tasks_total}
Missing: {result.missing}

Provide the missing information, then run /ship:build to continue.
```

   Also append: "The builder asked for context 3 times in this phase — the plan likely has a gap. Consider /ship:plan {name} to replan."

**If status is "CHECKPOINT":**
- Leave CONTEXT.md status as `building`
- Output to the user using `stopped_at`, `reason`, and `recommendation` fields:

```
## CHECKPOINT REACHED

Feature: {result.feature}
Tasks completed: {result.tasks_completed} / {result.tasks_total}
Stopped at: {result.stopped_at}
Reason: {result.reason}

Recommendation: {result.recommendation}
```

- **Stop the loop** — do not continue to the next phase

## Completion

When all tasks are done (flat plan) or all phases are done (phased plan):

1. Update CONTEXT.md frontmatter to `status: built`
2. Output:

```
## BUILD COMPLETE

Feature: {name}
Tasks completed: [N] / [N]
Commits: [list short hashes]

Next: /ship:verify
```

$ARGUMENTS
