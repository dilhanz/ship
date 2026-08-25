---
feature: "lane-ownership"
goal: "Bind each feature slug to at most one owning lane in the fleet sweep, so a lane reports only what it owns, unowned copies are hoisted once, and phantom cross-lane overlaps disappear"
---

<!-- Reduced copy of .planning/archive/lane-ownership/PLAN.md for CI.
     `.planning/` is gitignored, so the real archive is invisible to a clean checkout.
     Only the bytes ship/pm-update.cjs harvestFeature() actually parses are kept;
     the prose body is dropped. REVIEW.md and VERIFY.md are copied verbatim.
     tests/pm-ledger.test.js re-harvests the real archive when present and asserts
     this fixture still yields identical rows. -->

## Plan Review

### Outcome — APPROVED

**Rounds:** 1
- Round 1: APPROVED, 0 critical

**Examined:** `hooks/scan-features.cjs`, `hooks/pm-sync-nudge.cjs`, `ship/lane-sweep.cjs`, `ship/pm-update.cjs`, `tests/lane-sweep.test.js`, `tests/multi-worktree-integration.test.js`, `tests/pm-handoff.test.js`, `tests/multi-worktree-doctrine.test.js`, `skills/pm/SKILL.md`, `skills/pm-state/SKILL.md`, `agents/ship-pm.md`, `CLAUDE.md`, `.github/workflows/test.yml`, `package.json`, the `.claude/` mirrors (no scan-features or lane-sweep mirror exists).

**Findings (all non-blocking, all folded into the plan before build):**

- [WARNING] Task 1 — `hooks/scan-features.cjs`: the blast-radius analysis named `guide.cjs` and `post-compact.cjs` but omitted `hooks/pm-sync-nudge.cjs`, the third consumer and the one with behavioral consequences (`activeSlugs` / `actualStatus()` :73-89). *Applied:* named in Task 1's action, and the three nudge suites plus `post-compact` added to its verify.
- [WARNING] Task 3 — `ship/lane-sweep.cjs`: the verify only re-ran `tests/lane-sweep.test.js`, while `tests/pm-handoff.test.js:238-287` and `tests/multi-worktree-integration.test.js:156-173` are the suites that actually assert on `sweep()`'s lane/feature output. *Applied:* both added to Task 3's verify so a shape regression surfaces inside phase 1.
- [SUGGESTION] Task 4 — `ship/pm-update.cjs`: wiring `stampLane` into `require.main` gives every CLI run a new CONTEXT.md write; existing spawning suites do not expect it (one escapes only because its fixture feature lives under `.planning/archive/`). *Applied:* noted in the action and the `pm-update*` plus integration suites added to the verify.
- [SUGGESTION] Task 5 — fixture semantics: with `.planning/` committed before `git worktree add`, no slug is single-held, so main's other copies resolve to `unowned` and main reports zero features. Correct by design, but it reads against criterion 1's literal wording. *Applied:* Task 5 case 1 now asserts that shape directly — every slug under at most one lane, never two.
