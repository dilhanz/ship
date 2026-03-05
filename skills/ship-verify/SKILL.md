---
name: ship-verify
description: Verify the active feature against its acceptance criteria from CONTEXT.md.
disable-model-invocation: true
context: fork
agent: ship-verifier
argument-hint: "[feature-name]"
---

Verify the active feature's implementation.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `built`
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable features were found

## Verify

Follow your verification instructions with:
- Feature name: `{name}` (from the active feature)

$ARGUMENTS
