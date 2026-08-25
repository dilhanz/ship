---
name: help
description: Use when the user asks about Ship commands, workflow, or how to use the framework
effort: low
allowed-tools: []
---

Display the Ship command reference:

```
Ship — Feature-centric development framework for Claude Code

Commands:
  /ship:start "idea"   Start brainstorming a new feature or fix
  /ship:design         Compare architecture approaches and let user choose (optional)
  /ship:plan           Create implementation plan from CONTEXT.md
  /ship:plan-verify    Verify plan against codebase patterns before building
  /ship:build          Execute the plan with atomic commits
  /ship:verify         Verify acceptance criteria + adversarial bug hunt (writes tests)
                       Per-criterion verdicts: PASS / FAIL / INCONCLUSIVE (no runnable verify command).
  /ship:go             Auto-run remaining steps (plan → plan loop → build → verify)
                       Use --auto to skip the "Ready to build?" approval gate.
  /ship:finish         Complete a feature (create PR, merge, or keep branch)
                       Use --accept-inconclusive "reason" to override INCONCLUSIVE verdicts.

  /ship:status         Show all features and their status
  /ship:resume         Pick up where you left off on a feature

  /ship:pm "question"  Ask the project manager: next item, parallel work, status, decisions
  /ship:pm-sync        Set up or update project-manager state (.project-manager/)

  /ship:help           Show this reference

Flow:
  start → [design →] plan → plan-verify → build → verify → finish
          (or just: start → go → finish)

  /ship:go runs the plan revision loop (review → replan → re-review, max 5
  rounds) and the build→verify spine in background Workflows (agent output
  stays out of the main context); round-1 planning, the build-approval gate
  (skipped with --auto), and finish run interactively. The plan loop
  interrupts only when the replanner needs a decision you must make.
  On verify FAIL: fix tasks are appended to PLAN.md; resume runs build again.
  On INCONCLUSIVE: /ship:finish requires --accept-inconclusive "reason" to proceed.

Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  REVIEW.md    Per-phase review findings (build)
  VERIFY.md    Verification report (criteria + bug hunt)
```

$ARGUMENTS
