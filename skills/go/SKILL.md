---
name: ship:go
description: Use when you want to auto-run all remaining Ship steps for a feature without manual step-by-step invocation
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Workflow, Skill, AskUserQuestion
argument-hint: "[feature-name] [--auto] [--headless]"
---

Auto-run all remaining steps for the active feature. Round-1 planning and the finish step run inline here; the plan revision loop and the build→verify spine each run in a Workflow, so per-agent output never enters this conversation.

Pass `--auto` for a fully hands-off run: it skips the "Ready to build?" approval gate. Everything else is unchanged — `--auto` never suppresses a `NEEDS_INPUT` question, which is the one interruption the plan loop can raise.

Pass `--headless` for unattended runs (e.g. a spawned `claude -p`) where no interactive prompt can fire. `--headless` implies `--auto`, and additionally degrades every interactive point deterministically per the contract in `${CLAUDE_PLUGIN_ROOT}/ship/docs/headless.md` — read that file when the flag is present; it is the contract of record for QUESTIONS.md, OUTCOME.json, and the outcome vocabulary.

## 1. Find the Active Feature

First parse flags out of `$ARGUMENTS`: strip `--auto` and `--headless` (recording whether each was present, in any argument order) *before* resolving the feature name, so `/ship:go my-feature --auto`, `/ship:go --auto my-feature`, `/ship:go --headless my-feature`, and `/ship:go --auto` all work. `--headless` sets `--auto`.

Feature state is injected at session start ("SHIP ACTIVE FEATURES"). If the remaining `$ARGUMENTS` names a feature, use it. Otherwise pick the one feature whose CONTEXT.md `status` is not `done`. If several are unfinished, ask which. If none exist, tell the user to run `/ship:start`. Under `--headless`, resolution must never ask: if several features are unfinished and none was named, or none exist, terminate with outcome `error` and a detail line naming the problem (per the headless termination rule in section 6).

**Headless preamble:** when `--headless` is present, immediately after resolving the feature delete `.planning/features/{name}/OUTCOME.json` if it exists — the run's first act. A fresh one is written as the run's last act, so a missing file after the process exits signals a mid-flight death. From here on, every terminal path in this skill must end via the **headless termination** rule defined in section 6.

## 2. Advance Pre-Build Steps (inline)

Route on the feature's `status` and run these inline, in order, until the feature reaches `plan-verified`:

| Status | Action |
|--------|--------|
| `brainstormed` | Invoke the `/ship:plan` skill. On success the status becomes `planned`. |
| `planned` | Run the plan loop (section 2a). |
| `done` | Invoke `/ship:finish` and stop. Under `--headless`, do NOT invoke `/ship:finish` — terminate with outcome `done` and detail "feature already done; finish is never attempted headlessly". |

(`brainstormed` requires that `/ship:start` already ran — `go` does not brainstorm; an interview can't run unattended.)

## 2a. Plan Loop (workflow)

**Headless pre-check:** under `--headless`, before invoking the workflow, check for `.planning/features/{name}/QUESTIONS.md`:

- **Present, every `**Answer:**` line non-empty** — build a Q/A transcript ("Q: {question}\nA: {answer}" per section), invoke the plan workflow with `args: { feature: "{name}", answers: "<transcript>", roundOffset: <the frontmatter roundOffset> }`, and once the workflow has been invoked rename the file to `QUESTIONS-{roundOffset}.answered.md` (the `roundOffset` from its own frontmatter — strictly increasing across re-invocations, so the archive name never collides).
- **Present, any `**Answer:**` line still empty** — terminate immediately as `needs-input` (detail: "QUESTIONS.md awaiting answers", `questions_file` set) without re-running the loop. Re-invoking with an unanswered file is idempotent.
- **Absent** — invoke the workflow normally.

Invoke the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/ship/workflows/plan.workflow.js",
  args: { feature: "{name}" }
})
```

The workflow loops review → replan → re-review for up to 5 rounds (the cap check fires before the replan, so at most 4 replans) and stops early when a round's CRITICAL set repeats. It returns `{ feature, status, rounds, findings, questions?, examined?, history }`. Agent output stays inside the workflow — you receive only this structured result.

### Write the outcome block (every terminal status)

Before branching, record the outcome in `.planning/features/{name}/PLAN.md`: ensure a `## Plan Review` section exists — **create it if absent**, since on a clean round 1 no replanner ran and the section does not exist yet — then append:

