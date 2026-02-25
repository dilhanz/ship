# Ship

A lightweight structured development framework for Claude Code.

**Ship** is a standalone structured development framework built around a simple flow: questions → roadmap → plan → execute (atomic commits) → verify (goal-backward).

## Install

```bash
git clone --depth 1 https://github.com/dilhancarsales/ship /tmp/ship && node /tmp/ship/install.js && rm -rf /tmp/ship
```

Copies all framework files into `~/.claude/`. No dependencies, no build step — just Node.js and git.

## Usage

In any project directory:

```
/ship:brainstorm        Explore a rough feature idea before planning
/ship:new-project       Start here — capture requirements, create roadmap
/ship:plan-phase 1      Plan phase 1 — tasks, file paths, verify commands
/ship:execute-phase 1   Implement phase 1 — verify + atomic commits
/ship:verify-phase 1    Check phase 1 against success criteria
```

Use `/ship:brainstorm` when you have a vague feature idea and want to think it through before committing to a plan. It reads your project context, asks focused questions, and writes a `BRAINSTORM.md` ready to hand off to the planner.

Repeat plan → execute → verify for each phase.

## Utility Commands

```
/ship:status            Current phase and next action
/ship:resume            Pick up where you left off
/ship:add-phase         Add a new phase mid-project
/ship:complete          Mark project done, generate summary
/ship:update            Update Ship to latest version
/ship:help              Full command reference
```

## What Ship Does

**Brainstorm:** Reads existing project context, asks one question at a time to sharpen a rough idea, optionally researches relevant patterns or libraries, then writes a structured `BRAINSTORM.md` capturing the problem, minimum scope, and open questions.

**New project:** Asks what you're building, captures requirements as FEAT-XX IDs, creates a phased roadmap with observable success criteria.

**Plan phase:** Reads the roadmap, does up to 3 web fetches if research is needed, writes a concrete task list with specific file paths and runnable verify commands. Self-checks: every Must Deliver has a task.

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

## MCP Server (Optional)

Ship includes an optional MCP server for mechanical workflow enforcement. It exposes 4 tools:

| Tool | Purpose |
|------|---------|
| `ship_check_state` | Read state + validate if an operation is allowed |
| `ship_log_progress` | Append timestamped entry to Progress Log |
| `ship_get_status` | Full project status with roadmap progress |
| `ship_validate_transition` | Check if a state transition is valid |

The installer registers it automatically. To register manually:

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "ship": {
      "command": "node",
      "args": ["~/.claude/ship/ship-mcp.js"]
    }
  }
}
```

The MCP server enforces the state machine:
- `planning → executing → verifying → complete`
- Only the verifier can set "complete"
- Only the executor can set "verifying"
- Planning phase N requires phase N-1 to be verified