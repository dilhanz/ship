---
name: ship:go
description: Use when you want to auto-run all remaining Ship steps for a feature without manual step-by-step invocation
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Workflow, TaskOutput, TaskStop, ToolSearch, Skill, AskUserQuestion
argument-hint: "[feature-name] [--auto] [--headless] [--profile <quick|standard|thorough>]"
---

Auto-run all remaining steps for the active feature. Round-1 planning and the finish step run inline here; the plan revision loop and the build→verify spine each run in a Workflow, so per-agent output never enters this conversation.

Pass `--auto` for a fully hands-off run: it skips the "Ready to build?" approval gate. Everything else is unchanged — `--auto` never suppresses a `NEEDS_INPUT` question, which is the one interruption the plan loop can raise.

Pass `--headless` for unattended runs (e.g. a spawned `claude -p`) where no interactive prompt can fire. `--headless` implies `--auto`, and additionally degrades every interactive point deterministically per the contract in `${CLAUDE_PLUGIN_ROOT}/ship/docs/headless.md` — read that file when the flag is present; it is the contract of record for QUESTIONS.md, OUTCOME.json, the outcome vocabulary, and the workflow wait rule below.

### Headless workflow wait (every Workflow invocation)

**The Workflow tool does not return the workflow's result.** It launches the workflow in the background and returns a Task ID immediately; the result arrives later as a completion notification.

Interactively that is fine and **must not change**: report that the workflow is running and end the turn — the session outlives it, `/workflows` shows progress, and the notification lands back here. Blocking an interactive run for the length of a build would be a worse bug than the one this rule fixes.

Under `--headless` it is fatal. `claude -p` exits when the turn ends, so a turn that ends mid-workflow kills or orphans it: the run exits cleanly having produced no outcome, leaves CONTEXT.md mid-flight, and can leave agent processes still writing to the worktree after the caller believes it finished.

So under `--headless`, after EVERY Workflow invocation in this skill — section 2a's plan loop and section 5's build→verify spine alike — do not end the turn until that workflow is terminal:

1. Take the Task ID from the Workflow tool result (it reports `Task ID: {id}`).
2. If the completion notification already arrived while you were still in the launching turn — short workflows do finish that fast — the result is in hand. Skip to reconciling it.
3. Otherwise call `TaskOutput` with `{ task_id, block: true, timeout: 600000 }`. 600000 ms is that tool's maximum, not a tuning choice. `TaskOutput` and `TaskStop` may be deferred tools in this harness — load them first with `ToolSearch` using `select:TaskOutput,TaskStop`.
4. Read the reply's `<status>`. A build spine routinely outlasts ten minutes, so one call is not enough: while the status is still running, repeat step 3 — up to **12 calls** (a 2-hour ceiling). On `completed`, the reply's `<output>` carries `result` — the workflow's own return value, the same `{ feature, stoppedAt, completed, verdict, salvageEvents }` (or plan-loop) object you would have received from a notification. Reconcile from that; do not wait for a separate notification on top of it. The payload is a compact summary, not an agent transcript, so reading it costs nothing.
5. If the ceiling is reached with the task still running, call `TaskStop` on the Task ID **before** terminating, then terminate as `error` per section 6 with detail `workflow exceeded the 2-hour headless wait cap`. Stopping first is what holds the guarantee that nothing is still writing to the worktree once the run returns.

The structured result you then reconcile is unchanged — only *when* you receive it changes.

## 1. Find the Active Feature

First parse flags out of `$ARGUMENTS`: strip `--auto` and `--headless` (recording whether each was present, in any argument order) *before* resolving the feature name, so `/ship:go my-feature --auto`, `/ship:go --auto my-feature`, `/ship:go --headless my-feature`, and `/ship:go --auto` all work. `--headless` sets `--auto`.

Also strip `--profile {value}` in the same pass — both the `--profile quick` and `--profile=quick` forms, in any argument order — recording the value for section 1b. Whatever remains after all flags are stripped is the feature name.

Feature state is injected at session start ("SHIP ACTIVE FEATURES"). If the remaining `$ARGUMENTS` names a feature, use it. Otherwise pick the one feature whose CONTEXT.md `status` is not `done`. If several are unfinished, ask which. If none exist, tell the user to run `/ship:start`. Under `--headless`, resolution must never ask: if several features are unfinished and none was named, or none exist, terminate with outcome `error` and a detail line naming the problem (per the headless termination rule in section 6).

