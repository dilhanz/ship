---
description: Verify the active feature against its acceptance criteria from CONTEXT.md.
allowed-tools: Read, Write, Bash, Glob, Grep
---

Verify the active feature's implementation.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `built`
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, ask the user which one to verify
6. If no candidates exist, tell the user to run `/ship:build` first

## Verify

Read `.claude/agents/ship-verifier.md` and follow its instructions with:
- Feature name: `{name}` (from the active feature)

The verifier will check each acceptance criterion and write `.planning/features/{name}/VERIFY.md`.

If verification passes, the feature is done. If it fails, fix tasks will be added to PLAN.md for the next build run.

$ARGUMENTS
