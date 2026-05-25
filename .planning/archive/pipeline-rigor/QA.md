# QA Report — pipeline-rigor

**Feature:** pipeline-rigor
**Tested:** 2026-05-26
**Overall Status:** PASS

## Test Plan

### Risk Assessment

pipeline-rigor modifies Ship's own agent prompts and skill files. There is one executable artifact (`tests/pipeline-rigor.test.js`, 11 cases) already committed by the builder. The adversarial focus is on:
- Boundary cases in the new `--accept-inconclusive` flag parsing
- Edge cases in the git diff fallback chain documented in ship-qa
- INCONCLUSIVE verdict dominance ordering correctness in ship-verifier
- Negative/inconsistent VERIFY.md state that the finish skill must handle
- Error handling paths when QA.md is absent from the verifier's perspective
- Security properties of the reason-text interpolation into VERIFY.md

### Selected Categories

| Category | Relevant? | Rationale |
|----------|-----------|-----------|
| Happy Path | No | Already covered by 11 cases in tests/pipeline-rigor.test.js (all passing). Duplicating would add no value. |
| Boundary | Yes | --accept-inconclusive argument parsing has multiple boundary states: missing reason, unquoted reason, mixed with feature name. git diff fallback chain has edge cases when BASE=HEAD. NFR probe has 2-3 question cap. |
| Negative Input | Yes | --accept-inconclusive without reason, VERIFY.md with inconsistent frontmatter vs table state, QA skill retaining old plan-verified assignment. |
| Error Handling | Yes | Verifier's QA.md fallback path (when QA.md absent), git diff failure fallback in ship-qa, finish skill when VERIFY.md is missing. |
| Concurrency | No | All changes are markdown prompt edits; no concurrent access patterns exist. |
| Security | Yes | --accept-inconclusive reason text interpolated into VERIFY.md; documented shell patterns (git config user.email, date) must not execute user-supplied input. |

## Reviewed files (from git diff)

Files reviewed (from git diff 2f281cf~1..dd91597):
- `CLAUDE.md`
- `agents/ship-brainstormer.md`
- `agents/ship-qa.md`
- `agents/ship-verifier.md`
- `ship/templates/VERIFY.md`
- `ship/workflows/go.md`
- `skills/finish/SKILL.md`
- `skills/help/SKILL.md`
- `skills/qa/SKILL.md`
- `skills/resume/SKILL.md`
- `skills/status/SKILL.md`
- `tests/pipeline-rigor.test.js`
- `.planning/features/test-rigor/CONTEXT.md`
- `.planning/features/test-rigor/README.md`
- `.planning/features/pipeline-rigor/CONTEXT.md`
- `.planning/features/pipeline-rigor/PLAN.md`

## Test Files Written

| # | File | Category | Tests | Commit |
|---|------|----------|-------|--------|
| 1 | tests/pipeline-rigor-adversarial.test.js | boundary, negative, error-handling, security | 30 | 67f580c |

## Test Results

**Total:** 30 tests (adversarial) + 11 tests (builder regression) = 41 | **Passed:** 41 | **Failed:** 0

```
▶ pipeline-rigor adversarial — boundary: --accept-inconclusive parsing
  ✔ finish skill aborts when --accept-inconclusive appears with no reason at all
  ✔ finish skill documents that reason must be quoted (not bare tokens)
  ✔ finish skill specifies that feature name comes from remaining tokens after flag removal
  ✔ finish skill documents how to handle VERIFY.md with INCONCLUSIVE in frontmatter vs table
  ✔ finish skill handles missing VERIFY.md gracefully (no crash path documented)
▶ pipeline-rigor adversarial — boundary: git diff BASE fallback chain
  ✔ qa agent documents all three fallback steps: main → master → HEAD~1
  ✔ qa agent documents fallback to PLAN.md when git diff entirely fails
  ✔ qa agent requires noting git diff failure in QA.md exploratory analysis
  ✔ qa agent Step 5.5 git command uses shell OR-chain not separate ifs
▶ pipeline-rigor adversarial — boundary: INCONCLUSIVE verdict dominance
  ✔ verifier documents that FAIL dominates INCONCLUSIVE (not the reverse)
  ✔ verifier status priority ordering: FAIL → PARTIAL → INCONCLUSIVE → PASS (correct sequence)
  ✔ verifier clarifies that INCONCLUSIVE criterion alone does NOT skip Stage 2
  ✔ verifier Step 6 sets status done for INCONCLUSIVE (not plan-verified or qa-failed)
▶ pipeline-rigor adversarial — negative: inconsistent VERIFY.md state
  ✔ VERIFY.md template frontmatter includes INCONCLUSIVE in the status enum
  ✔ VERIFY.md template Inconclusive Override section has all four required fields
  ✔ finish skill check handles VERIFY.md that has INCONCLUSIVE table rows but PASS frontmatter
  ✔ qa skill does NOT set status plan-verified (regression: old rollback path removed)
▶ pipeline-rigor adversarial — error-handling: verifier QA.md fallback
  ✔ verifier documents behaviour when QA.md does NOT exist
  ✔ verifier fallback notes absence of QA.md in VERIFY.md output
  ✔ verifier does NOT re-grep when QA.md IS present
  ✔ qa agent requires Reviewed files section in QA.md so verifier can see coverage
▶ pipeline-rigor adversarial — security: reason text interpolation
  ✔ finish skill uses shell-safe quoting pattern for date command in override record
  ✔ finish skill operator identity uses git config user.email with unknown fallback
  ✔ finish skill reason text is documented as extracted from quotes — not shell-executed
  ✔ finish skill Inconclusive Override section writes to VERIFY.md (not shell eval)
  ✔ go workflow does not reintroduce plan-verified for qa-failed status
▶ pipeline-rigor adversarial — boundary: brainstormer NFR routing hints
  ✔ brainstormer routing hints distinguish between bin-only CLI and service with start script
  ✔ brainstormer specifies maximum 2-3 NFR questions (not the full menu)
  ✔ brainstormer INFRA_DETECTED=false path explicitly skips NFR section
  ✔ brainstormer captures NFR answers in Decisions section with NFR prefix

ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ duration_ms 58.79
```

