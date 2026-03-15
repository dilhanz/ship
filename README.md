# Ship

A feature-centric development framework for Claude Code.

**Ship** guides every piece of work — feature or fix — through a structured flow: brainstorm → plan → build → verify. Each feature gets its own directory with full context.

## Install

```bash
cd your-project
npx github:dilhanz/ship
```

Copies skills, agents, hooks, and framework files into `.claude/` in your current project directory. No dependencies, no build step — just Node.js 18+. Uses native Claude Code skills with `context: fork` for isolated subagent execution.

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
/ship-start "your idea"     Brainstorm → CONTEXT.md
/ship-design                Compare architecture approaches (optional)
/ship-plan                  Plan tasks → PLAN.md
/ship-plan-verify           Verify plan against codebase patterns
/ship-build                 Implement with atomic commits
/ship-verify                Check against acceptance criteria → VERIFY.md
/ship-finish                Complete feature (create PR, merge, or keep branch)
```

Or let Ship run everything automatically:

```
/ship-start "your idea"     Brainstorm first (interactive)
/ship-go                    Then auto-run: plan → plan-verify → build → verify
/ship-finish                Complete the feature
```

## Utility Commands

```
/ship-status            Show all features and their status
/ship-resume            Pick up where you left off
/ship-update            Update Ship to latest version
/ship-uninstall         Remove Ship from this project
/ship-help              Full command reference
```

## What Ship Does

**Start / Brainstorm:** Asks 5-10+ questions to deeply understand what you want to build. Reads your codebase directly to ask smarter questions. Captures everything in a `CONTEXT.md` with problem statement, decisions, acceptance criteria, and scope boundaries.

**Design (optional):** Launches 3 parallel architect sub-agents — each with a different philosophy (minimal changes, clean architecture, pragmatic balance) — and presents the trade-offs. You choose the approach before planning.

**Plan:** Launches 3 parallel exploration sub-agents to map similar features, architecture, and conventions. Asks targeted follow-up questions informed by what the explorers found. Then writes a concrete task list with specific file paths and runnable verify commands. Self-validates plan quality (acceptance coverage, task completeness, verify command quality, scope). Plan is independently verified against the codebase before building.

**Build:** Reads key files from the plan to build rich context before starting. Implements tasks sequentially with test-driven development (RED-GREEN-REFACTOR) when tasks have test-based verify commands. Runs the verify command after each task, commits atomically (`feat(feature-name): description`) with specific files staged. Larger plans (>4 tasks) are automatically grouped into phases — build executes one phase at a time. Applies 3 deviation rules when reality diverges from plan, with structured debugging (read error → trace cause → one fix at a time) before each retry. The builder reports 4 statuses: COMPLETE, COMPLETE_WITH_CONCERNS (done but flagging doubts), NEEDS_CONTEXT (pauses to ask user for missing info), and CHECKPOINT (hard block).

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

**Phased builds.** Plans with more than 4 tasks are automatically grouped into phases (3-5 tasks each). Build executes one phase at a time; `/ship-go` loops through all phases automatically. An approval gate pauses before building to show the plan summary and ask for confirmation.

**Test-driven development.** When a task's verify command runs tests, the builder follows RED-GREEN-REFACTOR: write a failing test first, implement minimal code to pass, then clean up. Skipped for non-test tasks (config, wiring, templates).

**Deviation rules.** 3 rules for when reality diverges from plan: fix and continue for small issues, fix with limits and structured debugging for verify failures (max 3 attempts), stop and report for architectural conflicts. If each fix reveals a new problem in a different place, it skips straight to stop — that's an architectural mismatch, not a bug.

**No ceremony.** No milestones, no FEAT-XX IDs. Just features with context, plans, and verification.

## Hooks

The installer automatically registers 4 hooks in `.claude/settings.json`:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `ship-statusline` | statusLine | Shows model, current task, directory, and context usage in the Claude Code status bar |
| `ship-check-update` | SessionStart | Checks for Ship updates once per session in the background |
| `ship-context-monitor` | PostToolUse | Injects warnings into the agent's context when usage exceeds thresholds |
| `ship-safety-gate` | PreToolUse | Blocks `git add .` and `git add -A` to enforce atomic commits |

Hooks use `matcher` fields (e.g., `Bash`, `Write|Edit|Bash|Agent`) to only fire on relevant tool calls. The context monitor warns the agent to save state before the context window fills up, preventing lost progress.

