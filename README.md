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

## The ledger

Ship keeps one ordered index of planned features at `.planning/LEDGER.md`. **Position is priority** — the top line of `## Now` is the next thing to do — so reprioritising is moving a line, in any editor, without telling anything.

```markdown
# Ledger

## Now
- [ ] **worktree-flow** — brainstorm in main, build in worktrees
- [ ] **plan-cache** — reuse exploration across replans

## Next
- [ ] **verify-speed** — make the anti-pattern scan opt-in

## Someday
- [ ] **multi-repo** — features spanning two repos

## Shipped
- [x] kill-pm → .planning/archive/kill-pm/
```

```
/ship:ledger                Show the ledger, annotated with live feature status
/ship:ledger add "idea"     Append a row to ## Next
/ship:ledger <slug> top     Move a row to the top of ## Now
/ship:ledger <slug> someday Park it
/ship:ledger drop <slug>    Remove a row
```

A row holds a slug and a one-liner and nothing else. **Everything about a feature lives in `.planning/features/{slug}/`** — context, plan, review, verification — and status is read live from that folder every time the ledger is displayed, so there is no status cell to drift. A row does not need a folder: an idea can sit under `## Next` indefinitely, and `/ship:start` is what gives it one.

`/ship:start` puts the new feature at the top of `## Now`; `/ship:finish` moves it to `## Shipped`. Nothing else writes the file, so the ordering stays yours.

**Brainstorm in main, build in a worktree.** `/ship:start` runs in the main checkout and offers, once CONTEXT.md is written, to create a `feature/{slug}` worktree and move the session into it — carrying the feature directory across so the worktree holds the only copy. The ledger stays behind in the main checkout, where it belongs: it indexes the project, not the branch. `/ship:finish` archives from any lane back to the main root, so history survives `git worktree remove`.

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
| `/ship:ledger [verb]` | Show or reorder the planned-feature ledger |
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

**Six specialized agents**, each with a single job: `ship-brainstormer` (requirements interview), `ship-plan-reviewer` (read-only plan review), `ship-replanner` (plan revision against critical findings), `ship-builder` (task execution with atomic commits), `ship-reviewer` (per-phase diff review), and `ship-verifier` (acceptance criteria + bug hunt).

**Three reference skills** preloaded into agents: `deviation-rules` (what to do when reality diverges from the plan), `git-commits` (atomic commit discipline), and `tdd` (RED-GREEN-REFACTOR when tasks are test-backed).

**Hooks** keep sessions honest: Ship awareness is injected at session start and after context compaction, `git add .` is blocked to enforce atomic commits, and context-usage warnings fire before the window fills.

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