**Headless preamble:** when `--headless` is present, immediately after resolving the feature delete `.planning/features/{name}/OUTCOME.json` if it exists — the run's first act. A fresh one is written as the run's last act, so a missing file after the process exits signals a mid-flight death. From here on, every terminal path in this skill must end via the **headless termination** rule defined in section 6.

## 1b. Resolve the Workflow Profile

Once the feature name is resolved, resolve the workflow profile for this run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/resolve-profile.cjs" {name}
# with the flag present, append it:
node "${CLAUDE_PLUGIN_ROOT}/ship/resolve-profile.cjs" {name} --profile {value}
```

It prints a single line of JSON: `{ profile, source, warning, knobs: { reviewGate, verifyDepth, maxBuildRounds, maxPlanRounds } }`. Parse it.

**Precedence: flag > CONTEXT.md `profile:` frontmatter > standard.** An absent field resolves to `standard`, which is exactly today's behavior; an unrecognized value resolves to `standard` with a `warning`. The helper always exits 0 with valid JSON — resolution never asks a question and never stops the run.

If `warning` is non-null, surface it: interactively, say it before continuing; under `--headless`, include it in the final report and `detail`.

The resolved `knobs` feed the workflow `args` in sections 2a and 5. On `standard` every knob equals today's constant, so a standard run is byte-identical to a run from before profiles existed.

## 2. Advance Pre-Build Steps (inline)

Route on the feature's `status` and run these inline, in order, until the feature reaches `plan-verified`:

| Status | Action |
|--------|--------|
| `brainstormed` | Invoke the `/ship:plan` skill. On success the status becomes `planned`. |
| `planned` | Run the plan loop (section 2a). |
| `done` | Invoke `/ship:finish` and stop. Under `--headless`, do NOT invoke `/ship:finish` — terminate with outcome `done` and detail "feature already done; finish is never attempted headlessly". |

(`brainstormed` requires that `/ship:start` already ran — `go` does not brainstorm; an interview can't run unattended.)

## 2a. Plan Loop (workflow)

**Headless pre-check:** under `--headless`, before invoking the workflow, check for `.planning/features/{name}/QUESTIONS.md` and run the answer round-trip in **`ship/docs/headless.md` §7**, which is the contract for all three cases: answered → feed `answers` + `roundOffset` (plus `maxPlanRounds: {knobs.maxPlanRounds}`, exactly as on the initial invocation) into the workflow and archive the file; unanswered → terminate as `needs-input` (detail: "QUESTIONS.md awaiting answers", `questions_file` set) without re-running the loop; absent → invoke normally.

Invoke the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/ship/workflows/plan.workflow.js",
  args: { feature: "{name}", maxPlanRounds: {knobs.maxPlanRounds} }
})
```

`maxPlanRounds` is the resolved knob from section 1b, passed as a real JSON number (not a string). It must appear on **every** plan.workflow invocation — the initial one here, the interactive `NEEDS_INPUT` re-invocation below, and the headless answered-file resume — or a quick-profile loop resumes at the default cap of 5 instead of 2. Omitting it entirely yields today's 5.

