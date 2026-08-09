---
name: ship:go
description: Use when you want to auto-run all remaining Ship steps for a feature without manual step-by-step invocation
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Workflow, Skill, AskUserQuestion
argument-hint: "[feature-name] [--auto]"
---

Auto-run all remaining steps for the active feature. Round-1 planning and the finish step run inline here; the plan revision loop and the build→verify spine each run in a Workflow, so per-agent output never enters this conversation.

Pass `--auto` for a fully hands-off run: it skips the "Ready to build?" approval gate. Everything else is unchanged — `--auto` never suppresses a `NEEDS_INPUT` question, which is the one interruption the plan loop can raise.

## 1. Find the Active Feature

First parse flags out of `$ARGUMENTS`: strip `--auto` (recording whether it was present) *before* resolving the feature name, so `/ship:go my-feature --auto`, `/ship:go --auto my-feature`, and `/ship:go --auto` all work.

Feature state is injected at session start ("SHIP ACTIVE FEATURES"). If the remaining `$ARGUMENTS` names a feature, use it. Otherwise pick the one feature whose CONTEXT.md `status` is not `done`. If several are unfinished, ask which. If none exist, tell the user to run `/ship:start`.

## 2. Advance Pre-Build Steps (inline)

Route on the feature's `status` and run these inline, in order, until the feature reaches `plan-verified`:

| Status | Action |
|--------|--------|
| `brainstormed` | Invoke the `/ship:plan` skill. On success the status becomes `planned`. |
| `planned` | Run the plan loop (section 2a). |
| `done` | Invoke `/ship:finish` and stop. |

