---
name: ship:build
description: Use when a feature plan has been verified and is ready for implementation — executes tasks with atomic commits
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, SendMessage
argument-hint: "[feature-name]"
---

Build the active feature by executing its plan phase by phase.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `plan-verified` or `building` (resuming)
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no buildable features were found

## Prerequisites

Before starting, verify:
1. `.planning/features/{name}/PLAN.md` exists with pending tasks
2. Git is initialized and working directory is clean (no uncommitted changes)

If prerequisites fail, stop and tell the user what's missing.

## Pre-Build Context Loading

Before executing any phase, load key file context into the main conversation to enrich the builder agent's understanding.

1. Read `.planning/features/{name}/PLAN.md` in full
2. Extract all `<files>` elements across all pending tasks. Deduplicate the paths.
3. Filter to files that already exist (skip files the plan creates from scratch — use Glob to check existence)
4. Read up to 8 of those existing files (prioritize files modified by early tasks, skip binary/lock/generated files)
5. Build a `## Key File Context` block summarizing what you observed:
   - For each file read: one sentence describing its structure and relevant patterns
   - Note any conventions or patterns the builder should preserve

This context block is embedded into each builder agent invocation below.

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

## Key File Context (pre-read by orchestrator)

{paste the Key File Context block from Pre-Build Context Loading here}

Execute all pending tasks in this phase. Read:
- .planning/features/{name}/PLAN.md
- .planning/features/{name}/CONTEXT.md

Follow your instructions for the execution loop, deviation rules, and commit conventions.
```

For flat plans, omit the Phase line.

### 2.5. Auto-Continue on Incomplete Result

After the Agent tool returns, extract the `build_result` JSON block from the builder's output. Look for a fenced code block tagged `build_result` and parse the JSON inside it.

**If no valid `build_result` JSON is found** (likely turn exhaustion):

1. Use `SendMessage` to the builder agent with this message:

   ```
   You were building feature "{name}" and stopped without emitting a build_result JSON block.
   Continue where you left off. Read PLAN.md to check which tasks are done (status="done")
   and which are still pending. Resume from the first pending task.
   When finished with all tasks in this phase, emit your build_result JSON block.
   ```

2. After `SendMessage` returns, check again for a valid `build_result` JSON block.
3. If still no valid result, retry `SendMessage` one more time (same message).
4. After 2 retries (3 total attempts including the original Agent call), if still no valid result:
   - Read PLAN.md to check actual progress (tasks marked done)
   - Report to the user:

   ```
   ## BUILDER EXHAUSTED

   Feature: {name}
   Phase: {phase-id} — {phase-name}
   Attempts: 3 (original + 2 continuations)
   Tasks completed: [count from PLAN.md]
   Tasks remaining: [count from PLAN.md]

   The builder could not complete this phase within the turn limit.
   Run /ship:build to retry with a fresh agent, or investigate the remaining tasks.
   ```

   - Leave CONTEXT.md status as `building`
   - **Stop the loop** — do not continue to the next phase

**If a valid `build_result` JSON is found** (either from original Agent call or after SendMessage):
Proceed to the status handling below (### 3).

### 3. Handle Agent Result

Parse the builder agent's `build_result` JSON block. Extract the `status` field.

**If status is "COMPLETE":**
- If phased, mark the current phase `status="done"` in PLAN.md
- Output to the user (use values from the JSON fields):

```
## PHASE COMPLETE

Feature: {result.feature}
Phase: [M] / [total] — [phase name]
Tasks completed: {result.tasks_completed} / {result.tasks_total} in this phase
Overall progress: [done_across_all_phases] / [total_across_all_phases] tasks
Commits: {result.commits joined with ", "}
```

- Then **continue the loop** to the next pending phase

**If status is "COMPLETE_WITH_CONCERNS":**
- Same as COMPLETE (mark phase done, continue loop)
- But also surface the `concerns` array to the user:

```
## PHASE COMPLETE (with concerns)

Feature: {result.feature}
Phase: [M] / [total] — [phase name]
Tasks completed: {result.tasks_completed} / {result.tasks_total} in this phase
Commits: {result.commits joined with ", "}

Concerns flagged by builder:
- {each item from result.concerns}

Continuing to next phase. Review concerns after build completes.
```

**If status is "NEEDS_CONTEXT":**
- Leave CONTEXT.md status as `building`
- Output to the user the `missing` field value
- **Stop the loop** — the user must provide the missing context before continuing

```
## CONTEXT NEEDED

Feature: {result.feature}
Tasks completed: {result.tasks_completed} / {result.tasks_total}
Missing: {result.missing}

Provide the missing information, then run /ship:build to continue.
```

**If status is "CHECKPOINT":**
- Leave CONTEXT.md status as `building`
- Output to the user using `stopped_at`, `reason`, and `recommendation` fields:

```
## CHECKPOINT REACHED

Feature: {result.feature}
Tasks completed: {result.tasks_completed} / {result.tasks_total}
Stopped at: {result.stopped_at}
Reason: {result.reason}

Recommendation: {result.recommendation}
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

Next: /ship:verify
```

$ARGUMENTS
