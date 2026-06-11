# Go Workflow

Automatically run all remaining steps for the active feature. Detects current status and continues from where things left off.

## Process

### 1. Find Active Feature

Look in `.planning/features/` for a feature directory. If multiple features exist, find the one that is not `done`:
- Read each `CONTEXT.md` and check the `status` field
- If exactly one non-done feature exists, use it
- If multiple non-done features exist, ask the user which one to continue
- If no features exist, tell the user to run `/ship:start` first

### 2. Determine Next Step

Based on the feature's `status` in CONTEXT.md:

| Status | Next Step |
|--------|-----------|
| `brainstormed` | Run plan (invoke /ship:plan skill) |
| `planned` | Run plan-verify (invoke /ship:plan-verify skill) |
| `plan-verified` | Run build (follow /ship:build skill instructions) |
| `building` | Resume build (follow /ship:build skill instructions — skip completed tasks) |
| `built` | Run QA (invoke /ship:qa skill) |
| `qa-passed` | Run verify (invoke /ship:verify skill) |
| `qa-failed` | Resume build (invoke /ship:build skill), then re-run /ship:qa |
| `done` | Run finish (invoke /ship:finish skill) |

### 3. Execute Remaining Steps

Run each remaining step in sequence: **plan → plan-verify → build → qa → verify → finish**

After each step completes successfully, check the output and continue to the next step.

**Phase-aware building:** When build completes a phase but more phases remain (output shows PHASE COMPLETE instead of BUILD COMPLETE), loop back and continue building the next phase. Repeat until all phases are done or a stop condition is hit.

**QA handling:** When QA completes, check the result:
- If PASS (status set to `qa-passed`): continue to verify
- If FAIL (status set to `qa-failed`, fix tasks appended): the user should review the fix tasks and run `/ship:build` to implement them; QA will run again automatically when /ship:go resumes.

**Plan verification:** When plan-verify completes, check the result:
- If APPROVED: continue to the plan approval gate below
- If NEEDS-REVISION: stop and tell the user to replan with `/ship:plan {name}`

**Plan approval gate:** Before starting build, pause and show the user a plan summary. This gate fires whenever the feature status is `plan-verified` — whether plan-verify just completed in this session or the feature was already at `plan-verified` when `/ship:go` started. It does NOT fire when resuming from `building` status (the user already approved).

1. Read `.planning/features/{name}/PLAN.md`
2. Count total tasks and phases
3. Display a compact summary:

```
## PLAN READY — Proceed to Build?

Feature: {name}
Tasks: [N] [in M phases / flat]
Must Deliver:
- [each Must Deliver item from PLAN.md]

Task list:
[each task name, grouped by phase if phased]

Plan review warnings: [N — or "None"]
```

4. Use AskUserQuestion to ask: "Ready to build? This will start implementing the tasks above."
   - Options: "Proceed" (start building now), "Adjust first" (I want to change something before building)
5. If the user chooses "Adjust first": stop the go workflow and tell them to run `/ship:plan {name}` to replan, then `/ship:go` to continue
6. If the user chooses "Proceed": continue to build

**Build status handling:** When a build phase returns, check the status:
- **COMPLETE / COMPLETE_WITH_CONCERNS:** Continue to the next phase. If COMPLETE_WITH_CONCERNS, surface the concerns to the user but keep going.
- **NEEDS_CONTEXT:** Do not stop. The build skill collects the missing information from the user via AskUserQuestion and sends the answer to the still-alive builder via SendMessage (capped at 2 rounds per phase — a third NEEDS_CONTEXT stops the build). Follow the build skill's interactive NEEDS_CONTEXT flow.
- **CHECKPOINT:** Stop. The builder hit an architectural blocker.

**Stop conditions:**
- Plan verification returns NEEDS-REVISION (critical issues found — replan needed)
- Build returns CHECKPOINT (architectural blocker — needs replanning)
- Build hits the NEEDS_CONTEXT round cap (builder asked 3 times in one phase — plan likely has a gap)
- QA returns FAIL (critical/high bugs found — fix tasks written, needs rebuild)
- Verification returns PARTIAL or FAIL (fix tasks were written — the user should review)
- All steps complete (feature is finished)

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
