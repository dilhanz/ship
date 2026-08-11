# Decisions

## 2026-08-11 — `.project-manager/` is tracked in git for the ship repo

Ship dogfoods its own PM layer, so the state files are committed rather than gitignored.
Git-neutrality still holds everywhere else — this is a choice about this repo, not a policy.

## 2026-08-11 — Enrich Ship's PM layer upstream first, migrate second

The private project-specific PM that motivated this work cannot be retired until Ship's layer is a
strict superset of it, so the capabilities are built into Ship first and that project converts after.
Every future project then benefits, not just the one that motivated the work.