```markdown
### Outcome — {status}

**Rounds:** {rounds}
[If `reason` is present:] **Reason:** {reason}
[If `history` is non-empty, one line per round:]
- Round {n}: {reviewStatus}, {criticals} critical
```

`rounds` and `reason` always render: a round-1 `BLOCKED` returns `history: []`, so they are what make that case legible. The per-round lines carry the multi-round cases where no replanner subsection was written.

### Branch on `status`

- **`APPROVED`** — set CONTEXT.md `status: plan-verified`, then run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` to sync PM state (silent no-op when `.project-manager/` is absent). The outcome block additionally lists the examined files and any WARNING/SUGGESTION findings. Continue to the approval gate (section 3).
- **`NEEDS_INPUT`** — split on `--headless`:
  - **Interactive (no `--headless`)** — ask each entry in `questions` via AskUserQuestion (one question per entry, using its `options`; the automatic Other option covers anything else). Then RE-INVOKE the same workflow with `args: { feature: "{name}", answers: "<Q/A transcript>", roundOffset: <total rounds spent so far across all invocations> }` and re-branch on the new status. The `roundOffset` is what keeps the replanner's `### Round {n}` headings unique across re-invocations — without it a second run restarts at `### Round 1` and collides with the first run's subsection, which the replanner is forbidden to rewrite. Do **not** use `resumeFromRunId`. Cap this at 2 re-invocations; if a third `NEEDS_INPUT` arrives, report it and stop.
  - **Headless** — do NOT call AskUserQuestion. Write `.planning/features/{name}/QUESTIONS.md` in the format specified in `ship/docs/headless.md`: YAML frontmatter (`feature`, `roundOffset`: total plan-loop rounds spent so far across all invocations, `created` ISO date); one `### Q{n}: {question}` section per `questions` entry with `**Why blocking:** {why_blocking}`, an `Options:` bullet list of its options, and an empty `**Answer:**` line; then the raw `needs_input` JSON array in a fenced json block. Leave CONTEXT.md at `planned` and terminate as `needs-input` with `questions_file` set.
  - **Cap (headless)** — the 2 re-invocation cap counts answered-file resumes too (a resume exists iff the archived file's `roundOffset` > 0; the recorded rounds-spent count is checkable from the files alone). A 3rd `NEEDS_INPUT` under `--headless` terminates as `needs-input` with detail "re-invocation cap reached — escalate to a human" — and still writes the new QUESTIONS.md so the questions are not lost.
- **`STUCK`** — leave CONTEXT.md `status: planned`. Report the surviving CRITICAL findings and the round count, tell the user to run `/ship:plan {name}`, and stop.
- **`UNRESOLVED`** — same as `STUCK`, additionally reporting that all 5 rounds were spent. Stop.
- **`BLOCKED`** — leave CONTEXT.md `status: planned`. Report that an agent produced no result after retry (a plan is never approved without a completed review) and that the run stopped; suggest `/ship:plan-verify {name}` to review once manually. Stop.

**Invariant:** only `APPROVED` advances the status machine. `STUCK`, `UNRESOLVED`, and `BLOCKED` all leave CONTEXT.md at `planned` and never proceed to build.

On every terminal outcome except `NEEDS_INPUT` (whose re-invocation still needs them — including a headless park, which is terminal for this process but leaves the loop live, so the files are kept exactly as on interactive `NEEDS_INPUT`), delete `.planning/features/{name}/.review-scratch/plan-round-*.json` — the plan reviewers' crash-recovery cache for the loop that just ended. Leaving them is not dangerous (each is fingerprinted with the PLAN.md hash it reviewed, so a salvage retry rejects one that reviewed a different plan) but they serve no further purpose. On `APPROVED`, section 6 clears the whole directory anyway.

## 3. Plan Approval Gate (interactive)

Fires when status is `plan-verified` (whether the plan loop just approved it or the feature was already there). Skip it when resuming from `building`, and skip it when `--auto` was passed — without the flag the gate always fires. (`--headless` implies `--auto`, so the gate is always skipped headlessly.)

1. Read `.planning/features/{name}/PLAN.md`; count tasks and phases.
2. Show a compact summary: feature, task count (and phase count), Must Deliver items, the task list grouped by phase, and the count of any plan-review warnings.
3. AskUserQuestion: "Ready to build?" — options **Proceed** / **Adjust first**. (Skipped entirely under `--auto`: show the summary, note that the gate was skipped, and continue.)
4. **Adjust first** → stop; tell the user to `/ship:plan {name}` then `/ship:go`.
5. **Proceed** → continue.

## 4. Pre-Build Prep

1. From PLAN.md, build the ordered list of **pending phases** (each `<phase>` whose `status` != `done`, as `{id, name}`). If the plan is flat (no `<phase>` elements), use a single pseudo-phase `{id: "all", name: "all"}`. If no pending phases remain but pending `<task>`s exist outside any phase (fix tasks appended by an older verifier), also use the `{id: "all", name: "all"}` pseudo-phase — its builder prompt says to execute all pending tasks in the plan, which sweeps them up.
2. If status is `built` (build already complete, verify only), use an **empty** phase list — the workflow will skip straight to verify.
3. Set CONTEXT.md frontmatter `status: building` (unless already `built`), then run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` to sync PM state (silent no-op when `.project-manager/` is absent).

## 5. Run the Build→Verify Workflow

Invoke the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/ship/workflows/go.workflow.js",
  args: { feature: "{name}", phases: [ {id, name}, ... ] }
})
```

The workflow builds each phase (builder → reviewer re-verify+review → one fix round for critical/high findings → re-review), then runs the merged verifier (acceptance criteria + adversarial bug hunt → VERIFY.md). It returns `{ feature, stoppedAt, completed, verdict }`. Agent output stays inside the workflow — you receive only this structured result.

Each phase in `completed` carries the review's own evidence — `verifyRuns` and `filesReviewed` — alongside its `findings`. A fix round that lands no commits gets no re-review (there would be no diff to read, and an approving re-review over an empty tree would read as "fixed"); its findings come back `unresolved` with a concern instead.

A builder that runs out of turn budget mid-phase does not stop the run: the workflow continues the phase with fresh builders (up to 5 rounds) as long as tasks keep landing, and reports the round count per phase as `builderRounds`. It only stops when a whole round lands nothing new.

## 6. Reconcile & Report

From the returned result:

1. For each phase in `completed`, mark its `<phase>` `status="done"` in PLAN.md (skip the `all` pseudo-phase).
2. Persist review findings to `.planning/features/{name}/REVIEW.md` (create on first append), same format as the manual build skill: a `## Phase {id} — {phase-name} (round 1)` heading with `Status: {reviewStatus}`, then the two evidence lines from `verifyRuns` and `filesReviewed` — `Verify: {N} re-run — {P} pass, {F} fail, {X} not runnable` and `Reviewed: {M} file(s)` — then one line per finding: `- [{severity}] {file}: {description} — {marker}`. Marker: `new (round 2)` if the finding appears in that phase's `introducedByFix` list; `unresolved` if it appears in `unresolved`; `fixed in fix round` for other critical/high findings when `fixApplied` is true; `recorded` otherwise. Write the heading and evidence lines for **every** phase, including ones with an empty `findings` array — a phase approved with `Verify: 0 re-run` and `Reviewed: 0 file(s)` is exactly the record worth keeping, and `reviewStatus: SKIPPED` must appear as `Status: SKIPPED` so REVIEW.md durably records that the diff went unreviewed.
3. Delete `.planning/features/{name}/.review-scratch/` if it exists. It is the reviewers' crash-recovery cache for the run that just finished — once REVIEW.md carries the findings, a stale scratch file would let a future run's salvage retry report findings from the wrong build.
4. Collect any per-phase `unresolved` review findings (critical/high that survived the fix round) and builder `concerns` across `completed`. These must be surfaced in the report below — a phase is marked `done` even when it carries unresolved findings (one fix round only, the verifier is the backstop), so the user needs to see them.

   The workflow already handed those findings to the verifier in its prompt, as mandatory Stage 2b targets — REVIEW.md is written here, *after* the workflow returns, so on this path the verifier could not have read them off disk. That ordering is why the handoff lives in the prompt. When a `verdict` is present, cross-check it: an unresolved critical/high finding should appear in VERIFY.md's Carried Review Findings table as reproduced, not reproduced, or not testable. If the table is missing or does not account for one, say so in the report — the backstop did not close.
5. **If `stoppedAt` is set** (a build phase returned `CHECKPOINT`, `NEEDS_CONTEXT`, or `EXHAUSTED`): leave CONTEXT.md `status: building` and report the blocker, including `stoppedAt.build.commits` — a stopped phase is usually partially built, and those commits are real. For `NEEDS_CONTEXT`, tell the user to run `/ship:build {name}` — the manual build handles interactive context collection (the unattended workflow cannot prompt mid-run). For `EXHAUSTED`, the phase outlived several builders without finishing: report `tasks_completed / tasks_total`, and suggest `/ship:build {name}` to continue or `/ship:plan {name}` to split the remaining tasks into smaller ones.
6. **If a `verdict` is present:** the verifier already set CONTEXT.md status (`done` on PASS/INCONCLUSIVE, `plan-verified` + fix tasks on FAIL). Report it.
7. **If `verdict` is null and nothing stopped:** all phases built but the verifier produced no result (it crashed or was skipped — the workflow retries once, then degrades to null). Set CONTEXT.md `status: built`, check `git log` to confirm the build commits landed, and tell the user to run `/ship:verify {name}` manually.
8. Whatever the outcome, run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` once here to sync PM state against the settled CONTEXT.md status (silent no-op when `.project-manager/` is absent) — this covers the status the verifier set inside the workflow.

```
## GO COMPLETE

Feature: {name}
Final status: {status}
Phases built: {N} / {total}   Review fixes applied: {count}
Verify: {PASS | FAIL | INCONCLUSIVE — criteria_passed/criteria_total, bugs by severity}

[If any unresolved review findings:] Unresolved review findings (marked done anyway, one fix round only — handed to the verifier as mandatory targets):
- {phase id}: [{severity}] {file} — {description} → {verifier outcome from VERIFY.md, or "not accounted for in VERIFY.md"}
[If any builder concerns:] Build concerns:
- {phase id}: {concern}
[If any phase has an empty verifyRuns and empty filesReviewed:] Unsubstantiated review verdicts: phase {id} approved with no verify re-runs and no files reviewed.

[If verdict PASS/INCONCLUSIVE:] Ready to finish — run /ship:finish (or I can run it now).
[If FAIL:] Fix tasks were appended to PLAN.md as a pending fix phase. Review them, then /ship:go to continue (or /ship:build for manual control).
[If stoppedAt:] Stopped at phase {id}. Reason: {status}{, tasks_completed/tasks_total if EXHAUSTED}. Commits landed: {stoppedAt.build.commits}. Next: {suggested action}.
[If any phase has builderRounds > 1:] Note: phase {id} needed {builderRounds} builder rounds (tasks are large enough to outlive one turn budget).
```

Under `--headless`, the fenced `ship_outcome` block (headless termination rule below) follows the GO COMPLETE report and is the final message's last content.

### Headless termination (every terminal path)

Under `--headless`, EVERY terminal path in this skill — the resolution/`done` routing in sections 1–2, the plan-loop terminals in 2a, build stops, verify verdicts, and errors — ends the same way. As the run's LAST act, write `.planning/features/{name}/OUTCOME.json` per the schema in `ship/docs/headless.md`: `schema_version: 1`, `feature`, `outcome` (from the table below), `status` (the settled CONTEXT.md status), `timestamp` (ISO 8601 UTC), `head` (`git rev-parse HEAD` at write time), `detail` (one-line human note), plus `questions_file` on `needs-input`. Then end the final message with a fenced block tagged `ship_outcome` containing the exact same JSON. Interactive runs never write this file.

| Terminal | Outcome |
|----------|---------|
| Plan loop `APPROVED` | not terminal — continue to build |
| Plan loop `NEEDS_INPUT` | `needs-input` |
| Plan loop `STUCK` | `stuck` |
| Plan loop `UNRESOLVED` | `unresolved` |
| Plan loop `BLOCKED` | `blocked` |
| Build `stoppedAt` NEEDS_CONTEXT | `needs-context` |
| Build `stoppedAt` EXHAUSTED | `exhausted` |
| Build `stoppedAt` CHECKPOINT | `checkpoint` |
| Verdict PASS / INCONCLUSIVE | `done` |
| Verdict FAIL | `verify-fail` — fix tasks are already in PLAN.md; go never auto-retries, the caller decides |
| Null verdict, nothing stopped | `error` — detail names the manual `/ship:verify {name}` follow-up |
| Unrecoverable skill-level failure (workflow crash, unresolvable feature) | `error` |

## 7. Finish (interactive)

If the verdict is PASS or INCONCLUSIVE, offer to run `/ship:finish` (PR/merge/keep is outward-facing — confirm before acting). Do not finish automatically without the user's go-ahead.

Under `--headless`, skip this section entirely: PASS/INCONCLUSIVE terminates as `done` with the finish offer suppressed — PR/merge stays human-gated, and the `detail` notes `/ship:finish` is the manual next step.

$ARGUMENTS
