---
name: ship-plan
description: Create an implementation plan for the active feature from its CONTEXT.md.
disable-model-invocation: true
context: fork
agent: ship-planner
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

## Plan

Follow your planning instructions with:
- Feature name: `{name}` (from the active feature)

$ARGUMENTS
