# QA Report — {feature-name}

**Feature:** {feature-name}
**Tested:** {date}
**Overall Status:** PASS | FAIL

## Test Plan

### Risk Assessment

[Which of the 6 categories (happy path, boundary, negative input, error handling, concurrency, security) are relevant to this feature and why. Categories not relevant should be listed with a brief reason for exclusion.]

### Selected Categories

| Category | Relevant? | Rationale |
|----------|-----------|-----------|
| Happy Path | Yes/No | [Why] |
| Boundary | Yes/No | [Why] |
| Negative Input | Yes/No | [Why] |
| Error Handling | Yes/No | [Why] |
| Concurrency | Yes/No | [Why] |
| Security | Yes/No | [Why] |

## Test Files Written

| # | File | Category | Tests | Commit |
|---|------|----------|-------|--------|
| 1 | [path/to/test.ts] | [category] | [count] | [short-hash] |

(If no tests written: "No test files written — see Exploratory Analysis for findings.")

## Test Results

**Total:** [N] tests | **Passed:** [N] | **Failed:** [N]

[Test command output summary]

## Bug Findings

| # | Severity | Category | Description | File | Evidence |
|---|----------|----------|-------------|------|----------|
| 1 | critical/high/medium/low | [category] | [description] | [file:line] | [test output or analysis] |

(If none: "No bugs found.")

### Severity Definitions

- **Critical:** Data loss, security vulnerability, crash in main flow
- **High:** Feature broken for common use case, silent data corruption
- **Medium:** Edge case failure, poor error message, minor logic error
- **Low:** Code smell, missing validation for unlikely input, style issue

## Exploratory Analysis

[Observations from code review beyond test coverage: potential race conditions, missing error handling, hardcoded values, untested paths. Each item with file:line reference.]

(If clean: "No additional concerns found beyond test coverage.")

## Verdict

**PASS** | **FAIL**

[1-2 sentences explaining the verdict. If FAIL, list the critical/high bugs that caused it.]
