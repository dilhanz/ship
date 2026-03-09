---
name: ship-plan
description: Create an implementation plan for the active feature from its CONTEXT.md.
disable-model-invocation: true
allowed-tools: Read, Agent, Glob, Edit
argument-hint: "[feature-name]"
---

Create an implementation plan for the active feature.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `brainstormed` or `planned` (replanning)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no plannable features were found

## Run Planning

Use the Agent tool to invoke the `ship-planner` agent with this prompt:

```
Plan feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md (if replanning)
- .planning/features/{name}/VERIFY.md (if replanning after failed verify)

Follow your planning instructions to explore the codebase, design tasks, self-validate, write PLAN.md, and update CONTEXT.md status.
```

## Display Results

After the planner agent completes, read `.planning/features/{name}/PLAN.md` and display:

```
## PLAN READY

Feature: {name}
Tasks: [N] [in M phases / flat]
Must Deliver: [N items]

[List each task name on its own line, grouped by phase if phased]

Next: /ship-build
```

$ARGUMENTS
