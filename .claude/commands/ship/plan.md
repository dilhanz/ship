---
description: Create an implementation plan for the active feature from its CONTEXT.md.
allowed-tools: Read, Write, Edit, Glob, WebFetch
---

Create an implementation plan for the active feature.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `brainstormed` or `planned` (replanning)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, ask the user which one to plan
6. If no candidates exist, tell the user to run `/ship:start` first

## Plan

Read `.claude/agents/ship-planner.md` and follow its instructions with:
- Feature name: `{name}` (from the active feature)

The planner will explore the codebase, design tasks, and write `.planning/features/{name}/PLAN.md`.

$ARGUMENTS
