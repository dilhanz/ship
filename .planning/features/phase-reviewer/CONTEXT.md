---
feature: "phase-reviewer"
status: brainstormed
created: "2026-03-09"
---

## Problem

The build process executes tasks and commits code without any independent quality review. Bugs, security issues, logic errors, and unnecessary complexity can accumulate across a phase and carry into subsequent phases — where they become harder to fix. The existing verifier only runs after all building is complete and focuses on acceptance criteria, not code quality.

## Solution

Add a `ship-reviewer` agent that runs automatically after each phase completes during the build loop. It performs a blind code review of the phase's git diff (no plan context — like a real external PR reviewer), checking for bugs, security issues, code quality, and unnecessary complexity. When critical issues are found, the build pauses and gives the user two choices: fix the issues or skip and continue. Review findings are persisted to a file only when issues are found, keeping the feature directory clean for clean phases.

## Decisions

- **Blind review (no plan context):** The reviewer only sees the git diff, not the PLAN.md task details. This ensures it judges code on its own merits, like an external reviewer would.
- **Per-phase granularity:** Reviews after each phase completes (not per-task). This balances thoroughness with build speed and lets the reviewer see cross-task interactions within a phase.
- **Pause on critical issues:** When critical issues are found, the build loop stops and asks the user to fix or skip. Non-critical warnings are reported but don't block.
- **Persist only when issues found:** Review output is written to `.planning/features/{name}/REVIEW-{phase-id}.md` only when issues exist. Clean phases leave no file.
- **Opus model for reviewer and builder:** Both agents use Opus for maximum quality. The builder model will be updated from sonnet to opus as well.
- **Code review only (no test runs):** The reviewer only analyzes the diff. The builder already runs `<verify>` per task, so re-running tests is redundant.
- **Fix or skip resolution:** When paused on critical issues, user gets two options: fix (re-invoke builder for targeted fixes) or skip (continue to next phase).

## Acceptance Criteria

- [ ] New `agents/ship-reviewer.md` agent exists with Opus model, appropriate tools (Read, Glob, Grep, Bash), and instructions for blind diff-based code review
- [ ] The reviewer agent receives commit hashes, runs `git diff` to get the phase diff, and reviews for: correctness/bugs, security, code quality, naming, unnecessary complexity
- [ ] The reviewer uses confidence-based filtering — only reports issues it is highly confident about
- [ ] The reviewer returns a structured `## REVIEW RESULT` with Critical/Warning categorization and a CLEAN or HAS-ISSUES verdict
- [ ] `skills/ship-build/SKILL.md` invokes the reviewer agent after each phase completes (after builder returns COMPLETE, before continuing to next phase)
- [ ] When the reviewer verdict is HAS-ISSUES with Critical items, the build loop pauses and asks the user: "Fix" or "Skip"
- [ ] When the reviewer verdict is CLEAN or only Warnings, a one-line summary is shown and the build continues
- [ ] Review output is written to `.planning/features/{name}/REVIEW-{phase-id}.md` only when issues are found (flat plans use `REVIEW.md`)
- [ ] `agents/ship-builder.md` model is updated from `sonnet` to `opus`
- [ ] `ship/workflows/go.md` acknowledges reviewer output in its flow (handles pause/resume correctly)
- [ ] The install script (`install.js`) copies the new reviewer agent to `.claude/agents/`

## Scope

**In scope:**
- New reviewer agent definition
- Build skill integration (invoke reviewer after each phase)
- Pause/resume flow on critical issues
- Conditional file persistence for review output
- Builder model upgrade to Opus
- Install script update

**Out of scope:**
- Auto-fixing issues (reviewer only reports; fixing is manual or a separate builder invocation)
- Per-task review granularity
- Plan-aware review (comparing implementation to task intent)
- Running test suites during review
- New `/ship-review` standalone skill (reviewer is internal to the build loop only)

## Research Notes

No research needed. The implementation follows existing patterns: new agent file (like ship-verifier.md), build skill orchestration (like the existing builder invocation), and Agent tool usage for subagent invocation.
