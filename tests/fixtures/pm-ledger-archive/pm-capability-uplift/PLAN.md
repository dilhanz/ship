---
feature: "pm-capability-uplift"
goal: "Make Ship's PM layer a strict superset of the clean24new project-specific PM for everything generalizable — five state files, a richer traceable backlog, a verb-driven /ship:pm delegating to a new ship-pm agent, and a back-compatible nudge hook."
---

<!-- Reduced copy of .planning/archive/pm-capability-uplift/PLAN.md for CI.
     `.planning/` is gitignored, so the real archive is invisible to a clean checkout.
     Only the bytes ship/pm-update.cjs harvestFeature() actually parses are kept;
     the prose body is dropped. REVIEW.md and VERIFY.md are copied verbatim.
     tests/pm-ledger.test.js re-harvests the real archive when present and asserts
     this fixture still yields identical rows. -->

## Plan Review

### Round 1

**CRITICAL findings received:**

1. Task 4 / `tests/rearchitecture-v4.test.js` — Task 4 adds `agents/ship-pm.md`, but an existing test asserts the agent roster is exactly six files via `deepEqual`. No task updates that test, so the suite goes red the moment the agent is created and task 10's `node --test tests/` (and CI's `node --test "tests/*.test.js"`) fails.

**Changes made:**

- **Verified the finding — confirmed.** `tests/rearchitecture-v4.test.js:54-65` contains `it('exactly the 6 expected agents exist')` doing `assert.deepEqual` on `fs.readdirSync(agents)` against a literal six-element array; `agents/` currently holds exactly those six files. No task in the plan listed that file. `.github/workflows/*` runs the suite, so the break reaches CI.
- **Task 7 `<name>`/`<files>`/`<reference>` widened** to cover `tests/rearchitecture-v4.test.js` alongside `tests/pm-wiring.test.js`. Task 7 already carried `depends="1,4,5,6"`, so it is correctly sequenced after the agent is created — no new dependency or task id was needed, and no id was renumbered.
- **Task 7 `<action>` gained an explicit final block** instructing: add `'ship-pm.md'` to the expected roster array in sorted position (between `ship-plan-reviewer.md` and `ship-replanner.md`), rename the test title to `'exactly the 7 expected agents exist'`, update the contradicting `// Structure — 4 agents, …` comment at line 51, and change nothing else in that file (the `agents are slimmed` loop stays on its existing four-agent list; PM assertions stay in `pm-wiring`).
- **Task 7 `<verify>` extended** from `node --test tests/pm-wiring.test.js` to `node --test tests/pm-wiring.test.js tests/rearchitecture-v4.test.js`, so the roster fix is proven by the task that makes it rather than only by task 10's full-suite run.
- **Risk Notes gained a "Task 4 → task 7 — the suite is transiently red" note**, recording that the window between task 4 and task 7 is expected, that task 4's file-scoped verify still passes, and that task 10 is the full-suite gate.


### Outcome — APPROVED

**Rounds:** 2

- Round 1: NEEDS-REVISION, 1 critical
- Round 2: APPROVED, 0 critical

**Examined:** tests/rearchitecture-v4.test.js:50-66 (agent roster deepEqual) · agents/ (6 files today; ship-pm.md absent) · tests/pm-wiring.test.js:40-107 · tests/doctrine-v5.test.js:22-49 · hooks/pm-sync-nudge.cjs:17-31 + drift/debounce path · hooks/scan-features.cjs · tests/pm-nudge.test.js:71-98 and tests/pm-nudge-adversarial.test.js:63-90 fixture builders · ship/templates/dashboard.html · skills/*/SKILL.md allowed-tools convention · ship/workflows/go.workflow.js subagent naming · .github/workflows/release.yml:82 · package.json / ship/VERSION / .claude-plugin/plugin.json at 5.3.0

**Surviving non-critical findings (SUGGESTION, carried into build):**

- Task 8 / `tests/pm-nudge-adversarial.test.js` — the adversarial helpers already take `eol` as their third positional parameter (`roadmapContent(rows, eol = '\n')`, `createRoadmap(tmpDir, rows, eol = '\n')`) and the CRLF test at :141 passes it positionally, while `tests/pm-nudge.test.js:74` has no `eol` param. Append `shape` **after** `eol` in the adversarial file (or switch to an options object) so the CRLF case keeps working; the two files' signatures legitimately differ.
- Task 1 / `tests/pm-wiring.test.js` — the transient-redness risk note names only task 4; tasks 1 and 5 open the same window (task 1 replaces the 5-column header string and the literal `no estimates`; task 5 inverts the no-Edit/no-Bash assertion), and task 7 is where those assertions are updated. Do not read a mid-phase-1 or mid-phase-2 `pm-wiring` failure as a regression.
