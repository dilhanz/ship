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
/ship-plan                  Plan tasks → PLAN.md
/ship-build                 Implement with atomic commits
/ship-verify                Check against acceptance criteria → VERIFY.md
```

Or let Ship run everything automatically:

```
/ship-start "your idea"     Brainstorm first (interactive)
/ship-go                    Then auto-run: plan → build → verify
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

**Plan:** Reads CONTEXT.md, explores the codebase, and writes a concrete task list with specific file paths and runnable verify commands. Self-validates plan quality (acceptance coverage, task completeness, verify command quality, scope).

**Build:** Implements tasks sequentially, runs the verify command after each task, commits atomically (`feat(feature-name): description`) with specific files staged. Larger plans (>4 tasks) are automatically grouped into phases — build executes one phase at a time. Applies 3 deviation rules when reality diverges from plan.

**Verify:** Reads acceptance criteria from CONTEXT.md as truths, checks backwards into the code (file exists → has substance → is wired up). Scans for TODOs and stubs. If gaps exist, writes fix tasks back to PLAN.md.

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

Status is tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `building` → `built` → `done`

## Core Principles

**Intensive brainstorming.** The brainstormer asks 5-10+ questions before writing anything. It reads your codebase to avoid asking about things it can already see.

**Goal-backward verification.** Acceptance criteria are written before code. The verifier checks reality against what the user asked for — not whether tasks were executed.

**Atomic commits.** One commit per task. Specific files staged. Verify command must pass before committing.

**Phased builds.** Plans with more than 4 tasks are automatically grouped into phases (3-5 tasks each). Build executes one phase at a time; `/ship-go` loops through all phases automatically.

**Deviation rules.** 3 rules for when reality diverges from plan: fix and continue for small issues, fix with limits for verify failures (max 3 attempts), stop and report for architectural conflicts.

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

