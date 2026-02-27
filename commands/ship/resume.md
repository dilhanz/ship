---
description: Resume a Ship project from wherever you left off. Reads state and automatically continues execution.
allowed-tools: Read, Glob
---

Read `.planning/STATE.md` to understand the current position, then automatically resume work.

If `.planning/STATE.md` does not exist, output:
```
No Ship project found in this directory.
Run /ship:new-project to start one.
```

Otherwise:
1. Read STATE.md fully
2. Read ROADMAP.md to understand the full picture
3. Check which phase files exist (Glob `.planning/*.md`) to understand what has been done
4. If STATE.md has an `## Execution Progress` section, note which tasks are already complete — the executor will skip them automatically

### Pre-Resume Validation

Before determining the resumption action, perform these checks:

**Check 1 — Plan file exists (if status is "executing" or "paused"):**
Read the current phase number N from STATE.md. Check if `.planning/NN-PLAN.md` exists (where NN is zero-padded). If it does not exist, output:
```
Error: No plan file found for Phase N (.planning/NN-PLAN.md).
The state says execution is in progress, but no plan exists.
Run /ship:plan-phase N to create a plan first.
```
Stop. Do not proceed with resumption.

**Check 2 — Git branch validation (if status is "executing" or "paused"):**
Run `git branch --show-current` to get the current branch. Read STATE.md for any `Branch:` field. If STATE.md has a `Branch:` field and the current git branch does not match, output:
```
Warning: Expected branch "[expected]" but currently on "[actual]".
Switch to the correct branch before continuing, or proceed with caution.
```
If no `Branch:` field exists in STATE.md, skip this check (no branch tracking was set up).

**Check 3 — Execution Progress validation (if status is "executing" or "paused"):**
If STATE.md has an `## Execution Progress` section, cross-reference the listed tasks against the tasks in `.planning/NN-PLAN.md`. Check:
- Do the task names in Execution Progress match the task names in the plan?
- If any completed task (marked [x]) claims a commit hash, verify the commit exists: `git cat-file -t <hash>`. If the commit does not exist, output:
```
Warning: Execution Progress references commit [hash] for task "[name]" but this commit does not exist in the repository. The state may be stale.
```
If task names do not match the plan at all, output:
```
Error: Execution Progress tasks do not match the current plan.
The plan may have been regenerated after partial execution.
Run /ship:plan-phase N to replan, or clear the Execution Progress section in STATE.md.
```
Stop. Do not proceed with resumption.

Determine the resumption action based on STATE.md status:

| Status | Resumption Action |
|--------|------------------|
| planning | `/ship:plan-phase N` — plan hasn't been written yet |
| executing | If a `Checkpoint:` field exists in STATE.md, show the conflict description and suggest `/ship:plan-phase N` to replan instead of auto-executing. Otherwise, `/ship:execute-phase N` — plan exists, ready to execute (executor will skip completed tasks from Execution Progress) |
| paused | `/ship:execute-phase N` — execution was paused, resume from where it stopped |
| verifying | `/ship:verify-phase N` — execution done, needs verification |
| complete | All phases complete. Run `/ship:complete` or start a new phase with `/ship:add-phase` |

Output a clear resumption message and then **automatically invoke the next command**:

```
## Resuming Ship Project

[Project name] — Phase N of M

You were: [last action from STATE.md]
[If Execution Progress exists: "Tasks completed: X/Y — will resume from task X+1"]

Continuing automatically...
```

Then immediately invoke the appropriate command (e.g., `/ship:execute-phase N`). Do not wait for the user to manually type the next command — the whole point of resume is seamless continuation.

**Exception:** If the status is `complete`, do NOT auto-invoke. Just show the status and suggest next steps.
