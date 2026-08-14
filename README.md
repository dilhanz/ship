# Ship

A feature-centric development framework for Claude Code.

Every piece of work — feature or fix — gets its own directory with full context, a verified plan, atomic commits, and a real verification gate. You describe the work once; Ship runs the rest.

## Install

```bash
claude plugin install ship
```

Or from the marketplace:

```
/plugin marketplace add dilhanz/ship
```

Zero dependencies, no build step.

## Quick start

```
/ship:start "your idea"     Interactive brainstorm → CONTEXT.md
/ship:go                    Everything else: plan → review loop → build → verify
/ship:finish                PR, merge, or keep — then archive
```

That's the whole loop. `/ship:start` is the only step that needs you at the keyboard — it probes until the problem, scope, and testable acceptance criteria are pinned down and confirmed. From there, `/ship:go` takes over.

## /ship:go

One command that drives a feature from brainstormed to verified:

1. **Plan** — explores the codebase and writes PLAN.md: concrete tasks with exact files, runnable verify commands, and the contracts pinned (schemas, endpoints, error behavior).
2. **Plan review loop** — an independent reviewer checks every claim in the plan against the real code. Critical findings trigger a replan, then a re-review — up to 5 rounds. Only an approved plan proceeds to build.
3. **Build** — a builder agent implements each phase: one atomic commit per task, verify command green before every commit. After each phase, a read-only reviewer re-runs the phase's verify commands and reviews the diff; critical findings get one fix round.
4. **Verify** — a verifier checks every acceptance criterion against running code, writes and runs adversarial tests against the actual diff, and records everything in VERIFY.md. PASS means proven, not plausible.

The heavy lifting runs in background workflows, so agent output never floods your conversation. `/ship:go` interrupts you exactly twice: the "Ready to build?" gate, and any question the plan loop genuinely can't settle itself. Pass `--auto` to skip the build gate for a fully hands-off run.

If verify fails, fix tasks are written back into the plan and `/ship:go` picks them up again. If a builder runs out of turns mid-phase, a fresh one resumes from the first pending task — progress is never lost.

## The project manager

Ship includes a project layer above individual features, stored in `.project-manager/` (roadmap, status, decisions, conventions, plus a generated `dashboard.html` you can open in a browser).

```
/ship:pm-sync               Set up the PM (first run), reconcile it afterwards
/ship:pm                    Project brief: milestones, blockers, what to work on next
/ship:pm status             Reconstruct the true state and fix the files to match
/ship:pm groom              Re-check, re-prioritise, re-size the backlog
/ship:pm check <feature>    Audit whether a "shipped" feature was genuinely verified
/ship:pm handover           Close out a session: update state, commit, write a handover
/ship:pm <question>         "what should I work on next?", "why did we choose X?"
```

The PM never writes application code — it keeps the roadmap honest (every backlog item needs a traceable source), catches verification debt (features marked shipped whose verify gate never ran), and always ends with the Ship command to run next. Lifecycle commands sync it automatically, and a hook nudges you when the roadmap drifts from reality.

**Works across git worktrees.** Run parallel feature lanes in linked worktrees and the PM still sees one project: when `.project-manager/` is gitignored, all PM state anchors to the main worktree root, and `/ship:pm` sweeps every lane to report who's working where — branch, feature, stage, task progress — in the brief, STATUS.md, and the dashboard's Lanes panel. It also warns when two in-flight plans are about to touch the same files, and `/ship:finish` archives from any lane back to the main root so history survives `git worktree remove`.

## Feature directory

```
.planning/features/user-auth/
├── CONTEXT.md    Problem, decisions, acceptance criteria, scope
├── PLAN.md       Tasks with inline status tracking
├── REVIEW.md     Per-phase review findings
└── VERIFY.md     Verification report (criteria + bug hunt)
```

Status lives in CONTEXT.md frontmatter: `brainstormed` → `planned` → `plan-verified` → `building` → `built` → `done`. Finished features move to `.planning/archive/`.

## All commands

| Command | What it does |
|---------|--------------|
| `/ship:start "idea"` | Intensive brainstorm → CONTEXT.md |
| `/ship:go [--auto]` | Auto-run everything from plan to verify |
| `/ship:pm [verb\|question]` | Project manager: brief, status, groom, check, handover |
| `/ship:pm-sync` | Bootstrap or reconcile the PM state |
| `/ship:design` | Compare 2–3 architecture approaches before planning (optional) |
| `/ship:plan` | Plan tasks manually → PLAN.md |
| `/ship:plan-verify` | Single-shot independent plan review |
| `/ship:build` | Build manually, phase by phase, with the review gate |
| `/ship:verify` | Acceptance criteria + adversarial bug hunt → VERIFY.md |
| `/ship:finish` | PR / merge / keep, then archive the feature |
| `/ship:status` | All features and where they stand |
| `/ship:resume` | Pick up where you left off |
| `/ship:help` | Full command reference |

## Under the hood

**Seven specialized agents**, each with a single job: `ship-brainstormer` (requirements interview), `ship-plan-reviewer` (read-only plan review), `ship-replanner` (plan revision against critical findings), `ship-builder` (task execution with atomic commits), `ship-reviewer` (per-phase diff review), `ship-verifier` (acceptance criteria + bug hunt), and `ship-pm` (project-level state work).

**Four reference skills** preloaded into agents: `deviation-rules` (what to do when reality diverges from the plan), `git-commits` (atomic commit discipline), `tdd` (RED-GREEN-REFACTOR when tasks are test-backed), and `pm-state` (the `.project-manager/` file formats).

**Hooks** keep sessions honest: Ship awareness is injected at session start and after context compaction, `git add .` is blocked to enforce atomic commits, context-usage warnings fire before the window fills, and a PM drift nudge fires when the roadmap falls behind feature reality.

**Status line** (optional) — model, current task, context bar, session cost. The plugin system can't register it automatically, so add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/marketplaces/dilhanz-ship/hooks/statusline.cjs"
  }
}
```

### Legacy install

`npx github:dilhanz/ship` still works but is deprecated — use the plugin system for automatic updates and clean uninstall.
