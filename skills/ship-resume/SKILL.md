---
name: ship-resume
description: Use when returning to continue work on an in-progress feature — picks up where you left off based on feature status
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch
argument-hint: "[feature-name]"
---

Resume work on a feature.

1. Check `.planning/features/` for feature directories. If none exist, tell the user to run `/ship-start`.

2. If `$ARGUMENTS` is provided, use it as the feature name. Otherwise, find features that are not `done`.

3. If multiple non-done features exist, show them and ask which one to resume.

4. Read the feature's `CONTEXT.md` and determine the next action based on status:

| Status | Action |
|--------|--------|
| `brainstormed` | Run `/ship-plan` |
| `planned` | Run `/ship-plan-verify` |
| `plan-verified` | Run `/ship-build` |
| `building` | Run `/ship-build` (will resume from last completed task) |
| `built` | Run `/ship-verify` |
| `done` | Tell the user this feature is complete |

5. Tell the user what you found and what the next step is, then invoke the appropriate command.

$ARGUMENTS
