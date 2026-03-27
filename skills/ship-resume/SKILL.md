---
name: ship-resume
description: Use when returning to continue work on an in-progress feature — picks up where you left off based on feature status
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch
argument-hint: "[feature-name]"
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`
!`for f in .planning/features/*/PLAN.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d") plan: $(grep -c 'status="done"' "$f" 2>/dev/null || echo 0) done, $(grep -c 'status="pending"' "$f" 2>/dev/null || echo 0) pending"; done 2>/dev/null; true`

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
