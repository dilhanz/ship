---
description: Execute the implementation plan for the active feature with atomic commits.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Build the active feature by executing its plan.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` or `building` (resuming)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, ask the user which one to build
6. If no candidates exist, tell the user to run `/ship:plan` first

## Build

Read `.claude/ship/workflows/build.md` and follow its instructions with:
- Feature name: `{name}` (from the active feature)

The build workflow will execute each task from PLAN.md, verify it, and commit.

$ARGUMENTS
