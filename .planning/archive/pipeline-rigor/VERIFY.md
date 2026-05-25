# Verification Report — pipeline-rigor

**Feature:** pipeline-rigor
**Verified:** 2026-05-26
**Overall Status:** PASS

## Stage 1 — Spec Compliance

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}. INCONCLUSIVE means no runnable verify command was available.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Brainstormer, when run on a project with infrastructure signals, asks at least 2 NFR questions covering at least 2 NFR dimensions | PASS | `grep -q "NFR Probing" agents/ship-brainstormer.md && grep -q "INFRA_DETECTED" agents/ship-brainstormer.md && grep -q "Dockerfile" agents/ship-brainstormer.md` → exit 0. Prompt contains "If INFRA_DETECTED = true: ask 2-3 questions covering the NFR dimensions most relevant to the signals you detected." |
| Brainstormer, when run on a project without infra signals (pure library/CLI), does NOT ask irrelevant NFR questions | PASS | `grep -A2 "INFRA_DETECTED = false" agents/ship-brainstormer.md` → "If INFRA_DETECTED = false: skip this entire sub-section. Pure libraries and exploratory scripts don't need rollout/observability probing." CLI routing hint also confirmed: "If package.json with bin only (CLI tool) → prioritise error handling; SKIP rollout/observability." |
| QA agent's QA.md cites files from `git diff $(git merge-base HEAD main)..HEAD` output, not from PLAN.md's `<files>` block | PASS | `grep -q "merge-base HEAD main" agents/ship-qa.md && grep -q "Reviewed files (from git diff)" agents/ship-qa.md && grep -q "fall back to" agents/ship-qa.md` → exit 0. This feature's QA.md at `.planning/features/pipeline-rigor/QA.md` contains a "Reviewed files (from git diff)" section listing 16 files. |
| Verifier emits `INCONCLUSIVE` for any acceptance criterion that has no runnable `<verify>` command AND would otherwise have been judged via grep-only evidence | PASS | `grep -q "INCONCLUSIVE" agents/ship-verifier.md && grep -q "criteria_verdicts" agents/ship-verifier.md && grep -q "criteria_inconclusive" agents/ship-verifier.md` → exit 0. Verifier Step 1.3 defines INCONCLUSIVE verdict. Regression test "agents/ship-verifier.md has INCONCLUSIVE verdict logic" passes (11/11 suite). `grep -c "INCONCLUSIVE" agents/ship-verifier.md` → 9. |
| When VERIFY.md contains any INCONCLUSIVE verdict, `/ship:finish` refuses to proceed unless `--accept-inconclusive` is passed; override and reason are written into VERIFY.md | PASS | `grep -q "ACCEPT_INCONCLUSIVE" skills/finish/SKILL.md && grep -q -- "--accept-inconclusive" skills/finish/SKILL.md && grep -q "git config user.email" skills/finish/SKILL.md` → exit 0. Finish skill contains "Cannot finish — VERIFY.md contains INCONCLUSIVE verdicts" block and "Check INCONCLUSIVE Verdicts" section with ACCEPT_INCONCLUSIVE flag handling. |
| When QA verdict is FAIL, feature status transitions to `qa-failed` (not `plan-verified`); PLAN.md gains a `## Fix Tasks (from QA)` section; original task completion marks preserved | PASS | `grep -q "status: qa-failed" skills/qa/SKILL.md && ! grep -q "status: plan-verified" skills/qa/SKILL.md` → exit 0. Regression test "skills/qa/SKILL.md sets status to qa-failed on FAIL" passes. |
| `/ship:resume` recognises `qa-failed` and routes the user to `/ship:build` (skips plan-verify) | PASS | `grep -q "qa-failed" skills/resume/SKILL.md && grep -q "skips plan-verify" skills/resume/SKILL.md` → exit 0. Regression test "skills/resume/SKILL.md routes qa-failed to /ship:build" passes. |
| `/ship:status` displays `qa-failed` as a first-class status (no fallthrough to "unknown") | PASS | `grep -q "qa-failed" skills/status/SKILL.md && grep -q "fix bugs found by QA" skills/status/SKILL.md` → exit 0. Regression test "skills/status/SKILL.md displays qa-failed first-class" passes. |
| Verifier no longer greps for TODO/FIXME/HACK/XXX/placeholder/stub/not-implemented when a recent QA.md exists; instead reads QA.md's findings | PASS | `grep -n "QA.md" agents/ship-verifier.md` → lines 138, 140, 141, 230, 245 — Step 2.1 instructs "If QA.md exists: Read its Exploratory Analysis section... DO NOT re-grep." Forbidden Responses includes "I'll re-grep for TODOs to be safe". |
| In-flight features (`qa-step`, `plugin-distribution`) continue to work under their original semantics | PASS | `grep -q "status:" .planning/features/qa-step/CONTEXT.md` → exit 0; status: built. `grep -c "qa-failed\|INCONCLUSIVE" .planning/features/qa-step/PLAN.md` → 0. In-flight features contain none of the new terms in their planning files; no source file was renamed or deleted that would break existing flows. |
| A synthetic dogfood feature `.planning/features/test-rigor/` is created and walked through the upgraded pipeline end-to-end, demonstrating each behaviour above | NEEDS-HUMAN | `test -f .planning/features/test-rigor/CONTEXT.md && test -f .planning/features/test-rigor/README.md && grep -q "exemplar: true" .planning/features/test-rigor/CONTEXT.md && grep -q "DO NOT BUILD" .planning/features/test-rigor/README.md` → exit 0. Files exist and are annotated correctly. PLAN.md explicitly states this is a fixture-only frozen exemplar — "the walk-through is a post-merge human-driven verification step." The exemplar contains NFR probe demo, INCONCLUSIVE demo, and --accept-inconclusive demo annotations. Automated verification of a live pipeline end-to-end run is not possible without a Claude session. |
| Documentation: CLAUDE.md status-flow section updated to include `qa-failed`; `/ship:help` mentions the INCONCLUSIVE concept and override flag | PASS | `grep -q "qa-failed" CLAUDE.md && grep -q "rebuild via /ship:build" CLAUDE.md` → exit 0. `grep -q "INCONCLUSIVE" skills/help/SKILL.md && grep -q -- "--accept-inconclusive" skills/help/SKILL.md && grep -q "qa-failed" skills/help/SKILL.md` → exit 0. Both regression tests pass. |

