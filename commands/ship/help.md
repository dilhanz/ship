---
description: Show Ship command reference and workflow overview.
allowed-tools: Read
---

Output the following help text:

```
## Ship — Lightweight Structured Development

Ship is a lightweight framework for structured, goal-backward software development.
Plan → Execute → Verify. One phase at a time.

## Core Loop

  /ship:auto                  Capture requirements, then auto-run all phases end-to-end.
  /ship:new-project           Start here manually. Auto-detects new vs existing codebase.
  /ship:feature-brainstorm [--deep] "idea"   Explore a feature idea. --deep runs parallel research first.
  /ship:plan-phase [N]        Plan phase N — tasks, file paths, verify commands.
  /ship:execute-phase         Execute current phase — implement, verify, commit atomically.
  /ship:verify-phase          Verify current phase against roadmap success criteria.

  Repeat plan → execute → verify for each phase.

## Utility Commands

  /ship:status            Show current phase, progress, and next action.
  /ship:resume            Pick up where you left off.
  /ship:add-phase [desc]  Add a new phase to the roadmap.
  /ship:complete          Mark the project complete, generate summary.
  /ship:update            Update Ship to the latest version.
  /ship:help              Show this help text.

## Project Files

Ship stores planning context in .planning/ at your project root:

  .planning/PROJECT.md      Vision, stack, constraints, decisions
  .planning/REQUIREMENTS.md FEAT-XX requirements with priorities
  .planning/ROADMAP.md      Phases with goals and success criteria
  .planning/STATE.md        Current position (always under 40 lines)
  .planning/NN-PLAN.md      Phase N implementation plan
  .planning/NN-SUMMARY.md   Phase N execution record
  .planning/NN-VERIFY.md    Phase N verification report

## Key Concepts

  Success Criteria   Observable truths in ROADMAP.md that ship-verifier checks.
                     Written before code, verified after execution.

  Atomic Commits     One commit per task. Specific files staged. Never git add .

  Deviation Rules    4 rules for when reality diverges from plan:
                     1. Wrong detail → fix and continue
                     2. Missing dep → install and continue
                     3. Verify fails → fix before proceeding
                     4. Arch conflict → stop and report

  Must Deliver       Plain English outcomes in PLAN.md.
                     Every Must Deliver has at least one task.

## Context Usage

  Token usage varies widely by phase complexity — simple phases use
  far less context than phases with large file counts or test suites.
  The context monitor will warn you when usage is high so you can
  wrap up the current phase before hitting limits.

## Getting Help

  Issues: https://github.com/[your-repo]/ship
  Workflow docs: .claude/ship/workflows/
```
