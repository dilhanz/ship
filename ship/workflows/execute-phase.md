# Workflow: execute-phase

This workflow guides Claude through executing a phase plan. It is invoked by the `/ship:execute-phase [N]` command.

---

## Purpose

Implement all tasks in Phase N's plan, verify each one, commit atomically, and record what was done.

## Prerequisites

- `.planning/NN-PLAN.md` must exist (run `/ship:plan-phase N` first)
- `.planning/STATE.md` must show status "executing" for phase N
- Git must be initialized in the project root

## Steps

### Step 1 — Validate prerequisites

Read `.planning/STATE.md` and `.planning/NN-PLAN.md`.

Check:
- Does the PLAN file exist?
- Is git initialized? (`git status` — if not a git repo, warn the user and ask if they want to initialize one)
- Are there uncommitted changes from outside Ship? (run `git status`) — if yes, warn the user. Executor will be committing frequently; uncommitted changes can cause confusion.

If PLAN file doesn't exist, tell the user to run `/ship:plan-phase N` first.

### Step 2 — Invoke ship-executor

Invoke the `ship-executor` agent with the phase number.

> "Invoking ship-executor for Phase N — [Phase Name]"

The executor will:
- Check STATE.md for prior `## Execution Progress` and skip already-completed tasks
- Execute remaining tasks sequentially
- Run verify commands after each task
- Commit after each verified task
- Update STATE.md `## Execution Progress` after each commit (mid-phase checkpointing)
- Apply deviation rules when needed
- Write `.planning/NN-SUMMARY.md`
- Update STATE.md

### Step 3 — Handle executor output

**If executor returns `## PHASE COMPLETE`:**

Read `.planning/NN-SUMMARY.md` and present:

```
## Phase N Complete

Tasks: N/N
Commits: [list]
Deviations: [N / None]

[If deviations: list them briefly]

Next: /ship:verify-phase N
```

**If executor returns `## CHECKPOINT REACHED`:**

This means an architectural conflict was encountered. Present the checkpoint information clearly:

```
## Checkpoint Reached — Phase N stopped

Completed: N of M tasks

CONFLICT: [Conflict description from executor]

RECOMMENDATION: [Recommendation from executor]

Options:
1. Resolve the conflict, then /ship:plan-phase N (to replan)
2. Resolve the conflict, then /ship:execute-phase N (to resume from checkpoint)
3. /ship:status — see current state
```

Wait for user to decide how to proceed.

---

## Error Handling

**If git is not initialized:** Ask the user if you should initialize it (`git init && git add . && git commit -m "chore: initial commit"`). Don't do it without confirmation.

**If the plan has zero tasks:** Something is wrong with the plan file. Tell the user to re-run `/ship:plan-phase N`.

**If executor gets stuck on a task (Rule 3 applied many times):** The executor should escalate to Rule 4 if a task is fundamentally broken. If you observe the executor attempting the same fix repeatedly (3+ times), intervene: invoke Rule 4 yourself and report the checkpoint.

**If a verify command requires a running server:** Note that some verify commands may need a dev server running. The executor should handle this with `&` backgrounding where needed, but alert the user if manual steps are required.