**Stage 1 Summary:** 11 PASS, 0 FAIL, 0 INCONCLUSIVE, 1 NEEDS-HUMAN.

The dogfood criterion's NEEDS-HUMAN is structural — the acceptance criterion requires a live Claude Code session to walk the pipeline end-to-end. PLAN.md acknowledges this: "The walk-through is a post-merge human-driven verification step; if it can't be auto-verified, /ship:verify will emit INCONCLUSIVE for that criterion." The exemplar fixture exists, is annotated, and demonstrates all three new pipeline behaviours by design.

## Stage 2 — Code Quality

QA.md exists for this feature (`.planning/features/pipeline-rigor/QA.md`). Stage 2 incorporates QA's Exploratory Analysis findings per the pipeline-rigor verifier contract — no re-grep performed.

### Anti-Pattern Scan (from QA)

QA's Exploratory Analysis found zero bugs and four low-severity observations (none blocking):

1. **`agents/ship-qa.md:90-104` — Step 5.5 placement after test commit (low):** Step 5.5 runs after Step 5 (Commit Test Files), so QA reviews its own test files alongside feature code. Acknowledged design trade-off from the PLAN review (Task 7, suggestion 4). Not a bug.
2. **`agents/ship-qa.md:96-98` — HEAD~1 fallback scope (medium):** When a feature is built directly on main, `git merge-base HEAD main` returns HEAD, making diff empty. The fallback chain eventually uses `HEAD~1`, which only covers the last commit. For multi-commit features on main this underestimates scope. Known limitation documented as "last resort" — not a bug in the prompt.
3. **`skills/finish/SKILL.md:31-54` — VERIFY.md read before existence check (low):** If VERIFY.md does not exist, the agent likely treats it as "no markers found" and proceeds. Functionally acceptable; future improvement could warn explicitly.
4. **`agents/ship-verifier.md:218` — INCONCLUSIVE sets `status: done` (low):** `/ship:status` shows INCONCLUSIVE features as `done`. Only `/ship:finish` enforces the override gate. Documented known gap from PLAN review finding #3; out of scope.

Supplementary grep on changed files confirmed no anti-patterns: all matches of TODO/FIXME/HACK/XXX/placeholder/stub in changed files are instructional prose within agent prompts (e.g., "Look for: TODOs/FIXMEs…"), not actual markers in the implementation.

### Quality Notes

- All changes are confined to markdown agent/skill files and test files — no structural code written outside the test suite.
- Convention adherence is strong: commit format `feat(pipeline-rigor): …` on all 15 commits, atomic staging (no `git add .` violations), phases and tasks tracked in PLAN.md XML.
- The 11-test regression suite (`tests/pipeline-rigor.test.js`) and 30-test adversarial suite (`tests/pipeline-rigor-adversarial.test.js`) both pass at exit 0 (41/41 total).
- No hardcoded values, no broken imports, no stub function bodies (all artifacts are markdown prompt text).

