---
updated: "2026-08-11"
---

# ship — Status

## In flight

- **Enrich the PM layer to five state files** (`pm-capability-uplift`) — built, verified, and
  archived. PR #12 is open against `main`; the v5.4.0 tag that publishes the release has not been
  cut yet.

## Live status

None recorded. Ship is a Claude Code plugin — there is no deployed runtime to report on.

## Blocked

No blockers recorded.

## Recently shipped

- **Enrich the PM layer to five state files** (`pm-capability-uplift`) — verified 2026-08-11.
  **Verify gate ran:** `.planning/archive/pm-capability-uplift/VERIFY.md` records 7 of 8 acceptance
  criteria PASS with executed evidence, 0 FAIL, and one INCONCLUSIVE (`check <feature>`'s
  debt-filing half) accepted via a recorded `--accept-inconclusive` override. Full suite: 215 tests,
  0 failures. The inconclusive criterion is tracked as the P1 item below.
- **v5.3.0** (commit `51241e1`) — introduced the PM layer (`/ship:pm`, `/ship:pm-sync`, `pm-state`,
  the nudge hook). **Verify gate unconfirmed:** `.planning/` is gitignored in this repo and no
  VERIFY.md for that work exists here. Whether its gate ran cannot be settled from the repo —
  reading the local `.planning/` history of the machine that built it would settle it.

## Repo hygiene

- On `feat/pm-capability-uplift`, pushed and tracking its remote; PR #12 open against `main`.
  Local `main` matches `origin/main` (`51241e1`). Working tree clean.
- One worktree: the repo root. No stale worktrees.
- `.planning/` is gitignored; `.project-manager/` is tracked in this repo by deliberate choice.
- **unverified — priorities, sizes, and dependencies in ROADMAP.md are PM-derived from repo evidence
  (README.md, `git log`, `.planning/` contents, CHANGELOG.md), not user-confirmed.** The bootstrap
  ran without the `/ship:pm-sync` interview. Run `/ship:pm-sync` to confirm or correct them.
