---
description: Start brainstorming a new feature or fix. Creates a feature directory and runs an intensive questioning session.
allowed-tools: Read, Write, WebSearch, WebFetch, Glob, Bash, AskUserQuestion
---

Start a new feature brainstorming session.

## Setup

1. Ensure `.planning/features/` directory exists. Create it if not.

2. Derive a feature name (kebab-case slug) from the user's input:
   - `$ARGUMENTS` → convert to a short kebab-case slug (e.g., "user authentication" → `user-auth`, "fix login bug" → `fix-login-bug`)
   - If no arguments provided, ask the user to describe what they want to build or fix

3. Check if `.planning/features/{name}/` already exists:
   - If it exists and status is `done`, tell the user this feature is complete. Ask if they want to start a new related feature.
   - If it exists and status is not `done`, tell the user this feature already exists and suggest `/ship:resume` instead.

4. Create the feature directory: `.planning/features/{name}/`

## Brainstorm

Read `.claude/agents/ship-brainstormer.md` and follow its instructions with:
- Feature name: `{name}`
- Feature idea: `$ARGUMENTS`

The brainstormer will ask 5-10+ questions, explore the codebase, and write `.planning/features/{name}/CONTEXT.md`.

$ARGUMENTS
