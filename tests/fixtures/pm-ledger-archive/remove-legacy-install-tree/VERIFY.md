# Verification Report — remove-legacy-install-tree

**Feature:** remove-legacy-install-tree
**Verified:** 2026-08-23
**Head:** bc102d1f7cf6a98c68bea0b7a00e24214f89d30d
**Overall Status:** INCONCLUSIVE

## Stage 1 — Acceptance Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `.claude/agents/`, `.claude/hooks/`, `.claude/skills/`, `.claude/ship/` absent from disk and from `git ls-files` | PASS | `test -e` on all four → absent; `git ls-files .claude/agents .claude/hooks .claude/skills .claude/ship` → count=0; `ls -A .claude` → `agent-memory` (single entry). `git diff --name-status 2a3dfbe HEAD` shows 29 `D` entries covering the whole tree |
| `.claude/settings.json` and `.claude/settings.local.json` absent from disk and from `git ls-files` | PASS | `test -e` both → absent; `git ls-files .claude/settings.json .claude/settings.local.json` → count=0; `git status --porcelain -uall` shows neither has been regenerated |
| `.claude/agent-memory/` intact — 3 tracked `ship-ship-verifier` files unchanged, untracked memory files still on disk | PASS | `git ls-files .claude/agent-memory` → the 3 `ship-ship-verifier` files; blob hashes identical at `2a3dfbe` (pre-change), `HEAD`, and on disk (`5ede8009`, `4be78bec`, `954fb1da`); `git diff --stat 2a3dfbe HEAD -- .claude/agent-memory` empty; `find .claude/agent-memory -type f \| wc -l` → 14 (3 tracked + 11 untracked, ≥ the 8 present at plan time — `ship-ship-pm` 3, `ship-ship-replanner` 2, `ship-ship-reviewer` 4, `ship-ship-builder` 2; the extra three were written by agents during this run). Note for re-verification: **after** this evidence was captured, this verifier committed its own memory update (`bc102d1`, touching `ship-ship-verifier/MEMORY.md` + one new file), so the tracked blob for `MEMORY.md` now differs from `2a3dfbe` by that separate commit — a normal post-deletion agent write, not a regression of this feature |
| `.claude-plugin/plugin.json` byte-identical to its pre-change state | PASS | `git diff 2a3dfbe HEAD -- .claude-plugin` empty; `git rev-parse 2a3dfbe:.claude-plugin/plugin.json` = `git hash-object .claude-plugin/plugin.json` = `14076b17a3150742ab5815b7a0ab8d2bcac7edb0`; `git status --porcelain -uall .claude-plugin` empty |
| A test in `tests/` fails when any of the four legacy directories or `.claude/settings.json` is present, passes against the post-deletion tree, and runs as part of the default `node --test` invocation | PASS | **RED, end-to-end:** `git archive HEAD` into a temp dir → `node install.js` there restores exactly `agents, hooks, settings.json, ship, skills` → `node --test tests/legacy-install-tree.test.js` exits 1 with all five absence assertions failing (`✖ .claude/agents is absent` … `✖ .claude/settings.json is absent`) and both preservation assertions green; the full suite there goes `pass 923 / fail 5`. **RED, per-path:** isolated mutation matrix reintroducing each path one at a time → exit=1 each (agents, hooks, skills, ship, settings.json, populated skills dir, all five at once); `settings.local.json` present → exit=0 (deliberate). **GREEN:** `node --test tests/legacy-install-tree.test.js` → `pass 7 / fail 0`, exit=0. **Default invocation:** `readdirSync('tests').filter(*.test.js)` includes `legacy-install-tree.test.js`; CI runs `node --test "tests/*.test.js"` (`.github/workflows/test.yml:26`, `release.yml:82`) |
| The full suite passes with zero failures | PASS | `node --test "tests/*.test.js"` → exit=0, `tests 932 / suites 178 / pass 932 / fail 0` (928/928 before this verification's own test was added). Repeated against a clean `git archive HEAD` checkout → exit=0, `pass 932 / fail 0`, proving no dependence on untracked local state |
| A fresh session opened in this repo offers only `ship:`-prefixed Ship skills — no unprefixed `plan` / `build` / `go` / `verify` duplicates — and its SessionStart context contains the Ship guide message exactly once | INCONCLUSIVE | Mechanism fully verified; the observation itself is not runnable from inside this session (project-level registrations are read at session start). What was proved: `find .claude -name SKILL.md -o -name 'settings*.json' -o -type d -name agents` → nothing; `ls -A .claude` → `agent-memory` only; `grep -i 'guide\|SessionStart' ~/.claude/settings.json` → no match; no enterprise `managed-settings.json`; the plugin's `hooks/hooks.json` registers `guide.cjs` exactly once and `enabledPlugins` holds one `ship@dilhanz-ship`; running the plugin guide hook emits one `SessionStart` `additionalContext` block. Every registration source Claude Code reads for this repo was enumerated and only one remains — but a fresh session is still needed to observe the roster |

## PM Handoff

None — no criterion required shared PM state.

## Stage 2 — Bug Hunt & Quality

Full depth (profile: `standard`).

### Carried Review Findings

REVIEW.md had not yet been persisted for this feature and no carry-over block was supplied; the phase review's own scratch record (`.review-scratch/phase-1.json`, `head` `1f32b5c`, `status: APPROVED`) carried **no critical or high findings**. Its single `low` finding is recorded below for completeness.

| Severity | Phase | File | Finding | Outcome | Evidence |
|----------|-------|------|---------|---------|----------|
| low | phase-1 | `.planning/features/remove-legacy-install-tree/PLAN.md:79` | Task 1's RED-half verify command inverts once task 2 lands — re-running it now reports "expected RED … but the test passed" | not reproduced as a code defect | Re-ran task 1's verify verbatim: it does invert, exactly as the reviewer described. The property it was written to prove was re-established independently and more strongly here (see criterion 5: `install.js` run in a throwaway checkout drives the guard red on all five assertions). Plan-artifact wording, no product defect |

### Adversarial Tests

- **Categories tested:** happy-path (guard green on the shipped tree), negative-input (each guarded path reintroduced, individually and together), boundary (`settings.local.json` must *not* trip the guard; `ship-ship-verifier` as a file rather than a directory; missing/renamed `plugin.json`), error-handling (guard behaviour in a clean CI-shaped checkout), regression-surface (`install.js`'s real write surface vs. the guard's hardcoded list)
- **Tests written:** 4 cases in 1 file  **Passed:** 4 / 4
- **Test files committed:** `tests/legacy-install-tree-adversarial.test.js` (`fba41e1`)
- **Self-mutation of the new test** (proving it is not vacuous): deleting the `.claude/settings.json` case from the guard → adversarial case 3 fails (weakened guard caught); adding a fifth `COPIES` destination to `install.js` → adversarial case 2 fails with `install.js writes .claude/commands — tests/legacy-install-tree.test.js does not assert on it`. Both mutations reverted with `git checkout --`; working tree confirmed clean afterwards

### Bug Findings

No bugs found in the delivered change. One defect was found and fixed *inside this verification's own test* before it was committed, recorded here because it is a trap any future test author in this repo will hit:

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | low | test-harness | A nested `node --test` spawned from inside a test inherits `NODE_TEST_CONTEXT=child-v8`, which makes the child emit **no output and exit 0** — any assertion of the form "the nested run must be red" passes vacuously. Measured: inherited env → `status=0`, empty stdout; env with `NODE_TEST_CONTEXT` deleted → `status=1` | `tests/legacy-install-tree-adversarial.test.js:100` | Fixed before commit (env stripped, plus a `TAP version` sentinel assertion so the vacuous case can never return) |

No other test in `tests/` spawns a nested `node --test` (`grep -n "'--test'" tests/*.test.js` → only the new file), so nothing pre-existing is affected.

### Anti-Pattern Scan

- TODO/FIXME/HACK/XXX/placeholder/stub markers: **None** in either added file
- Empty function bodies / hardcoded values that should be config: **None**. The path lists in both files are the subject under test, not configuration
- Skipped or `.only` tests: **None** (`grep -nE "[.](skip|only|todo)\("` → no match)
- Broken imports: **None** — both files import only `node:` built-ins
- Scope violations: **None**. `git diff --name-only 2a3dfbe HEAD -- install.js CHANGELOG.md ship/VERSION package.json .claude-plugin/plugin.json .gitignore` is empty, and so is the same query against `hooks/ skills/ agents/ ship/` — the deletion touched nothing outside `.claude/` and the two new test files
- Temp-directory hygiene: the new test's sandbox is removed in `after()`; no `ship-install-guard-*` directories remain in `$TMPDIR` after a full run

### Quality Notes

- The guard test's header comment records *why* `.claude/settings.local.json` and the untracked memory directories are deliberately not asserted. That is the single most valuable thing in the file — both omissions look like oversights and would otherwise be "fixed" back into permanent-red assertions.
- CONTEXT.md's third criterion says "the 6 untracked `ship-ship-pm` / `ship-ship-replanner` / `ship-ship-reviewer` files"; the live count is 9 across those three directories plus 2 under a new `ship-ship-builder/`. PLAN.md already caught this and encoded a floor rather than an equality, which is the right call — agents write memory during the run being verified.
- This verification made two commits of its own: `fba41e1` (the adversarial test) and `bc102d1` (verifier agent memory recording the nested-`node --test` trap). Neither touches product code.
- CONTEXT.md frontmatter still read `status: building` at verification time although all three tasks are `done` with commits; corrected to `done` by this report.
- `install.js` remains functional and undeprecated in behaviour (it prints a deprecation warning, then installs). That is deliberate and out of scope — it is precisely why the guard exists, and the new adversarial test now binds the guard's coverage to the installer's actual write surface, so the two cannot drift apart silently.

## Human Checks Required

- [ ] Open a **fresh** session in this repo and confirm (a) the skill roster contains only `ship:`-prefixed Ship skills — no unprefixed `plan` / `build` / `go` / `verify` / `start` — and no unprefixed `ship-brainstormer` / `ship-builder` / `ship-verifier` agents, and (b) the SessionStart Ship guide message appears exactly once. Every registration source was enumerated programmatically and only the plugin's remains, but the roster itself can only be observed at session start.

## Gaps

- Criterion 7's observable half (fresh-session skill roster and single guide message) cannot be executed from within a running session — see Human Checks Required. Recommended resolution: confirm in the next fresh session, then `/ship:finish --accept-inconclusive "confirmed in fresh session"`.

## Recommendation

**Done** — pending the one fresh-session observation.

Six of seven criteria pass on executed evidence, including an end-to-end proof that running `install.js` against a clean checkout of this HEAD drives the guard red on all five of its absence assertions and leaves the preserved `agent-memory/` and `.claude-plugin/plugin.json` untouched. The full suite is green both locally (932/932) and in a clean `git archive` checkout. The single INCONCLUSIVE is a criterion phrased as a fresh-session observation; its mechanism has been verified exhaustively, so the remaining work is one glance at the next session's skill list.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** yes
- **Reason:** criterion 7 requires a fresh-session observation; every registration source was enumerated programmatically and only the plugin's remains
- **Operator:** dilhanj@outlook.com
- **Timestamp:** 2026-08-23T05:42:18Z
