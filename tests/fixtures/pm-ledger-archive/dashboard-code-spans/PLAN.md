---
feature: "dashboard-code-spans"
goal: "Render markdown code spans as <code> in the PM dashboard, and make the three gitignored-state dogfood blocks run in CI against a committed fixture behind a new test workflow"
---

<!-- Reduced copy of .planning/archive/dashboard-code-spans/PLAN.md for CI.
     `.planning/` is gitignored, so the real archive is invisible to a clean checkout.
     Only the bytes ship/pm-update.cjs harvestFeature() actually parses are kept;
     the prose body is dropped. REVIEW.md and VERIFY.md are copied verbatim.
     tests/pm-ledger.test.js re-harvests the real archive when present and asserts
     this fixture still yields identical rows. -->

## Plan Review

### Round 1

**CRITICAL findings received:**

1. Task 4 — the `<verify>` commands for tasks 4, 5, 6, 7 and 8 grep `node --test` output for TAP
   summary lines (`^# fail 0$`, `^# skipped 0$`), but the installed Node emits the spec reporter even
   when piped, so those lines never appear and none of those verifies can pass even when the task is
   correctly done. Task 1's exit-code-based `node --test` is already fine.

**Changes made:**

- **Finding confirmed against the real environment** rather than taken on trust: `node --version` is
  `v25.8.1`, and running `node --test --test-timeout=20000 "tests/pm-nudge-verify.test.js" 2>&1 |
  tail` through a pipe printed the spec summary (`i fail 0` / `i skipped 0`) with no `#`-prefixed
  line anywhere. Re-running the same file with `--test-reporter=tap` printed `# fail 0` and
  `# skipped 0`. Both greps as planned would have failed on a correct implementation.
- Added `--test-reporter=tap` to the `node --test` invocations in the `<verify>` of tasks 4, 5, 6, 7
  and 8. Task 1's verify is unchanged — it relies on the exit code, which is reporter-independent.
- Rewrote the verifies of tasks 4, 5 and 6 to run the test file **once** into a shell variable and
  grep that captured output twice, instead of invoking `node --test` twice per verify. The double
  invocation doubled runtime for no added signal and the two runs could in principle disagree. Each
  now also prints `tail -12` of the run, so a failure is diagnosable from the verify output alone —
  which is what task 4's `tee /dev/stderr` was for, so that has been dropped.
- Kept the TAP-shape greps rather than switching them to the spec form. The spec form matches only
  where the default reporter is spec; CI pins `node-version: '22'`, whose non-TTY default is TAP, so
  the spec-shaped grep would silently stop matching there. Forcing `--test-reporter=tap` makes the
  assertion hold identically on both Node versions.
- Left `.github/workflows/test.yml` (Task 7) **without** the flag deliberately, and recorded why in
  Task 8's action text: CI asserts the process exit code, and AC6 requires the workflow's `run:`
  string to stay byte-identical to `release.yml`'s — adding the flag to one workflow would break the
  parity test that same task builds.
- Recorded the reporter behaviour as a new bullet under `## Risk Notes` ("Environment — test
  reporter"), beside the existing MODULE_NOT_FOUND / no-`timeout` note, so a later task does not
  reintroduce a bare grep.

No task ids were renumbered, no task was added or removed, and no acceptance coverage changed — this
round touched verify commands and documentation only.

### Outcome — APPROVED

**Rounds:** 2

- Round 1: NEEDS-REVISION, 1 critical
- Round 2: APPROVED, 0 critical

**Examined:** `ship/pm-update.cjs` (esc:300-309, module.exports:533); `ship/templates/dashboard.html`
(`--text`/`--track` in `:root` and the dark block; clean of `url(`/`@import`/http/`<link>`/`srcset`);
`tests/pm-state-conformance.test.js` (dogfood gate:31, describes:56,185, balanced-tag list:232);
`tests/pm-nudge-verify.test.js` (dogfood gate:197, block:201); `.github/workflows/release.yml`
(checkout@v4, setup-node@v4 node-version '22', `Run tests` → `node --test "tests/*.test.js"`);
a live `node v25.8.1` reporter probe; the `tests/` listing (no `fixtures/` yet); and
`.claude/agent-memory/ship-ship-verifier/`.

**Surviving WARNING (round 2) — applied by hand after approval, not by the replanner:**

- Task 3 — the `<verify>` ended `... && echo IGNORED-BAD || echo ok`, so the whole `&&` chain
  short-circuited into `echo ok` and the command could never fail. Raised in round 1 and left
  unchanged in round 2. Applied the reviewer's recommendation verbatim: inverted the tripwire to
  `! git check-ignore -q ... && echo ok` and dropped the trailing fallback.

**Round-1 SUGGESTION also applied by hand:** Task 3's action now states the `parseRoadmap` layout
constraints (a backlog table must follow a `### M{n}` heading; a `#### ` detail section must not
interrupt a table), so the builder does not discover them through a red verify.
