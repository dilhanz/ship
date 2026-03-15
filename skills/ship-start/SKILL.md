---
name: ship-start
description: Use when beginning new feature work, adding functionality, or fixing a bug — runs intensive brainstorming to capture requirements before planning
disable-model-invocation: true
allowed-tools: Read, Write, WebSearch, WebFetch, Glob, Bash
argument-hint: "[feature description]"
---

Start a new feature brainstorming session.

## Setup

1. Ensure `.planning/features/` directory exists. Create it if not.

2. **First-run detection:** If `.planning/features/` was just created or is empty (no existing feature directories), this is the user's first feature. Show a brief welcome:

   > **Welcome to Ship!** This is your first feature. Here's how Ship works:
   > 1. **Brainstorm** — I'll ask 5-10+ questions to deeply understand your needs
   > 2. **Plan** — I'll explore your codebase and design a step-by-step plan
   > 3. **Build** — I'll implement the plan with atomic git commits
   > 4. **Verify** — I'll check that all acceptance criteria are met
   >
   > Let's start by understanding what you want to build.

3. Derive a feature name (kebab-case slug) from the user's input:
   - `$ARGUMENTS` → convert to a short kebab-case slug (e.g., "user authentication" → `user-auth`, "fix login bug" → `fix-login-bug`)
   - If no arguments provided, ask the user to describe what they want to build or fix

4. Check if `.planning/features/{name}/` already exists:
   - If it exists and status is `done`, tell the user this feature is complete. Ask if they want to start a new related feature.
   - If it exists and status is not `done`, tell the user this feature already exists and suggest `/ship-resume` instead.

5. Create the feature directory: `.planning/features/{name}/`

## Brainstorm

**IMPORTANT: Do NOT launch a subagent for brainstorming.** The brainstorming process requires interactive user input via `AskUserQuestion`, which only works correctly in the main conversation — not inside a subagent.

Read `.claude/agents/ship-brainstormer.md` and follow its instructions **directly in this conversation** with:
- Feature name: `{name}`
- Feature idea: `$ARGUMENTS`

You must ask the user 5-10+ questions using `AskUserQuestion`, explore the codebase, and write `.planning/features/{name}/CONTEXT.md`.

$ARGUMENTS
