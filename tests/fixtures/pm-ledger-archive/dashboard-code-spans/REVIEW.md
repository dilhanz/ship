# Review — dashboard-code-spans

## Phase 1 — Rendering (round 1)

Status: APPROVED
Verify: 2 re-run — 2 pass, 0 fail, 0 not runnable
Reviewed: 2 file(s)

- [low] ship/pm-update.cjs:318: A markdown double-backtick span (``x``) leaves stray literal backticks — the regex body requires 1+ characters, so the leading empty pair does not match and the inner pair converts, producing `<code>x</code>` with an orphan backtick on each side. Tags stay balanced, nothing is injectable, and single-backtick spans (the only form the pm-state format authors) render correctly. — recorded

## Phase 2 — Fixture and un-gating (round 1)

Status: APPROVED
Verify: 3 re-run — 3 pass, 0 fail, 0 not runnable
Reviewed: 8 file(s)

- [low] tests/pm-nudge-verify.test.js:206,240,258: Leftover "real state" naming after the retarget — the temp dir prefix is still `ship-nudge-real-` and the fixture contents are bound to a local named `real`. Behaviour is correct; the names now describe the thing that was replaced. — recorded

## Phase 3 — Adversarial tests, CI, and housekeeping (round 1)

Status: APPROVED
Verify: 3 re-run — 3 pass, 0 fail, 0 not runnable
Reviewed: 5 file(s)

- [low] .claude/agent-memory/ship-ship-verifier/MEMORY.md:3: The committed MEMORY.md index links to test-runner-environment.md, which was untracked, so a fresh clone would get an index entry and a wiki-link pointing at a missing file. Plan artifact (task 8's <files> listed only the two committed files), not a builder error. — recorded (subsequently fixed in bad99b7)
- [low] .github/workflows/test.yml:11: test.yml declares no `permissions:` block, so the job inherits the repository default GITHUB_TOKEN scope, while release.yml pins `contents: write` deliberately. The job only checks out and runs `node --test`, so `contents: read` would suffice. — recorded

### Builder concerns (phase 3)

- `.claude/agent-memory/ship-ship-verifier/test-runner-environment.md` was still untracked, so the committed MEMORY.md index linked to a file git did not carry. Outside task 8's declared `<files>`, so left alone rather than widening the commit. (Resolved during the verify stage in bad99b7.)
- `tests/ci-workflow-parity.test.js` accepts only the single-line `run: {command}` form. Both workflows use it today and a parse miss fails loudly by design (verified: renaming the step or removing the run line both yield null), but rewriting either step as a YAML block scalar would fail the test rather than compare it.

---

No phase produced a critical or high finding, so no fix round ran. No unresolved findings were carried into verification.
