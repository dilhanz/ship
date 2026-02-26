# Ship

A lightweight structured development framework for Claude Code.

**Ship** is a standalone structured development framework built around a simple flow: questions → roadmap → plan → execute (atomic commits) → verify (goal-backward).

## Install

```bash
cd your-project
npx github:dilhanz/ship
```

Copies all framework files into `.claude/` in your current project directory. No dependencies, no build step — just Node.js 18+.

**Update** — run the same command again from your project:

```bash
npx github:dilhanz/ship
```

**Uninstall** — removes all Ship files while preserving `.planning/` data:

```bash
npx github:dilhanz/ship --uninstall
```

## Usage

```
/ship:auto                  Full auto mode — requirements → roadmap → plan → execute → verify, hands-free
```

Or step through each phase manually:

```
/ship:new-project           Start here — auto-detects new vs existing codebase
/ship:plan-phase 1          Plan phase 1 — tasks, file paths, verify commands
/ship:execute-phase         Implement current phase — verify + atomic commits
/ship:verify-phase          Check current phase against success criteria
```

Repeat plan → execute → verify for each phase.

For adding a feature to an existing project:

```
/ship:feature-brainstorm    Explore and sharpen a feature idea
/ship:plan-phase N          Plan the new phase
/ship:execute-phase         Implement it
/ship:verify-phase          Verify it
```

## Utility Commands

```
/ship:status            Current phase and next action
/ship:resume            Pick up where you left off
/ship:pause-work        Save state and pause for safe resumption
/ship:add-phase         Add a new phase mid-project
/ship:complete          Mark project done, generate summary
/ship:update            Update Ship to latest version
/ship:help              Full command reference
```

## What Ship Does

**Auto mode:** End-to-end automation. Captures requirements interactively (same flow as new-project), confirms the roadmap with you once, then plans → executes → verifies every phase automatically without further prompts. Stops and writes `.planning/AUTO-STOP.md` if a hard blocker or verification failure occurs, with exact steps to fix and resume.

**Feature brainstorm:** For mid-project feature additions. Reads existing project context, asks one question at a time to sharpen a rough idea, optionally researches relevant patterns or libraries, then writes a structured `BRAINSTORM.md` capturing the problem, minimum scope, and open questions.

**New project:** Auto-detects whether the directory is greenfield or has an existing codebase. Asks the right questions for each case, captures requirements as FEAT-XX IDs, and creates a phased roadmap with observable success criteria.

**Plan phase:** Reads the roadmap, does up to 3 web fetches if research is needed, writes a concrete task list with specific file paths and runnable verify commands. Then runs a plan quality gate (ship-plan-checker) before presenting the plan — verifying requirement coverage, task completeness, verify command quality, and scope. If issues are found you can revise or proceed anyway.

**Execute phase:** Implements tasks sequentially, runs the verify command after each task, commits atomically (`feat(NN): task-name`) with specific files staged. Applies 4 deviation rules when reality diverges from plan.

**Verify phase:** Reads success criteria from the roadmap as truths, checks backwards into the code (file exists → has substance → is wired up). Scans for TODOs and stubs. Writes a pass/fail report.

## Planning Files

Ship stores all planning context in `.planning/` at your project root:

```
.planning/
├── PROJECT.md        Vision, stack, constraints, decisions
├── REQUIREMENTS.md   FEAT-XX items with priorities
├── ROADMAP.md        Phases with goals and success criteria
├── STATE.md          Current position (always under 40 lines)
├── 01-PLAN.md        Phase 1 plan
├── 01-SUMMARY.md     Phase 1 execution record
├── 01-VERIFY.md      Phase 1 verification report
├── AUTO-STOP.md      Written by auto mode if a blocker or verify failure occurs
└── ...
```

## Core Principles

**Goal-backward verification.** Success criteria are written before code. The verifier checks reality against goals — not whether tasks were executed.

**Mandatory verification.** A phase is NOT complete until the verifier says PASS. Only the ship-verifier can set status to "complete". Planning the next phase is blocked until verification passes.

**State guards.** Every agent validates STATE.md before proceeding. Wrong state = blocked with a clear message about what to run instead. No silent skipping.

**Progress logging.** Agents write real-time progress entries to STATE.md as tasks complete. If a session is interrupted, the log survives.

**Atomic commits.** One commit per task. Specific files staged. Verify command must pass before committing.

**Deviation rules.** 4 rules for when reality diverges from plan: fix-and-continue for small changes, stop-and-report for architectural conflicts.

**No config.** Ship always uses the same flow. No preferences file, no feature flags.

## Hooks

The installer automatically registers 3 hooks in `.claude/settings.json`:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `ship-statusline` | statusLine | Shows model, current task, directory, and context usage in the Claude Code status bar |
| `ship-check-update` | SessionStart | Checks for Ship updates once per session in the background |
| `ship-context-monitor` | PostToolUse | Injects warnings into the agent's context when usage exceeds 35% (warning) or 25% (critical) remaining |

The context monitor is especially useful for long execution phases — it tells the agent to save state before the context window fills up, preventing lost progress.
