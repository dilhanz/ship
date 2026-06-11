# QA Report — build-quality

**Feature:** build-quality
**Tested:** 2026-06-11
**Overall Status:** PASS

## Test Plan

### Risk Assessment

| Category | Relevant? | Rationale |
|----------|-----------|-----------|
| Happy Path | Yes | New `extractReviewResult` function and `ship-reviewer` routing in the hook have a main flow that must always work |
| Boundary | Yes | The raw-JSON balanced-brace fallback has known edge cases; large messages have truncation logic; multiple fenced blocks in one message |
| Negative Input | Yes | Hook accepts arbitrary agent output; must handle null, numbers, empty strings, malformed JSON, wrong block types |
| Error Handling | Yes | Hook must never throw or block; outer try/catch must cover all paths including numeric `last_assistant_message` |
| Concurrency | No | Hook is single-process, no shared mutable state |
| Security | No | Hook processes agent output in a read-only, internal pipeline context; no user-controlled file paths or shell commands |

### Selected Categories

Happy Path, Boundary, Negative Input, Error Handling

## Test Files Written

| # | File | Category | Tests | Commit |
|---|------|----------|-------|--------|
| 1 | `tests/build-quality-adversarial.test.js` | Boundary, Negative, Error Handling, Content | 37 | c276ff4 |

## Test Results

**Total:** 37 tests | **Passed:** 37 | **Failed:** 0

Command: `node --test tests/build-quality-adversarial.test.js`

```
# tests 37
# suites 4
# pass 37
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2202.5402
```

The full suite (138 tests) also passes: `node --test tests/*.test.js` — 138 pass, 0 fail.

## Bug Findings

| # | Severity | Category | Description | File | Evidence |
|---|----------|----------|-------------|------|----------|
| 1 | medium | boundary | `extractReviewResult` raw-JSON fallback accepts any JSON with `"status":"APPROVED"` or `"status":"NEEDS_FIXES"`, regardless of the surrounding fence tag — a `build_result`-tagged block containing reviewer-status JSON passes through silently instead of triggering recovery | `hooks/subagent-stop.cjs:117-135` | Test A3: documented as actual-behavior test; confirmed by manual node eval of regex on `build_result`-fenced content |
| 2 | low | negative | `extractReviewResult` raw-JSON fallback (line 130) does not check for a `feature` field before accepting, unlike the builder fallback (line 44) which guards with `parsed.feature` — a bare `{"status":"APPROVED"}` anywhere in a message would pass through | `hooks/subagent-stop.cjs:130` | Code review: inconsistency between builder and reviewer fallback guards |

### Severity Definitions

- **Critical:** Data loss, security vulnerability, crash in main flow
- **High:** Feature broken for common use case, silent data corruption
- **Medium:** Edge case failure, poor error message, minor logic error
- **Low:** Code smell, missing validation for unlikely input, style issue

## Exploratory Analysis

### Reviewed files (from git diff)

Files diffed from `93ceb95..HEAD`:

- `hooks/subagent-stop.cjs` — reviewed lines 1-237
- `agents/ship-reviewer.md` — reviewed lines 1-93
- `agents/ship-builder.md` — reviewed frontmatter (lines 1-11); model line confirmed removed
- `skills/build/SKILL.md` — reviewed full file (320 lines); all gate sections present
- `ship/workflows/go.md` — reviewed full file; NEEDS_CONTEXT stop conditions updated correctly
- `CLAUDE.md` — reviewed agents list, directory structure, key concepts sections
- `README.md` — reviewed build description, feature directory tree, core principles
- `tests/subagent-stop.test.js` — reviewed all 8 new review_result tests (lines 261-412)
- `.planning/features/build-quality/CONTEXT.md` — read for spec
- `.planning/features/build-quality/PLAN.md` — read for spec

### Findings

**`hooks/subagent-stop.cjs:117-135` — raw-JSON fallback is fence-tag-agnostic (Bug #1)**

The `extractReviewResult` fallback regex matches any JSON object with a valid reviewer status (`APPROVED`, `NEEDS_FIXES`). It does not verify the content came from a `review_result`-tagged fence. This means: if the reviewer's output contains a `build_result`-fenced block (e.g. a copy from builder context) with `"status":"APPROVED"` in the JSON body, the hook will silently accept it. Practical impact is low because `APPROVED`/`NEEDS_FIXES` do not appear in normal builder or QA output. However the `extractBuildResult` fallback has the same structural issue — it would accept `"status":"COMPLETE"` from a non-`build_result` fence too.

**`hooks/subagent-stop.cjs:130` — reviewer fallback missing `feature` guard (Bug #2)**

The reviewer raw-JSON fallback only validates `REVIEW_VALID_STATUSES.includes(...)`. The builder fallback at line 44 additionally checks `parsed.feature` before returning the result. The reviewer fallback accepts `{"status":"APPROVED"}` without any other fields. This is inconsistent and would silently accept a minimal stub as a valid review result.

**`skills/build/SKILL.md:176` — diff range skip on empty result.commits**

Section 3.2 step 1 states: "If `result.commits` is empty or git rev-parse fails, skip the review with a 'review skipped: no diff range' concern." However, if 3.1 (Trust-But-Verify) made fix commits, those fix commits are not in `result.commits` (which came from the builder's original result). The instruction says "plus any fix-round commits from 3.1" but the skip fires on the original `result.commits` being empty, before considering fix commits. In practice the builder almost always provides commit hashes, so this is a low-priority edge case. Severity: **low**.

**`agents/ship-reviewer.md` — scope field doc gap**

The output spec in the agent body shows `"scope": "phase:{id}"` only. The PLAN.md spec for the JSON contract shows `"scope": "phase:{id}" | "all"`. The hook accepts both. The discrepancy is in the agent's instruction, not the hook — the reviewer might never emit `"all"` scope. Not a blocking issue.

**No TODOs, FIXMEs, HACKs, stubs, or empty function bodies** found in any reviewed file.

**No hardcoded values or missing input validation** found beyond the bugs above.

## Verdict

**PASS**

No critical or high severity bugs were found. The feature delivers all acceptance criteria: ship-reviewer agent is implemented with the correct contract; subagent-stop.cjs validates `review_result` with proper recovery messages; the build skill has Trust-But-Verify (3.1) and Review Gate (3.2) sections in the correct order; interactive NEEDS_CONTEXT with a 2-round cap is in both build skill and go workflow; ship-builder.md has no pinned model. Two medium/low findings were recorded (raw-JSON fallback fence-tag agnosticism and inconsistent feature-guard in reviewer fallback) — neither blocks the feature in realistic usage.