(`brainstormed` requires that `/ship:start` already ran — `go` does not brainstorm; an interview can't run unattended.)

## 2a. Plan Loop (workflow)

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

- **`APPROVED`** — set CONTEXT.md `status: plan-verified`. The outcome block additionally lists the examined files and any WARNING/SUGGESTION findings. Continue to the approval gate (section 3).
- **`NEEDS_INPUT`** — ask each entry in `questions` via AskUserQuestion (one question per entry, using its `options`; the automatic Other option covers anything else). Then RE-INVOKE the same workflow with `args: { feature: "{name}", answers: "<Q/A transcript>", roundOffset: <total rounds spent so far across all invocations> }` and re-branch on the new status. The `roundOffset` is what keeps the replanner's `### Round {n}` headings unique across re-invocations — without it a second run restarts at `### Round 1` and collides with the first run's subsection, which the replanner is forbidden to rewrite. Do **not** use `resumeFromRunId`. Cap this at 2 re-invocations; if a third `NEEDS_INPUT` arrives, report it and stop.
- **`STUCK`** — leave CONTEXT.md `status: planned`. Report the surviving CRITICAL findings and the round count, tell the user to run `/ship:plan {name}`, and stop.
- **`UNRESOLVED`** — same as `STUCK`, additionally reporting that all 5 rounds were spent. Stop.
- **`BLOCKED`** — leave CONTEXT.md `status: planned`. Report that an agent produced no result after retry (a plan is never approved without a completed review) and that the run stopped; suggest `/ship:plan-verify {name}` to review once manually. Stop.

**Invariant:** only `APPROVED` advances the status machine. `STUCK`, `UNRESOLVED`, and `BLOCKED` all leave CONTEXT.md at `planned` and never proceed to build.

## 3. Plan Approval Gate (interactive)

Fires when status is `plan-verified` (whether the plan loop just approved it or the feature was already there). Skip it when resuming from `building`, and skip it when `--auto` was passed — without the flag the gate always fires.

1. Read `.planning/features/{name}/PLAN.md`; count tasks and phases.
2. Show a compact summary: feature, task count (and phase count), Must Deliver items, the task list grouped by phase, and the count of any plan-review warnings.
3. AskUserQuestion: "Ready to build?" — options **Proceed** / **Adjust first**. (Skipped entirely under `--auto`: show the summary, note that the gate was skipped, and continue.)
4. **Adjust first** → stop; tell the user to `/ship:plan {name}` then `/ship:go`.
5. **Proceed** → continue.

## 4. Pre-Build Prep

1. From PLAN.md, build the ordered list of **pending phases** (each `<phase>` whose `status` != `done`, as `{id, name}`). If the plan is flat (no `<phase>` elements), use a single pseudo-phase `{id: "all", name: "all"}`. If no pending phases remain but pending `<task>`s exist outside any phase (fix tasks appended by an older verifier), also use the `{id: "all", name: "all"}` pseudo-phase — its builder prompt says to execute all pending tasks in the plan, which sweeps them up.
2. If status is `built` (build already complete, verify only), use an **empty** phase list — the workflow will skip straight to verify.
3. Set CONTEXT.md frontmatter `status: building` (unless already `built`).

## 5. Run the Build→Verify Workflow

Invoke the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/ship/workflows/go.workflow.js",
  args: { feature: "{name}", phases: [ {id, name}, ... ] }
})
```

The workflow builds each phase (builder → reviewer re-verify+review → one fix round for critical/high findings), then runs the merged verifier (acceptance criteria + adversarial bug hunt → VERIFY.md). It returns `{ feature, stoppedAt, completed, verdict }`. Agent output stays inside the workflow — you receive only this structured result.

A builder that runs out of turn budget mid-phase does not stop the run: the workflow continues the phase with fresh builders (up to 5 rounds) as long as tasks keep landing, and reports the round count per phase as `builderRounds`. It only stops when a whole round lands nothing new.

## 6. Reconcile & Report

From the returned result:

1. For each phase in `completed`, mark its `<phase>` `status="done"` in PLAN.md (skip the `all` pseudo-phase).
2. Persist review findings to `.planning/features/{name}/REVIEW.md` (create on first append), same format as the manual build skill: a `## Phase {id} — {phase-name} (round 1)` heading with `Status: {reviewStatus}`, then one line per finding: `- [{severity}] {file}: {description} — {marker}`. Marker: `unresolved` if the finding appears in that phase's `unresolved` list; `fixed in fix round` for other critical/high findings when `fixApplied` is true; `recorded` otherwise. Skip phases with an empty `findings` array — except when `reviewStatus` is `SKIPPED`: an unreviewed phase must still get its heading with `Status: SKIPPED`, so REVIEW.md durably records that the diff went unreviewed.
3. Collect any per-phase `unresolved` review findings (critical/high that survived the fix round) and builder `concerns` across `completed`. These must be surfaced in the report below — a phase is marked `done` even when it carries unresolved findings (one fix round only, the verifier is the backstop), so the user needs to see them.
4. **If `stoppedAt` is set** (a build phase returned `CHECKPOINT`, `NEEDS_CONTEXT`, or `EXHAUSTED`): leave CONTEXT.md `status: building` and report the blocker, including `stoppedAt.build.commits` — a stopped phase is usually partially built, and those commits are real. For `NEEDS_CONTEXT`, tell the user to run `/ship:build {name}` — the manual build handles interactive context collection (the unattended workflow cannot prompt mid-run). For `EXHAUSTED`, the phase outlived several builders without finishing: report `tasks_completed / tasks_total`, and suggest `/ship:build {name}` to continue or `/ship:plan {name}` to split the remaining tasks into smaller ones.
5. **If a `verdict` is present:** the verifier already set CONTEXT.md status (`done` on PASS/INCONCLUSIVE, `plan-verified` + fix tasks on FAIL). Report it.
6. **If `verdict` is null and nothing stopped:** all phases built but the verifier produced no result (it crashed or was skipped — the workflow retries once, then degrades to null). Set CONTEXT.md `status: built`, check `git log` to confirm the build commits landed, and tell the user to run `/ship:verify {name}` manually.

```
## GO COMPLETE

Feature: {name}
Final status: {status}
Phases built: {N} / {total}   Review fixes applied: {count}
Verify: {PASS | FAIL | INCONCLUSIVE — criteria_passed/criteria_total, bugs by severity}

[If any unresolved review findings:] Unresolved review findings (marked done anyway, one fix round only):
- {phase id}: [{severity}] {file} — {description}
[If any builder concerns:] Build concerns:
- {phase id}: {concern}

[If verdict PASS/INCONCLUSIVE:] Ready to finish — run /ship:finish (or I can run it now).
[If FAIL:] Fix tasks were appended to PLAN.md as a pending fix phase. Review them, then /ship:go to continue (or /ship:build for manual control).
[If stoppedAt:] Stopped at phase {id}. Reason: {status}{, tasks_completed/tasks_total if EXHAUSTED}. Commits landed: {stoppedAt.build.commits}. Next: {suggested action}.
[If any phase has builderRounds > 1:] Note: phase {id} needed {builderRounds} builder rounds (tasks are large enough to outlive one turn budget).
```

## 7. Finish (interactive)

If the verdict is PASS or INCONCLUSIVE, offer to run `/ship:finish` (PR/merge/keep is outward-facing — confirm before acting). Do not finish automatically without the user's go-ahead.

$ARGUMENTS
