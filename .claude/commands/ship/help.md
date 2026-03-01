---
description: Show Ship command reference.
allowed-tools: []
---

Display the Ship command reference:

```
Ship — Feature-centric development framework for Claude Code

Commands:
  /ship:start "idea"   Start brainstorming a new feature or fix
  /ship:plan           Create implementation plan from CONTEXT.md
  /ship:build          Execute the plan with atomic commits
  /ship:verify         Verify implementation against acceptance criteria
  /ship:go             Auto-run remaining steps (plan → build → verify)

  /ship:status         Show all features and their status
  /ship:resume         Pick up where you left off on a feature

  /ship:update         Update Ship to the latest version
  /ship:uninstall      Remove Ship from this project
  /ship:help           Show this reference

Flow:
  start → plan → build → verify
  (or just: start → go)

Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  VERIFY.md    Verification report
```

$ARGUMENTS
