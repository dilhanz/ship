---
feature: "remove-legacy-install-tree"
goal: "Delete the tracked v3.0.1 `.claude/` install tree (preserving `.claude/agent-memory/`) and guard its return with a regression test, so this repo loads only the installed plugin's Ship definitions"
---

<!-- Reduced copy of .planning/archive/remove-legacy-install-tree/PLAN.md for CI.
     `.planning/` is gitignored, so the real archive is invisible to a clean checkout.
     Only the bytes ship/pm-update.cjs harvestFeature() actually parses are kept;
     the prose body is dropped. REVIEW.md and VERIFY.md are copied verbatim.
     tests/pm-ledger.test.js re-harvests the real archive when present and asserts
     this fixture still yields identical rows. -->

## Plan Review

### Outcome — APPROVED

**Rounds:** 1
- Round 1: APPROVED, 0 critical

**Examined:** `git ls-files .claude/`, `find .claude/agent-memory -type f`, `git status --porcelain --untracked-files=all .claude`, tests/rearchitecture-v4.test.js:147-151, tests/doctrine-v5.test.js:1-27, tests/pm-wiring.test.js:103, .github/workflows/test.yml, .github/workflows/release.yml:82, tests/ci-workflow-parity.test.js, ship/workflows/go.workflow.js:12, skills/plan/SKILL.md:99, hooks/safety-gate.cjs, hooks/statusline.cjs:109,120, install.js:26, .gitignore, package.json

**Non-blocking findings (all three applied to PLAN.md after approval):**
- [WARNING] task 1 / tests/legacy-install-tree.test.js — a disk-absence assertion on `.claude/settings.local.json` would go permanently red, since Claude Code recreates that file on any permission grant and `.gitignore` changes are out of scope. Applied: the durable guard now covers `settings.json` only; `settings.local.json` is checked once by task 2, with the reasoning recorded in the test header and a new Risk Note.
- [WARNING] task 3 / .github/workflows/test.yml — reference cited line 131; the file is 26 lines and the `node --test` glob is at line 26. Applied: corrected in both the Exploration Summary and task 3.
- [SUGGESTION] task 2 — no `depends` despite its verify running task 1's test file. Applied: `depends="1"` added, making the RED-GREEN pairing explicit.
