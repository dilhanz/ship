# Verification Report — {feature-name}

**Feature:** {feature-name}
**Verified:** {date}
**Overall Status:** PASS | PARTIAL | FAIL

## Stage 1 — Spec Compliance

| Criterion | Status | Evidence |
|-----------|--------|----------|
| [Criterion from CONTEXT.md] | PASS / FAIL / NEEDS-HUMAN | [Command run, output observed, or file path checked] |

## Stage 2 — Code Quality

[Only completed if all Stage 1 criteria passed. Otherwise: "Skipped — Stage 1 has failures."]

### Anti-Pattern Scan

- TODO/FIXME/placeholder strings found: [list files, or "None"]
- Stub implementations: [list, or "None"]
- Hardcoded values that should be config: [list, or "None"]

### Quality Notes

- [Convention adherence, unnecessary abstractions, error handling — observations only]

(If clean: "No quality issues found.")

## Stage 3 — PR Review (powered by /review)

[Always populated from Claude Code's `/review` skill findings. The review is context-aware — aligned with the feature's goals and acceptance criteria from CONTEXT.md and PLAN.md.]

### Findings

| # | Confidence | Severity | File | Line(s) | Finding | Evidence |
|---|------------|----------|------|---------|---------|----------|
| 1 | [80-100] | CRITICAL / WARNING / SUGGESTION | [file] | [lines] | [description] | [tool output proving the issue] |

(If none: "No issues found — code is clean.")

### PR Review Summary

- **Source:** Claude Code `/review` skill with Ship context
- **Critical:** [N] (blocks PASS)
- **Warnings:** [N] (blocks PASS)
- **Suggestions:** [N]

## Stage 4 — QA Findings (from /ship:qa)

[Always populated from the QA agent's QA.md report. QA testing was performed by the ship-qa agent before verification.]

### Test Coverage

- **Tests written:** [N]
- **Tests passed:** [N] / [N]
- **Categories tested:** [list of categories from QA.md]

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | critical/high/medium/low | [category] | [description] | [file:line] | [Open/Fixed] |

(If none: "No bugs found during QA.")

### QA Summary

- **Critical bugs:** [N]
- **High bugs:** [N]
- **Medium bugs:** [N] (noted, non-blocking)
- **Low bugs:** [N] (noted, non-blocking)
- **Verdict:** QA [PASS/FAIL]

## Human Checks Required

[Items that cannot be verified programmatically:]

- [ ] [Description of what to manually verify]

(If none: "None — all criteria verified programmatically")

## Gaps

[If PARTIAL or FAIL:]

- [Gap description] — [Recommended fix]

## Fix Tasks

[If PARTIAL or FAIL, write specific fix tasks in the same XML format as PLAN.md. These will be appended to PLAN.md for the next build run.]

<task id="N" status="pending">
  <name>Fix: [description]</name>
  <files>[exact file paths]</files>
  <action>[Specific fix instructions]</action>
  <verify>[Command that proves the fix works]</verify>
</task>

[If PASS, omit this section entirely.]

## Recommendation

**Done** | **Needs fixes** | **Needs human review**

[1-2 sentences explaining the recommendation]
