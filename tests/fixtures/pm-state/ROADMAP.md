---
project: "Fixture Project"
updated: "2026-08-23"
---

# Roadmap

## Milestones

### M1 — Fixture rendering (status: active)
Goal: Exercise every dashboard rendering path the conformance suite asserts

| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Re-run `check` against a ship-owned archived feature | pending | P2 | S | Freeze the fixture header shape | skills/pm-state/SKILL.md | — | — | users | proven | 2026-08-20 |
| Render the fixture dashboard from state | in-progress | P0 | M | — | tests/pm-state-conformance.test.js | fixture-active-thing | feature/fixture-active-thing @ /lanes/fixture-active-thing | internal | — | 2026-08-21 |
| Wire the fixture into the conformance suite | pending | P3 | L | Render the fixture dashboard from state, Freeze the fixture header shape | tests/pm-state-conformance.test.js | — | — | contributors | proven | — |
| Freeze the fixture header shape | pending | P2 | S | — | tests/pm-column-compat.test.js | — | — | internal | suspected | — |

#### Re-run `check` against a ship-owned archived feature

The detail-section convention indexes a real backlog row, and this row carries the
code-span tripwire: the dashboard must render `check` as a code element.

### M2 — Fixture hygiene (status: pending)
Goal: Keep the committed fixture conformant so the dogfood blocks stay honest

| Item | Status | Priority | Size | Depends on | Source | Ship feature |
| --- | --- | --- | --- | --- | --- | --- |
| Adopt the shared pm-state fixture | done | P1 | S | — | tests/fixtures/pm-state/CONVENTIONS.md | fixture-shipped-thing |
| Unblock the fixture upgrade path | blocked | P3 | XL | Adopt the shared pm-state fixture | tests/pm-nudge-verify.test.js | — |
