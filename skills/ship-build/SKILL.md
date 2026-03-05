---
name: ship-build
description: Execute the implementation plan for the active feature with atomic commits.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
argument-hint: "[feature-name]"
---

Build the active feature by executing its plan phase by phase.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` or `building` (resuming)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no buildable features were found

## Prerequisites

Before starting, verify:
1. `.planning/features/{name}/PLAN.md` exists with pending tasks
2. Git is initialized and working directory is clean (no uncommitted changes)

If prerequisites fail, stop and tell the user what's missing.

## Phase Detection

Read PLAN.md and check if it contains `<phase>` elements:

- **If phased:** Identify all phases and their statuses. Find the first phase with `status` != `done`.
- **If flat (no phases):** Treat the entire plan as a single phase.

If all phases/tasks are already done, skip to Completion.

## Execute Phase Loop

For each pending phase (or once for flat plans):

### 1. Mark Phase Building

If phased, mark the current phase `status="building"` in PLAN.md.

Update CONTEXT.md frontmatter to `status: building` (if not already set).

### 2. Invoke Builder Agent

Use the Agent tool to invoke the `ship-builder` agent with this prompt:

```
Build feature: {name}
Phase: {phase-id} — {phase-name}

Execute all pending tasks in this phase. Read:
- .planning/features/{name}/PLAN.md
- .planning/features/{name}/CONTEXT.md

Follow your instructions for the execution loop, deviation rules, and commit conventions.
```

For flat plans, omit the Phase line.

### 3. Handle Agent Result

Parse the builder agent's `## BUILD RESULT` output.

**If Status: COMPLETE:**
- If phased, mark the current phase `status="done"` in PLAN.md
- Output to the user:

```
## PHASE COMPLETE

Feature: {name}
Phase: [M] / [total] — [phase name]
Tasks completed: [N] / [N] in this phase
Commits: [list short hashes]
```

- Then **continue the loop** to the next pending phase

**If Status: CHECKPOINT:**
- Leave CONTEXT.md status as `building`
- Output to the user:

```
## CHECKPOINT REACHED

Feature: {name}
Tasks completed: [N] / [M]
Stopped at: Task [id] — [task name]
Reason: [from agent result]

Recommendation: [from agent result]
```

- **Stop the loop** — do not continue to the next phase

## Completion

When all tasks are done (flat plan) or all phases are done (phased plan):

1. Update CONTEXT.md frontmatter to `status: built`
2. Output:

```
## BUILD COMPLETE

Feature: {name}
Tasks completed: [N] / [N]
Commits: [list short hashes]

Next: /ship-verify
```

$ARGUMENTS
