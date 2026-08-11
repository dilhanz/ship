---
updated: "2026-08-11"
---

# ship — Status

## In flight

- **Enrich the PM layer to five state files** (`pm-capability-uplift`) — building. Phases 1 and 2 are
  committed (pm-state format, nudge parser, dashboard template, `ship-pm` agent, `/ship:pm`,
  `/ship:pm-sync`); phase 3 is landing tests, docs, the 5.4.0 bump, and this bootstrap. The verify
  gate has not run yet.
- **unverified — priorities, sizes, and dependencies in ROADMAP.md are PM-derived from repo evidence
  (README.md, `git log`, `.planning/features/*/CONTEXT.md`, CHANGELOG.md), not user-confirmed.** This
  bootstrap ran without the `/ship:pm-sync` interview. Run `/ship:pm-sync` to confirm or correct them.

## Live status

None recorded. Ship is a Claude Code plugin — there is no deployed runtime to report on.

## Blocked

No blockers recorded.

## Recently shipped

- **v5.3.0** (commit `51241e1`) — introduced the PM layer (`/ship:pm`, `/ship:pm-sync`, `pm-state`,
  the nudge hook). **Verify gate unconfirmed:** `.planning/` is gitignored in this repo and
  `.planning/archive/` is empty, so no VERIFY.md for that work exists here. Whether its gate ran
  cannot be settled from the repo — reading the local `.planning/` history of the machine that built
  it would settle it.

## Repo hygiene

- On `main`, ahead of `origin/main` by 10 unpushed commits (nine `pm-capability-uplift` commits plus
  this bootstrap). Working tree otherwise clean.
- One worktree: the repo root, on `main`. No stale worktrees.
- `.planning/` is gitignored; `.project-manager/` is tracked in this repo by deliberate choice.