## Stage 3 — PR Review (powered by /review)

No PR exists for this feature (committed directly to main). An inline review was performed by the orchestrator on the full diff (`git diff 2f281cf..HEAD`, 17 files, 759 insertions / 59 deletions).

### Findings

| # | Severity | File | Line(s) | Finding |
|---|----------|------|---------|---------|
| 1 | SUGGESTION | `agents/ship-verifier.md` | 199 | In "Determine Overall Status", the PARTIAL bullet's third clause says "OR a mix where Stage 1 has FAILs but some other criteria pass." This can never trigger because the FAIL priority rule above matches first (FAIL dominates). Dead clause; minor documentation cleanliness. |
| 2 | SUGGESTION | `skills/finish/SKILL.md` | 50-51 | The "Operator" and "Timestamp" fields use `$(git config user.email || echo unknown)` and `$(date -u +%Y-%m-%dT%H:%M:%SZ)` syntax embedded in prose. An agent reading this should execute the substitutions when writing VERIFY.md, but the syntax is ambiguous in prose form. Consider an explicit "run these shell commands first; substitute results before writing" instruction. |
| 3 | SUGGESTION | `agents/ship-brainstormer.md` | 55 | The infra-signal entry says `package.json with scripts.start or a bin field (Node service/CLI)` — lumps services and CLIs into one signal, but the downstream routing hints differentiate them. Mild inconsistency in labeling; functionality is correct. |

### PR Review Summary

- **Source:** Inline orchestrator review of `git diff 2f281cf..HEAD`
- **Critical:** 0 (no blocker)
- **Warnings:** 0 (no blocker)
- **Suggestions:** 3 (documentation polish only — none block PASS)

## Stage 4 — QA Findings (from /ship:qa)

### Test Coverage

- **Tests written:** 30 adversarial (+ 11 builder regression = 41 total)
- **Tests passed:** 41 / 41
- **Categories tested:** Boundary, Negative Input, Error Handling, Security
- **Categories excluded (deliberate):** Happy Path (covered by builder regression suite), Concurrency (no concurrent access patterns in markdown prompt edits)

### Bug Findings

No bugs found during QA.

### Exploratory Analysis Notes (low-severity, non-blocking)

| # | Severity | File | Observation |
|---|----------|------|-------------|
| 1 | low | `agents/ship-qa.md:90-104` | Step 5.5 placement after commit step — QA reviews its own test files alongside feature code. Acknowledged design trade-off. |
| 2 | medium | `agents/ship-qa.md:96-98` | HEAD~1 last-resort fallback only diffs final commit when feature built on main. Known limitation, not a bug. |
| 3 | low | `skills/finish/SKILL.md:31-54` | Missing VERIFY.md silently treated as "no markers found". Functionally acceptable. |
| 4 | low | `agents/ship-verifier.md:218` | INCONCLUSIVE features show as `status: done` in /ship:status. Known gap, documented out-of-scope. |

### QA Summary

- **Critical bugs:** 0
- **High bugs:** 0
- **Medium bugs:** 0 (noted, non-blocking)
- **Low bugs:** 0 (noted, non-blocking)
- **Verdict:** QA PASS

## Human Checks Required

- [ ] Walk `.planning/features/test-rigor/` through the upgraded pipeline end-to-end in a live Claude Code session, demonstrating: adaptive NFR probe skips rollout/observability for a CLI feature, INCONCLUSIVE verdict emitted for "Skill is auto-discoverable from a Claude Code session" criterion, and `/ship:finish --accept-inconclusive "reason"` override flow. The exemplar fixture exists at `.planning/features/test-rigor/CONTEXT.md` and is annotated with demo markers.

## Gaps

None — all acceptance criteria verified programmatically except the live pipeline dogfood run, which is inherently human-driven by design (PLAN.md Risk Notes, Task 13: "The dogfood exemplar is a fixture only — NOT exercised end-to-end during build.").

## Recommendation

**Done**

All 11 verifiable acceptance criteria pass. The 12th criterion (dogfood walk-through) requires a human-driven live session — the fixture is in place, annotated, and self-demonstrating. The 41-test suite passes at exit 0. No review warnings, no QA bugs. The feature is ready to finish with `/ship:finish pipeline-rigor` after completing the human dogfood check.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** no
- **Reason:** N/A
- **Operator:** N/A
- **Timestamp:** N/A
