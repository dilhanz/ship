---
project: "ship"
updated: "2026-08-11"
---

## Milestones

### M1 — Project-manager layer (status: active)

Goal: Ship's PM layer is a working project manager, not a read-only roadmap view.

| Item | Status | Priority | Size | Depends on | Source | Ship feature |
|------|--------|----------|------|------------|--------|--------------|
| Enrich the PM layer to five state files | done | P1 | XL | — | .planning/archive/pm-capability-uplift/CONTEXT.md | pm-capability-uplift |
| Re-run `check` against a ship-owned archived feature | pending | P1 | S | Enrich the PM layer to five state files | .planning/archive/pm-capability-uplift/VERIFY.md inconclusive criterion 6 | — |

#### Enrich the PM layer to five state files

The v5.3.0 PM layer shipped as a read-only roadmap-and-dashboard tool. This item grows it into a
working project manager: five state files, a traceable backlog (mandatory `Source`, P0–P3, effort
sizing), a verb-driven `/ship:pm` delegating to the `ship-pm` agent, and a header-name nudge parser
that keeps legacy 5-column tables working. Feature-level detail lives in
`.planning/features/pm-capability-uplift/`; only the project-level shape is recorded here.

#### Re-run `check` against a ship-owned archived feature

The `check` verb's contract was exercised during the uplift, but `.planning/archive/` was empty at
the time, so the dry-run audited an archived feature in another repo read-only and filed no debt from
it here. The verb's debt-filing path has therefore never run end-to-end against a ship-owned feature,
which is why criterion 6 of that feature's VERIFY.md is INCONCLUSIVE (accepted by override).
**Now unblocked:** archiving `pm-capability-uplift` gave this repo its first archived feature, so
`/ship:pm check pm-capability-uplift` can settle it.

### M2 — Release and follow-through (status: pending)

Goal: 5.4.0 is published and the enriched PM format is adopted where it was designed for.

| Item | Status | Priority | Size | Depends on | Source | Ship feature |
|------|--------|----------|------|------------|--------|--------------|
| Tag and publish v5.4.0 | pending | P2 | S | Enrich the PM layer to five state files | CHANGELOG.md `## 5.4.0` | — |
| Migrate the originating project onto the enriched PM format | pending | P2 | L | Tag and publish v5.4.0 | 2026-08-11 — Enrich Ship's PM layer upstream first, migrate second | — |
| Retire the deprecated npx installer | pending | P3 | M | — | CLAUDE.md "Legacy (deprecated)" installation note | — |
