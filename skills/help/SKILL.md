---
name: ship:help
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
  /ship:go             Auto-run remaining steps (plan → plan-verify → build → verify)
  /ship:finish         Complete a feature (create PR, merge, or keep branch)
                       Use --accept-inconclusive "reason" to override INCONCLUSIVE verdicts.

  /ship:status         Show all features and their status
  /ship:resume         Pick up where you left off on a feature

  /ship:help           Show this reference

Flow:
  start → [design →] plan → plan-verify → build → verify → finish
          (or just: start → go → finish)

  /ship:go runs build→verify in a background Workflow (agent output stays out
  of the main context); plan, plan-verify, and finish run interactively.
  On verify FAIL: fix tasks are appended to PLAN.md; resume runs build again.
  On INCONCLUSIVE: /ship:finish requires --accept-inconclusive "reason" to proceed.

Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  REVIEW.md    Per-phase review findings (build)
  VERIFY.md    Verification report (criteria + bug hunt)
```

$ARGUMENTS
