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
