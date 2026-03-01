# Build Workflow

Orchestrate feature implementation by invoking the ship-builder agent. The agent runs in an isolated sub-agent context, preserving the main conversation's context window.

## Prerequisites

Before starting, verify:
1. An active feature exists with `status: planned` or `status: building` in CONTEXT.md
2. `.planning/features/{name}/PLAN.md` exists with pending tasks
3. Git is initialized and working directory is clean (no uncommitted changes)

If prerequisites fail, stop and tell the user what's missing.

## Phase Detection

Before invoking the builder, check if PLAN.md contains `<phase>` elements:

- **If phased:** Find the first phase with `status` != `done`. That is the current phase. When starting, mark it `status="building"` in PLAN.md.
- **If flat (no phases):** No phase filtering needed.

If no non-done phase exists and all tasks are done, skip to Completion.

## Execute

Invoke the `ship-builder` agent with:
- **Feature name:** `{name}`
- **Phase:** `{phase-id}` and `{phase-name}` (if phased, otherwise omit)

The agent will execute all pending tasks in scope, verify each one, commit atomically, and return a BUILD RESULT.

## Handle Result

Parse the agent's `## BUILD RESULT` output:

### Status: COMPLETE

**If phased:**
1. Mark the current phase `status="done"` in PLAN.md
2. Check if more phases remain (any phase with `status` != `done`)
3. **If more phases remain:** Leave CONTEXT.md status as `building` and output:

```
## PHASE COMPLETE

Feature: {name}
Phase: [M] / [total] — [phase name]
Tasks completed: [N] / [N] in this phase
Commits: [list short hashes]

Next: /ship:build (for next phase)
```

4. **If all phases are done:** Proceed to Completion below.

**If flat:** Proceed to Completion below.

### Status: CHECKPOINT

1. Leave CONTEXT.md status as `building`
2. Output:

```
## CHECKPOINT REACHED

Feature: {name}
Tasks completed: [N] / [M]
Stopped at: Task [id] — [task name]
Reason: [from agent result]

Recommendation: [from agent result]
```

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