Under `--headless`, block on the returned Task ID before reading the result — see **Headless workflow wait** above. Interactively, behave as before.

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
  - **Interactive (no `--headless`)** — ask each entry in `questions` via AskUserQuestion (one question per entry, using its `options`; the automatic Other option covers anything else). Then RE-INVOKE the same workflow with `args: { feature: "{name}", answers: "<Q/A transcript>", roundOffset: <total rounds spent so far across all invocations>, maxPlanRounds: {knobs.maxPlanRounds} }` and re-branch on the new status. The `roundOffset` is what keeps the replanner's `### Round {n}` headings unique across re-invocations — without it a second run restarts at `### Round 1` and collides with the first run's subsection, which the replanner is forbidden to rewrite. Do **not** use `resumeFromRunId`. Cap this at 2 re-invocations; if a third `NEEDS_INPUT` arrives, report it and stop.
  - **Headless** — do NOT call AskUserQuestion. Write `.planning/features/{name}/QUESTIONS.md` in the format specified in **`ship/docs/headless.md` §6**, recording `roundOffset` as the total plan-loop rounds spent so far across all invocations. Leave CONTEXT.md at `planned` and terminate as `needs-input` with `questions_file` set.
  - **Cap (headless)** — answered-file resumes count against the same 2 re-invocation cap (**§7**). A 3rd `NEEDS_INPUT` under `--headless` terminates as `needs-input` with detail "re-invocation cap reached — escalate to a human" — and still writes the new QUESTIONS.md so the questions are not lost.
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
  args: {
    feature: "{name}",
    phases: [ {id, name}, ... ],
    profile: "{profile}",
    reviewGate: {knobs.reviewGate},
    verifyDepth: "{knobs.verifyDepth}",
    maxBuildRounds: {knobs.maxBuildRounds}
  }
})
```

The four policy fields come from section 1b. Pass them as **real JSON values** — `reviewGate` a boolean, `maxBuildRounds` a number, `profile`/`verifyDepth` strings. `profile` is display-only (it labels records); the other three drive behavior, and each defaults inside the workflow to today's value when absent.

Under `--headless`, block on the returned Task ID before reading the result — see **Headless workflow wait** above. This is the invocation the wait rule exists for: the build→verify spine is the long one, and a headless turn that ends here strands it. Interactively, behave as before — report that it is running and end the turn.

The workflow builds each phase (builder → reviewer re-verify+review → one fix round for critical/high findings → re-review), then runs the merged verifier (acceptance criteria + adversarial bug hunt → VERIFY.md). It returns `{ feature, stoppedAt, completed, verdict, salvageEvents }`. Agent output stays inside the workflow — you receive only this structured result.

`salvageEvents` is one entry per salvage retry — `{ agent, record, outcome }`, where `outcome` is `adopted`, `rejected`, `unknown`, or `no-result`. It is empty on a run where nothing was lost in transit, which is the common case.

Each phase in `completed` carries the review's own evidence — `verifyRuns` and `filesReviewed` — alongside its `findings`. A fix round that lands no commits gets no re-review (there would be no diff to read, and an approving re-review over an empty tree would read as "fixed"); its findings come back `unresolved` with a concern instead.

A builder that runs out of turn budget mid-phase does not stop the run: the workflow continues the phase with fresh builders (up to 5 rounds) as long as tasks keep landing, and reports the round count per phase as `builderRounds`. It only stops when a whole round lands nothing new.

## 6. Reconcile & Report

From the returned result:

1. For each phase in `completed`, mark its `<phase>` `status="done"` in PLAN.md (skip the `all` pseudo-phase).
2. Persist review findings to `.planning/features/{name}/REVIEW.md` (create on first append), same format as the manual build skill: a `## Phase {id} — {phase-name} (round 1)` heading with `Status: {reviewStatus}`, then the two evidence lines from `verifyRuns` and `filesReviewed` — `Verify: {N} re-run — {P} pass, {F} fail, {X} not runnable` and `Reviewed: {M} file(s)` — then one line per finding: `- [{severity}] {file}: {description} — {marker}`. Marker: `new (round 2)` if the finding appears in that phase's `introducedByFix` list; `unresolved` if it appears in `unresolved`; `fixed in fix round` for other critical/high findings when `fixApplied` is true; `recorded` otherwise. Write the heading and evidence lines for **every** phase, including ones with an empty `findings` array — a phase approved with `Verify: 0 re-run` and `Reviewed: 0 file(s)` is exactly the record worth keeping, and `reviewStatus: SKIPPED` must appear as `Status: SKIPPED` so REVIEW.md durably records that the diff went unreviewed.

   **Skipped by profile:** when a phase's `reviewStatus` is `SKIPPED_BY_PROFILE`, write `Status: SKIPPED (profile: {profile})` and, in place of the two evidence lines, the single line `Review skipped by profile — no reviewer ran by design.` This is deliberately distinct from a bare `Status: SKIPPED`, which continues to mean the review was supposed to run and failed. An audit must be able to tell a traded-away review from a broken one.
