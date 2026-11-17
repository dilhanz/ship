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

The heavy lifting runs in background workflows, so agent output never floods your conversation. `/ship:go` interrupts you at three points: the "Ready to build?" gate, any question the plan loop genuinely can't settle itself, and a verify FAIL, which hands you the fix phase it wrote so you can review it before it is built. Pass `--auto` to skip the build gate. A FAIL still stops an `--auto` run; only `--headless` builds its own fix rounds.

If verify fails, fix tasks are written back into the plan and `/ship:go` picks them up again. If a builder runs out of turns mid-phase, a fresh one resumes from the first pending task — progress is never lost.

## /ship:auto

One command from an idea to a pull request:

```
/ship:auto "your idea"      Brainstorm, then plan → build → verify → PR
/ship:auto <slug>           Continue a ledger row or a feature already in flight
```

It starts from any of three places:

- **A quoted idea** — the same brainstorm as `/ship:start`, with the same confirm-before-writing gate. Nothing is built from requirements you have not confirmed.
- **A ledger row with no folder yet** — brainstormed from the row's one-liner.
- **A feature already in flight** — completed steps are skipped; a feature living in another worktree is entered without asking.

A new feature always gets its own `feature/{slug}` worktree, and the session moves into it without the offer. After the brainstorm is confirmed, the only question that can still fire is one the plan loop genuinely cannot settle itself: no "Ready to build?", no finish offer, no PR / merge / keep choice.

How a run ends:

- **PASS** — the test suite runs, the branch is pushed, a ready-for-review PR is opened against the base branch, the feature is archived and its ledger row moves to `## Shipped`. The PR URL is in the final report. The PR is the human review gate.
- **INCONCLUSIVE** — the same, and the PR body lists the inconclusive criteria; VERIFY.md records the automatic override.
- **FAIL** — fix rounds run automatically (2 by default, `--fix-rounds 0`–`3`), each one after the first only while the failing set shrinks. When they are spent or refused, the run stops.
- **Anything else** — a plan loop that cannot converge, a builder stop, a failing test suite at finish, `gh` unavailable, a feature sitting on the base branch: nothing is pushed, no PR is opened, and the report names the reason and the status left behind.

To resume a stopped run, re-run `/ship:auto {slug}`. `--profile` applies as it does on `/ship:go`.

Invoking `/ship:auto` is your authorization for one push and one PR for that feature. It never merges, never force-pushes and never opens a draft.

**Several terminals, one run each.** Nothing coordinates runs; each one is self-contained in its own worktree, so launching several features is opening several terminals.

**Permission prompts.** Whether `git push` and `gh pr create` raise a permission prompt depends on your Claude Code permission mode, not on Ship. A run you have walked away from waits at that prompt until you answer it.

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

`/ship:start` puts the new feature at the top of `## Now`; `/ship:finish` moves it to `## Shipped` (`/ship:auto` performs those same two steps). Nothing else writes the file, so the ordering stays yours.

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
| `/ship:auto "idea"` | Brainstorm, then everything through to a pull request, with no further prompts |
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

**Five specialized agents**, each with a single job: `ship-plan-reviewer` (read-only plan review), `ship-replanner` (plan revision against critical findings), `ship-builder` (task execution with atomic commits), `ship-reviewer` (per-phase diff review), and `ship-verifier` (acceptance criteria + bug hunt, plus a repo verify checklist and a trial merge of main).

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
