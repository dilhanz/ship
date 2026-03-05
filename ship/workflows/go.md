# Go Workflow

Automatically run all remaining steps for the active feature. Detects current status and continues from where things left off.

## Process

### 1. Find Active Feature

Look in `.planning/features/` for a feature directory. If multiple features exist, find the one that is not `done`:
- Read each `CONTEXT.md` and check the `status` field
- If exactly one non-done feature exists, use it
- If multiple non-done features exist, ask the user which one to continue
- If no features exist, tell the user to run `/ship-start` first

### 2. Determine Next Step

Based on the feature's `status` in CONTEXT.md:

| Status | Next Step |
|--------|-----------|
| `brainstormed` | Run plan (invoke ship-planner agent) |
| `planned` | Run build (follow /ship-build skill instructions) |
| `building` | Resume build (follow /ship-build skill instructions — skip completed tasks) |
| `built` | Run verify (invoke ship-verifier agent) |
| `done` | Nothing to do — feature is complete |

### 3. Execute Remaining Steps

Run each remaining step in sequence: **plan → build → verify**

After each step completes successfully, check the output and continue to the next step.

**Phase-aware building:** When build completes a phase but more phases remain (output shows PHASE COMPLETE instead of BUILD COMPLETE), loop back and continue building the next phase. Repeat until all phases are done or a stop condition is hit.

**Stop conditions:**
- A step reports a blocker (CHECKPOINT REACHED, PLAN HAS ISSUES)
- Verification returns PARTIAL or FAIL (fix tasks were written — the user should review)
- All steps complete (feature is done)

### 4. Report

When finished (or stopped), output:

```
## GO COMPLETE

Feature: {name}
Final status: {status}
Steps completed: [list of steps that ran]

[If done:] Feature is complete!
[If stopped:] Stopped at: [step]. Reason: [explanation]. Next: [suggested action]
```