3. Delete `.planning/features/{name}/.review-scratch/` if it exists. It is the reviewers' crash-recovery cache for the run that just finished — once REVIEW.md carries the findings, a stale scratch file would let a future run's salvage retry report findings from the wrong build.
4. Collect any per-phase `unresolved` review findings (critical/high that survived the fix round) and builder `concerns` across `completed`. These must be surfaced in the report below — a phase is marked `done` even when it carries unresolved findings (one fix round only, the verifier is the backstop), so the user needs to see them.

   The workflow already handed those findings to the verifier in its prompt, as mandatory Stage 2b targets — REVIEW.md is written here, *after* the workflow returns, so on this path the verifier could not have read them off disk. That ordering is why the handoff lives in the prompt. When a `verdict` is present, cross-check it: an unresolved critical/high finding should appear in VERIFY.md's Carried Review Findings table as reproduced, not reproduced, or not testable. If the table is missing or does not account for one, say so in the report — the backstop did not close.
5. **If `stoppedAt` is set** (a build phase returned `CHECKPOINT`, `NEEDS_CONTEXT`, `EXHAUSTED`, or `INFRASTRUCTURE`): leave CONTEXT.md `status: building` and report the blocker, including `stoppedAt.build.commits` — a stopped phase is usually partially built, and those commits are real. For `NEEDS_CONTEXT`, tell the user to run `/ship:build {name}` — the manual build handles interactive context collection (the unattended workflow cannot prompt mid-run). For `EXHAUSTED`, the phase outlived several builders without finishing: report `tasks_completed / tasks_total`, and suggest `/ship:build {name}` to continue or `/ship:plan {name}` to split the remaining tasks into smaller ones.

   **`INFRASTRUCTURE`** — the run lost its connection to the API: several consecutive agents died on a transport error (`ENOTFOUND`, `ECONNRESET`, a 5xx, an overload) having done no work. Nothing about the plan is wrong and every committed task is preserved. Leave CONTEXT.md `status: building`, report `stoppedAt.build.reason` (it names the actual transport error) and the commits that landed, and recommend re-running `/ship:go {name}`. Do **NOT** suggest splitting tasks into smaller ones or running `/ship:plan {name}` — that is `EXHAUSTED`'s advice, and giving it here is the exact confusion this status exists to end: an outage was previously reported as a spent turn budget, and operators went off resizing tasks that were fine. `stoppedAt.phase.id` may be `verify`, meaning the outage took the verifier rather than a build phase; the recommendation is the same.
6. **If a `verdict` is present:** the verifier already set CONTEXT.md status (`done` on PASS/INCONCLUSIVE/DEFERRED, `plan-verified` + fix tasks on FAIL). Report it.

   A `DEFERRED` verdict means one or more acceptance criteria target shared `.project-manager/` state, which no lane may write — the requested edits are recorded in `verdict.pm_handoff`. Report it as a completed build with pending PM work, never as a failure, and never re-run the workflow to "fix" it: no builder can clear a deferral, so a retry would spend a full build→verify cycle to arrive back here unchanged. If `verdict.criteria_deferred` is non-zero but `verdict.pm_handoff` is null, say so — the deferral went unrecorded.
7. **If `verdict` is null and nothing stopped:** all phases built but the verifier produced no result (it crashed or was skipped — the workflow retries once, then degrades to null). Set CONTEXT.md `status: built`, check `git log` to confirm the build commits landed, and tell the user to run `/ship:verify {name}` manually.
8. Whatever the outcome, run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` once here to sync PM state against the settled CONTEXT.md status (silent no-op when `.project-manager/` is absent) — this covers the status the verifier set inside the workflow.

```
## GO COMPLETE

Feature: {name}
Final status: {status}
[If the resolved profile is not `standard`:] Profile: {profile} (review gate: {on|off}, verify depth: {verifyDepth}, build rounds: {maxBuildRounds})
Phases built: {N} / {total}   Review fixes applied: {count}
Verify: {PASS | FAIL | INCONCLUSIVE | DEFERRED — criteria_passed/criteria_total, bugs by severity}

