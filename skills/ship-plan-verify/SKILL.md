---
name: ship-plan-verify
description: Independently verify the implementation plan against existing codebase patterns and conventions before building.
disable-model-invocation: true
context: fork
agent: ship-plan-verifier
argument-hint: "[feature-name]"
---

Verify the implementation plan against the actual codebase.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` (ready for plan review)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable plans were found

## Verify

Follow your plan verification instructions with the active feature.

$ARGUMENTS
