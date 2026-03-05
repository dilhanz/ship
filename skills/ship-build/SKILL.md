---
name: ship-build
description: Execute the implementation plan for the active feature with atomic commits.
disable-model-invocation: true
context: fork
agent: ship-builder
argument-hint: "[feature-name]"
---

Build the active feature by executing its plan.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` or `building` (resuming)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no buildable features were found

## Build

Read `.claude/ship/workflows/build.md` and follow its orchestration instructions with:
- Feature name: `{name}` (from the active feature)

The build workflow handles phase detection, builder invocation, and result handling.

$ARGUMENTS