[If any unresolved review findings:] Unresolved review findings (marked done anyway, one fix round only — handed to the verifier as mandatory targets):
- {phase id}: [{severity}] {file} — {description} → {verifier outcome from VERIFY.md, or "not accounted for in VERIFY.md"}
[If any builder concerns:] Build concerns:
- {phase id}: {concern}
[If salvageEvents is non-empty:] Salvage events:
- {agent}: {record} → {adopted | rejected | unknown | no result}
[If any phase whose reviewStatus is NOT `SKIPPED_BY_PROFILE` has an empty verifyRuns and empty filesReviewed:] Unsubstantiated review verdicts: phase {id} approved with no verify re-runs and no files reviewed.
[If any phase's reviewStatus is `SKIPPED_BY_PROFILE`:] Review gate off by profile ({profile}): no reviewer ran for phase(s) {ids} — the verifier was the only gate.

[If verdict DEFERRED:] Deferred to the PM layer ({verdict.criteria_deferred} criteria): {verdict.pm_handoff.edits} shared .project-manager/ edit(s) recorded in {verdict.pm_handoff.path}. No lane can apply these — run /ship:pm apply from the main worktree.

[If verdict PASS/INCONCLUSIVE/DEFERRED:] Ready to finish — run /ship:finish (or I can run it now).
[If FAIL:] Fix tasks were appended to PLAN.md as a pending fix phase. Review them, then /ship:go to continue (or /ship:build for manual control).
[If stoppedAt:] Stopped at phase {id}. Reason: {status}{, tasks_completed/tasks_total if EXHAUSTED}. Commits landed: {stoppedAt.build.commits}. Next: {suggested action}.
   An `INFRASTRUCTURE` stop reports the transport cause from `stoppedAt.build.reason` and the `/ship:go {name}` re-run recommendation instead of task counts — the counts are not what stopped it.
[If any phase has builderRounds > 1:] Note: phase {id} needed {builderRounds} builder rounds (tasks are large enough to outlive one turn budget).
```

An `adopted` salvage event is the machinery working — a lost result recovered for a few thousand tokens instead of a ~90k-token re-run; a `rejected` one means the record did not match this build and the work was redone from scratch. Surfacing both is what makes the next field audit a read of this report rather than a reconstruction from session transcripts.

Under `--headless`, the fenced `ship_outcome` block (headless termination rule below) follows the GO COMPLETE report and is the final message's last content.

### Headless termination (every terminal path)

Under `--headless`, EVERY terminal path in this skill — the resolution/`done` routing in sections 1–2, the plan-loop terminals in 2a, build stops, verify verdicts, and errors — ends the same way. As the run's LAST act, write `.planning/features/{name}/OUTCOME.json` per the schema in **`ship/docs/headless.md` §4**, taking `outcome` from the table below and `status` from the settled CONTEXT.md. Then end the final message with a fenced block tagged `ship_outcome` containing the exact same JSON. Interactive runs never write this file.

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
| Build `stoppedAt` INFRASTRUCTURE | `infrastructure` — CONTEXT.md stays `building`; the `detail` names the transport cause from `stoppedAt.build.reason` and the `/ship:go {name}` re-run. Never `exhausted`: nothing needs resizing |
| Verdict PASS / INCONCLUSIVE | `done` |
| Verdict DEFERRED | `deferred` — build complete, shared `.project-manager/` edits pending; set `handoff_file` to the PM-HANDOFF.md path and name `/ship:pm apply` in `detail`. Never `done`: a caller that reads `done` archives the lane and the handoff rots |
| Verdict FAIL | `verify-fail` — fix tasks are already in PLAN.md; go never auto-retries, the caller decides |
| Null verdict, nothing stopped | `error` — detail names the manual `/ship:verify {name}` follow-up |
| Unrecoverable skill-level failure (workflow crash, unresolvable feature) | `error` |
| Workflow still running at the 2-hour wait ceiling | `error` — call `TaskStop` on the Task ID first, then terminate |

## 7. Finish (interactive)

If the verdict is PASS, INCONCLUSIVE, or DEFERRED, offer to run `/ship:finish` (PR/merge/keep is outward-facing — confirm before acting). Do not finish automatically without the user's go-ahead.

Under `--headless`, skip this section entirely: PASS/INCONCLUSIVE terminates as `done` and DEFERRED as `deferred`, with the finish offer suppressed — PR/merge stays human-gated, and the `detail` notes `/ship:finish` is the manual next step.

$ARGUMENTS
