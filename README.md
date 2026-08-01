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
/ship:verify                Check acceptance criteria + adversarial bug hunt → VERIFY.md
/ship:finish                Complete feature (create PR, merge, or keep branch)
                            Use --accept-inconclusive "reason" to override INCONCLUSIVE verdicts
```

Or let Ship run everything automatically:

```
/ship:start "your idea"     Brainstorm first (interactive)
/ship:go                    Then auto-run: plan → plan-verify → build → verify
/ship:finish                Complete the feature
```

`/ship:go` runs the build→verify spine in a background Workflow so per-agent output stays out of the main conversation context; plan, plan-verify, the plan-approval gate, and finish run interactively.

## Utility Commands

```
/ship:status            Show all features and their status
/ship:resume            Pick up where you left off
/ship:help              Full command reference
```

## What Ship Does

**Start / Brainstorm:** Probes until the problem, scope boundary, and testable acceptance criteria can be stated without guessing — and you've confirmed the summary. Question count is judgment: a narrow bug fix may need two questions, a complex feature many rounds. Reads your codebase directly to ask smarter questions, probing the NFR dimensions the codebase makes relevant (performance, observability, rollout/migration, security, error handling) and skipping the ones that plainly don't apply. Captures everything in a `CONTEXT.md` with problem statement, decisions, acceptance criteria, and scope boundaries.

**Design (optional):** Identifies the 2-3 genuinely distinct viable approaches for your feature from its actual decision axes — each concrete: what changes, key files, tradeoffs, rough task count. Presents the trade-offs; you choose the approach before planning.

**Plan:** Explores the codebase at a depth scaled to uncertainty — reusing the brainstormer's Codebase Notes when present, exploring inline for small or familiar surfaces, fanning out parallel exploration sub-agents only for large or unfamiliar ones. Asks targeted follow-up questions informed by what exploration found. Then writes a concrete task list that pins the load-bearing contracts (schemas, endpoint shapes, error behavior, library choices, integration points) with runnable verify commands, leaving internals to the builder. Self-checks acceptance-criteria coverage and runs an adversarial review. The plan is then independently reviewed by a fresh-context subagent against the actual codebase before building.

**Build:** Reads key files from the plan to build rich context before starting. Implements tasks sequentially with test-driven development (RED-GREEN-REFACTOR) when tasks have test-based verify commands. Runs the verify command after each task, commits atomically (`feat(feature-name): description`) with specific files staged. Larger plans (>4 tasks) are automatically grouped into phases — build executes one phase at a time. If the builder exhausts its turn budget mid-phase, the phase continues with a fresh builder that resumes from the first pending task in PLAN.md — up to 5 rounds in `/ship:go`, 4 in `/ship:build` — stopping only when a round lands no new tasks. Applies 3 deviation rules when reality diverges from plan, with structured debugging (read error → trace cause → one fix at a time) before each retry. The builder reports 5 statuses: COMPLETE, COMPLETE_WITH_CONCERNS (done but flagging doubts), PARTIAL (turn budget spent, completed work committed — hands off to a continuation builder), NEEDS_CONTEXT (triggers AskUserQuestion — the orchestrator collects the missing info and SendMessages it back to the still-alive builder, capped at 2 rounds per phase), and CHECKPOINT (hard block). After the builder claims COMPLETE, a **per-phase review gate** runs: a read-only `ship-reviewer` agent re-runs every phase verify command and reviews the phase diff; critical/high findings go back to the builder for one fix round; all findings persist to `REVIEW.md`.

**Verify:** The single post-build quality gate. Reads acceptance criteria from CONTEXT.md as truths and emits **per-criterion verdicts** of PASS, FAIL, or **INCONCLUSIVE** (when no runnable `<verify>` command exists — grep-only evidence cannot upgrade to PASS) using a gate function that runs commands rather than reasoning about correctness. In the same pass it hunts bugs: auto-discovers the test framework, picks relevant risk categories (boundary, negative, error handling, concurrency, security — skips categories that don't apply), writes and commits adversarial test files against the **actual git diff**, runs them, and scans the changed files for anti-patterns. Critical/high bugs or any failing criterion block a PASS; if gaps exist, writes fix tasks back to PLAN.md and reverts status to `plan-verified`.

**Finish:** Runs after verification passes. Presents 3 options: create a pull request (push + `gh pr create`), merge locally to the base branch, or keep the branch as-is for manual handling. Runs tests before proceeding. If VERIFY.md contains any INCONCLUSIVE verdict, `/ship:finish` blocks until you pass `--accept-inconclusive "reason"`; the override and operator email are recorded in VERIFY.md.

## Feature Directory

Each feature gets its own directory under `.planning/features/`:

```
.planning/features/
├── user-auth/
│   ├── CONTEXT.md    Problem, decisions, acceptance criteria, scope
│   ├── PLAN.md       Tasks with inline status tracking
│   ├── REVIEW.md     Per-phase review findings (fixed and unresolved)
│   └── VERIFY.md     Verification report (criteria + bug hunt)
├── fix-login-bug/
│   ├── CONTEXT.md
│   └── ...
└── ...
```

Status is tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `plan-verified` → `building` → `built` → `done`. If verify finds critical/high bugs or a failing criterion, it writes fix tasks to PLAN.md and rolls status back to `plan-verified`; `/ship:resume` then routes to `/ship:build`, after which `/ship:verify` runs again.

## Core Principles

**Intensive brainstorming.** The brainstormer probes until the problem, scope, and acceptance criteria are testable and confirmed — question count is judgment, not quota. It reads your codebase to avoid asking about things it can already see.

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

4 event hooks (plus the statusline) are declared in `hooks/hooks.json` for automatic registration by the plugin system:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `guide` | SessionStart | Injects Ship awareness so Claude proactively suggests commands when it detects feature work |
| `context-monitor` | PostToolUse | Injects warnings into the agent's context when usage exceeds thresholds |
| `safety-gate` | PreToolUse | Blocks `git add .` and `git add -A` to enforce atomic commits |
| `post-compact` | PostCompact | Re-injects feature state after context compaction so progress isn't lost |

Hooks use `matcher` fields (e.g., `Bash`, `Write|Edit|Bash|Agent`) to only fire on relevant tool calls. The context monitor warns the agent to save state before the context window fills up, preventing lost progress.

