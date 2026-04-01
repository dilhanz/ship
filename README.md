# Ship

A feature-centric development framework for Claude Code.

**Ship** guides every piece of work — feature or fix — through a structured flow: brainstorm → plan → build → verify. Each feature gets its own directory with full context.

## Install

```bash
claude plugin install ship
```

Or from the marketplace:

```
/plugin marketplace add dilhanz/ship
```

No dependencies, no build step — just Claude Code's native plugin system. Skills are auto-namespaced as `ship:skill-name`.

### Legacy Installation

```bash
cd your-project
npx github:dilhanz/ship
```

> **Note:** The npx installer is deprecated. Use the plugin system for automatic updates and clean uninstall.

## Usage

```
/ship:start "your idea"     Brainstorm → CONTEXT.md
/ship:design                Compare architecture approaches (optional)
/ship:plan                  Plan tasks → PLAN.md
/ship:plan-verify           Verify plan against codebase patterns
/ship:build                 Implement with atomic commits
/ship:verify                Check against acceptance criteria → VERIFY.md
/ship:finish                Complete feature (create PR, merge, or keep branch)
```

Or let Ship run everything automatically:

```
/ship:start "your idea"     Brainstorm first (interactive)
/ship:go                    Then auto-run: plan → plan-verify → build → verify
/ship:finish                Complete the feature
```

## Utility Commands

```
/ship:status            Show all features and their status
/ship:resume            Pick up where you left off
/ship:help              Full command reference
```

## What Ship Does

**Start / Brainstorm:** Asks 5-10+ questions to deeply understand what you want to build. Reads your codebase directly to ask smarter questions. Captures everything in a `CONTEXT.md` with problem statement, decisions, acceptance criteria, and scope boundaries.

**Design (optional):** Launches 3 parallel architect sub-agents — each with a different philosophy (minimal changes, clean architecture, pragmatic balance) — and presents the trade-offs. You choose the approach before planning.

**Plan:** Launches 3 parallel exploration sub-agents to map similar features, architecture, and conventions. Asks targeted follow-up questions informed by what the explorers found. Then writes a concrete task list with specific file paths and runnable verify commands. Self-validates plan quality (acceptance coverage, task completeness, verify command quality, scope). Plan is independently verified against the codebase before building.

**Build:** Reads key files from the plan to build rich context before starting. Implements tasks sequentially with test-driven development (RED-GREEN-REFACTOR) when tasks have test-based verify commands. Runs the verify command after each task, commits atomically (`feat(feature-name): description`) with specific files staged. Larger plans (>4 tasks) are automatically grouped into phases — build executes one phase at a time. If the builder exhausts its turn limit mid-phase, Ship auto-continues it up to 2 times via SendMessage (preserving full context), for an effective 120-turn maximum per phase. Applies 3 deviation rules when reality diverges from plan, with structured debugging (read error → trace cause → one fix at a time) before each retry. The builder reports 4 statuses: COMPLETE, COMPLETE_WITH_CONCERNS (done but flagging doubts), NEEDS_CONTEXT (pauses to ask user for missing info), and CHECKPOINT (hard block).

**Verify:** Launches 3 parallel reviewer sub-agents (simplicity/DRY, bugs/correctness, conventions/security) then runs the full verifier. Reads acceptance criteria from CONTEXT.md as truths, checks backwards into the code (file exists → has substance → is wired up). Scans for TODOs and stubs. PR review findings use confidence scoring (0-100, only ≥80 reported). If gaps exist, writes fix tasks back to PLAN.md.

**Finish:** Runs after verification passes. Presents 3 options: create a pull request (push + `gh pr create`), merge locally to the base branch, or keep the branch as-is for manual handling. Runs tests before proceeding.

## Feature Directory

Each feature gets its own directory under `.planning/features/`:

```
.planning/features/
├── user-auth/
│   ├── CONTEXT.md    Problem, decisions, acceptance criteria, scope
│   ├── PLAN.md       Tasks with inline status tracking
│   └── VERIFY.md     Verification report
├── fix-login-bug/
│   ├── CONTEXT.md
│   └── ...
└── ...
```

Status is tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `plan-verified` → `building` → `built` → `done`

## Core Principles

**Intensive brainstorming.** The brainstormer asks 5-10+ questions before writing anything. It reads your codebase to avoid asking about things it can already see.

**Goal-backward verification.** Acceptance criteria are written before code. The verifier checks reality against what the user asked for — not whether tasks were executed.

**Atomic commits.** One commit per task. Specific files staged. Verify command must pass before committing.

**Phased builds.** Plans with more than 4 tasks are automatically grouped into phases (3-5 tasks each). Build executes one phase at a time; `/ship:go` loops through all phases automatically. An approval gate pauses before building to show the plan summary and ask for confirmation.

**Test-driven development.** When a task's verify command runs tests, the builder follows RED-GREEN-REFACTOR: write a failing test first, implement minimal code to pass, then clean up. Skipped for non-test tasks (config, wiring, templates).

**Deviation rules.** 3 rules for when reality diverges from plan: fix and continue for small issues, fix with limits and structured debugging for verify failures (max 3 attempts), stop and report for architectural conflicts. If each fix reveals a new problem in a different place, it skips straight to stop — that's an architectural mismatch, not a bug.

**No ceremony.** No milestones, no FEAT-XX IDs. Just features with context, plans, and verification.

## Status Line

Ship includes a rich status line showing model, current task, directory@branch, context usage bar, rate limits, and session cost.

The plugin system doesn't support status line registration natively, so after installing the plugin you need to add this to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/marketplaces/dilhanz-ship/hooks/statusline.cjs"
  }
}
```

This path is stable across plugin updates.

## Hooks

5 hooks are declared in `hooks/hooks.json` for automatic registration by the plugin system:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `guide` | SessionStart | Injects Ship awareness so Claude proactively suggests commands when it detects feature work |
| `context-monitor` | PostToolUse | Injects warnings into the agent's context when usage exceeds thresholds |
| `safety-gate` | PreToolUse | Blocks `git add .` and `git add -A` to enforce atomic commits |
| `post-compact` | PostCompact | Re-injects feature state after context compaction so progress isn't lost |
| `subagent-stop` | SubagentStop | Validates the builder emitted a valid BUILD RESULT; injects recovery if not |

Hooks use `matcher` fields (e.g., `Bash`, `Write|Edit|Bash|Agent`) to only fire on relevant tool calls. The context monitor warns the agent to save state before the context window fills up, preventing lost progress.

