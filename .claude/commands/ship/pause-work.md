---
description: Pause current Ship execution and save state for safe resumption.
allowed-tools: Read, Write, Edit, Glob
---

Save execution state so the project can be safely resumed in a new context window.

This command is typically triggered when context is running low (via the context monitor hook) or manually by the user.

## Process

1. Read `.planning/STATE.md` to determine the current phase number and status.

If `.planning/STATE.md` does not exist, output:
```
No Ship project found in this directory.
Nothing to pause.
```

2. Read `.planning/ROADMAP.md` to understand the full project scope.

3. Read the current phase's plan file (`.planning/NN-PLAN.md`, where NN is the current phase number, zero-padded) to get the full task list.

4. Check recent git log for commits matching the pattern `feat(NN):` to determine which tasks have been committed. Use Glob to find any existing `NN-SUMMARY.md` as well.

5. Write or update `.planning/NN-SUMMARY.md` with a partial-progress summary in this format:

```markdown
# Phase [NN] — [Phase Name] (Partial)

Status: paused
Paused at: [current date/time]

## Completed Tasks

[For each task that has a matching commit:]
- [x] Task description — committed (feat(NN): commit message)

## Remaining Tasks

[For each task that has NOT been committed:]
- [ ] Task description

## In-Progress Notes

[If any task appears partially done — e.g., files modified but not committed — note it here.
Otherwise write "None — paused at a clean boundary."]
```

6. Update `.planning/STATE.md`:
   - Set `Status:` to `paused`
   - Set `Last Action:` to `Paused during phase NN execution — state saved`
   - Set `Next Action:` to `Resume with /ship:resume`

7. Output a clear confirmation message:

```
## Ship — Work Paused

Project: [project name]
Phase: [NN] — [phase name]
Status: paused

Completed: [X] of [Y] tasks committed
Remaining: [Z] tasks

State saved to:
  .planning/STATE.md (status: paused)
  .planning/NN-SUMMARY.md (partial progress)

To resume in a new session, run: /ship:resume
```
