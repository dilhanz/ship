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
  /ship:auto "idea"    Idea, ledger row or in-flight feature → pull request, in one command.
                       No prompts after the brainstorm except a plan-loop question.
                       --profile <quick|standard|thorough>, --fix-rounds <0-3> (default 2).

  /ship:status         Show all features and their status
  /ship:resume         Pick up where you left off on a feature

  /ship:ledger         Show the planned-feature ledger (.planning/LEDGER.md)
                       add <idea> | <slug> now|next|someday|top | drop <slug>

  /ship:help           Show this reference

Flow:
  start → [design →] plan → plan-verify → build → verify → finish
          (or just: start → go → finish)
          (or just: auto)

  /ship:go runs the plan revision loop (review → replan → re-review, max 5
  rounds) and the build→verify spine in background Workflows (agent output
  stays out of the main context); round-1 planning, the build-approval gate
  (skipped with --auto), and finish run interactively. The plan loop
  interrupts only when the replanner needs a decision you must make.
  On verify FAIL: fix tasks are appended to PLAN.md; resume runs build again.
  On INCONCLUSIVE: /ship:finish requires --accept-inconclusive "reason" to proceed.

  /ship:auto runs the brainstorm (same confirmation gate as start), then go
  and finish with no further prompts, in the feature's own worktree. A verify
  FAIL gets automatic fix rounds while the failing set shrinks. PASS or
  INCONCLUSIVE ends in a pushed branch and a ready-for-review PR (never a
  merge, a force push or a draft); anything else stops with nothing pushed,
  and re-running /ship:auto {slug} resumes.

Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  REVIEW.md    Per-phase review findings (build)
  VERIFY.md    Verification report (criteria + bug hunt)
```

$ARGUMENTS
