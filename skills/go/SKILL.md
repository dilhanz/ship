---
name: ship:go
description: Use when you want to auto-run all remaining Ship steps for a feature without manual step-by-step invocation
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Workflow, Skill, AskUserQuestion
argument-hint: "[feature-name]"
---

Auto-run all remaining steps for the active feature. The interactive, exploration-heavy steps (brainstorm, plan, plan-verify, finish) run inline here; the repetitive, non-interactive build→verify spine runs in the `go` Workflow so per-agent output never enters this conversation.

## 1. Find the Active Feature

Feature state is injected at session start ("SHIP ACTIVE FEATURES"). If `$ARGUMENTS` names a feature, use it. Otherwise pick the one feature whose CONTEXT.md `status` is not `done`. If several are unfinished, ask which. If none exist, tell the user to run `/ship:start`.

## 2. Advance Pre-Build Steps (inline)

Route on the feature's `status` and run these inline, in order, until the feature reaches `plan-verified`:

| Status | Action |
|--------|--------|
| `brainstormed` | Invoke the `/ship:plan` skill. On success the status becomes `planned`. |
| `planned` | Invoke the `/ship:plan-verify` skill. If APPROVED → `plan-verified`; if NEEDS-REVISION → **stop**, tell the user to `/ship:plan {name}`. |
| `done` | Invoke `/ship:finish` and stop. |

(`brainstormed` requires that `/ship:start` already ran — `go` does not brainstorm; an interview can't run unattended.)

## 3. Plan Approval Gate (interactive)

Fires when status is `plan-verified` (whether plan-verify just ran or the feature was already there). Skip it when resuming from `building`.

1. Read `.planning/features/{name}/PLAN.md`; count tasks and phases.
2. Show a compact summary: feature, task count (and phase count), Must Deliver items, the task list grouped by phase, and the count of any plan-review warnings.
3. AskUserQuestion: "Ready to build?" — options **Proceed** / **Adjust first**.
4. **Adjust first** → stop; tell the user to `/ship:plan {name}` then `/ship:go`.
5. **Proceed** → continue.

## 4. Pre-Build Prep

1. From PLAN.md, build the ordered list of **pending phases** (each `<phase>` whose `status` != `done`, as `{id, name}`). If the plan is flat (no `<phase>` elements), use a single pseudo-phase `{id: "all", name: "all"}`.
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

## 6. Reconcile & Report

From the returned result:

1. For each phase in `completed`, mark its `<phase>` `status="done"` in PLAN.md (skip the `all` pseudo-phase).
2. Collect any per-phase `unresolved` review findings (critical/high that survived the fix round) and builder `concerns` across `completed`. These must be surfaced in the report below — a phase is marked `done` even when it carries unresolved findings (one fix round only, the verifier is the backstop), so the user needs to see them.
3. **If `stoppedAt` is set** (a build phase returned `CHECKPOINT`, `NEEDS_CONTEXT`, or no result): leave CONTEXT.md `status: building` and report the blocker. For `NEEDS_CONTEXT`, tell the user to run `/ship:build {name}` — the manual build handles interactive context collection (the unattended workflow cannot prompt mid-run).
4. **If a `verdict` is present:** the verifier already set CONTEXT.md status (`done` on PASS/INCONCLUSIVE, `plan-verified` + fix tasks on FAIL). Report it.
5. **If `verdict` is null and nothing stopped:** all phases built but the verifier produced no result (it crashed or was skipped — the workflow retries once, then degrades to null). Set CONTEXT.md `status: built`, check `git log` to confirm the build commits landed, and tell the user to run `/ship:verify {name}` manually.

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
[If FAIL:] Fix tasks were appended to PLAN.md. Review them, then /ship:build and /ship:go to continue.
[If stoppedAt:] Stopped at phase {id}. Reason: {status}. Next: {suggested action}.
```

## 7. Finish (interactive)

If the verdict is PASS or INCONCLUSIVE, offer to run `/ship:finish` (PR/merge/keep is outward-facing — confirm before acting). Do not finish automatically without the user's go-ahead.

$ARGUMENTS