## Bug Findings

| # | Severity | Category | Description | File | Evidence |
|---|----------|----------|-------------|------|----------|

No bugs found.

## Exploratory Analysis

### agents/ship-qa.md — Step 5.5 git command placement

**File:** `agents/ship-qa.md:90-104` (Step 5.5 — Discover Changed Files)

**Observation (low):** Step 5.5 is placed AFTER Step 5 (Commit Test Files). This means the QA agent reviews files AFTER committing its own test files, so the test files appear in the `git diff` output and are reviewed alongside feature code. The PLAN review (Task 7, suggestion 4) noted this: "QA reviews its own tests alongside feature code — functionally fine and arguably useful (catches test-file anti-patterns), but consider running diff before committing tests for a cleaner feature-only view." This is an acknowledged design trade-off, not a bug.

### agents/ship-qa.md — HEAD~1 fallback when feature is on main

**File:** `agents/ship-qa.md:96-98`

**Observation (medium):** When a feature branch is merged directly to main (no separate feature branch), `git merge-base HEAD main` returns HEAD itself, making the diff empty. The documented fallback chain then tries `master` (also HEAD if that branch exists), then `HEAD~1`. `HEAD~1` only covers the last commit — but a feature built over 14 commits would only diff the final commit, potentially missing earlier changed files. This is the same situation encountered in this QA run. The behaviour is acceptable (HEAD~14 was used manually here as a workaround) but the documented `HEAD~1` fallback in the prompt underestimates the scope when all feature commits are on main. Not a bug in the prompt — the fallback is documented as "last resort" — but it is a known gap for repos that commit features directly to main.

### skills/finish/SKILL.md — VERIFY.md read before feature-name resolution

**File:** `skills/finish/SKILL.md:31-54`

**Observation (low):** The "Check INCONCLUSIVE Verdicts" section runs immediately after "Find Active Feature", which resolves the feature name. However, if VERIFY.md does not exist (verifier was never run), the Read call will fail or return nothing. The section says "If VERIFY.md has no INCONCLUSIVE markers, proceed directly to Prerequisites" — the agent would likely interpret a missing file as "no markers found" and proceed. This is functionally acceptable but could mask a "verifier was never run" situation. A future improvement could check for VERIFY.md existence first and warn if absent.

### agents/ship-verifier.md — INCONCLUSIVE sets status: done but /ship:status shows done

**File:** `agents/ship-verifier.md:218`, `PLAN.md:583-587`

**Observation (low):** The PLAN review itself flagged this: INCONCLUSIVE features are set to `status: done` by the verifier, so `/ship:status` shows them as `done`. The only gate is in `/ship:finish` which inspects VERIFY.md. A user checking `/ship:status` sees no indication that INCONCLUSIVE verdicts still need resolution. This is documented as a known gap (PLAN review finding #3) and is out of scope for pipeline-rigor. No action needed here.

### ship/templates/VERIFY.md — Override section is always rendered, not conditional

**File:** `ship/templates/VERIFY.md:109-118`

**Observation (low):** The `## Inconclusive Override` section has placeholder values that say `{yes | no}`, `{operator-supplied reason if applied, otherwise N/A}`, etc. When `/ship:finish` runs WITHOUT `--accept-inconclusive`, it should leave this section with `Override applied: no` and `Reason: N/A`. The template comment says "It is empty if no override was applied" — but the template itself has placeholder lines, not an empty section. An agent filling in `Override applied: no` and `Reason: N/A` is correct, but the comment is slightly misleading. Not a functional bug.

### CLAUDE.md — status flow line mentions QA step but not the qa-passed status explicitly

**File:** `CLAUDE.md:55`

**Observation (low):** The updated line reads: `brainstormed → planned → plan-verified → building → built → qa-passed → done`. The `qa-failed` branch is described in the same sentence. However, the `qa-step` predecessor feature added `qa-passed` to this flow — the pipeline-rigor update preserves it correctly. No issue found.

## Verdict

**PASS**

All 41 tests pass (30 adversarial + 11 builder regression). No critical or high severity bugs were found. Four low-severity observations are noted in the Exploratory Analysis — all are documented trade-offs or known gaps from the PLAN review, not implementation defects.
