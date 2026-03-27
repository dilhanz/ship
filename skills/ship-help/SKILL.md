---
name: ship-help
description: Use when the user asks about Ship commands, workflow, or how to use the framework
effort: low
allowed-tools: []
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`

Display the Ship command reference:

```
Ship — Feature-centric development framework for Claude Code

Commands:
  /ship-start "idea"   Start brainstorming a new feature or fix
  /ship-design         Compare architecture approaches and let user choose (optional)
  /ship-plan           Create implementation plan from CONTEXT.md
  /ship-plan-verify    Verify plan against codebase patterns before building
  /ship-build          Execute the plan with atomic commits
  /ship-verify         Verify implementation against acceptance criteria
  /ship-go             Auto-run remaining steps (plan → plan-verify → build → verify)
  /ship-finish         Complete a feature (create PR, merge, or keep branch)

  /ship-status         Show all features and their status
  /ship-resume         Pick up where you left off on a feature

  /ship-update         Update Ship to the latest version
  /ship-uninstall      Remove Ship from this project
  /ship-help           Show this reference

Flow:
  start → [design →] plan → plan-verify → build → verify → finish
  (or just: start → go → finish)

Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  VERIFY.md    Verification report
```

$ARGUMENTS
