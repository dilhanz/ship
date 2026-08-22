---
name: dogfood-suite-failure
description: RESOLVED 2026-08-23 — the pm-state-conformance dashboard code-span assertion now passes everywhere; a future failure is a real regression, record it as a FAIL
metadata:
  type: project
---

`tests/pm-state-conformance.test.js` ("renders the project name, every milestone, and every backlog item from ROADMAP.md") used to fail on any machine holding local `.project-manager/` state while a clean checkout stayed green. **That gap was closed by the `dashboard-code-spans` feature (2026-08-23). This note no longer excuses the failure.**

What changed:

- `ship/pm-update.cjs` renders authored prose through a new `inline()` helper — HTML-escape first, then convert markdown code spans to `<code>` — so a backlog cell authored as ``Re-run `check` ...`` now reaches the dashboard as `<code>check</code>`. Attributes and machine-derived values stay on plain `esc()`.
- The three formerly gitignored-state-gated dogfood blocks (two in `tests/pm-state-conformance.test.js`, one in `tests/pm-nudge-verify.test.js`) now run against the committed fixture `tests/fixtures/pm-state/`, with the dashboard generated into a temp dir at test time. No gate, no skips.
- `.github/workflows/test.yml` runs the suite on every push and pull request with the same command string `release.yml` uses, so the assertion is green in CI on every change rather than only at a version tag.

**Why it matters:** this note used to tell the verifier to excuse the failure rather than report it. Now that the rendering exists and the blocks run on every checkout, that instruction would suppress a genuine regression — a broken `inline()`, a reverted call site, or a fixture edit that drops the tripwire row.

**How to apply:** if this assertion fails again, it is a **real regression — record it as a FAIL** and write a fix task. Do not classify it as pre-existing and do not skip it. The failure is now reproducible on any clean checkout, so a clean-worktree run is a confirmation, not an exoneration. The environment traps in the related note still apply to *how* you invoke the suite.

Related: [[test-runner-environment]]

**One durability caveat, found during the dashboard-code-spans verification.** The conformance
assertion compares *tag-stripped* dashboard text against *backtick-stripped* ROADMAP cells, so it only
proves code-span rendering while the fixture actually contains a code span. Deleting the backticks from
`tests/fixtures/pm-state/ROADMAP.md`'s tripwire row makes it pass vacuously — verified by mutation.
`tests/dashboard-inline-adversarial.test.js` now guards that directly ("the fixture ROADMAP still
carries a backtick-bearing backlog cell"), so treat *that* test failing as the same class of regression.
