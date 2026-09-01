# Verification Report — {feature-name}

**Feature:** {feature-name}
**Verified:** {date}
**Head:** {git rev-parse HEAD at verification time}
**Overall Status:** PASS | FAIL | INCONCLUSIVE

(A Stage 1 flush — written after the criteria table is complete and before Stage 2 begins — carries `**Status:** IN PROGRESS — Stage 1 only` in place of the `**Overall Status:**` line and omits the `**Head:**` line entirely; the verifier's final write, after the bug hunt, replaces both with the real verdict and the real head stamp. A report carrying the IN PROGRESS marker is a dead run's partial evidence, never a verdict: it reads as "gate started and died", and the salvage path supersedes it from `.review-scratch/verify.json`.)

## Stage 1 — Acceptance Criteria

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}. INCONCLUSIVE means no runnable verify command was available; grep-only file existence does not upgrade to PASS.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| [Criterion from CONTEXT.md] | PASS / FAIL / INCONCLUSIVE | [Command run, output observed, or file path checked] |

## Stage 2 — Bug Hunt & Quality

(If this run was narrowed by profile: open this section with the line "Stage 2 narrowed by profile: criteria-only — discretionary bug hunt and anti-pattern scan skipped." copied verbatim — audits grep for that exact string, so do not paraphrase or reword it. Extra context goes in a following sentence. The Carried Review Findings table remains mandatory.)

### Carried Review Findings

Unresolved critical/high findings from REVIEW.md (or the prompt's carry-over block) — each needs a command, not an opinion.

| Severity | Phase | File | Finding | Outcome | Evidence |
|----------|-------|------|---------|---------|----------|
| critical/high | [phase id] | [file:line] | [what the reviewer found] | reproduced / not reproduced / not testable | [command run and what it showed] |

(If none were carried: "None carried." An empty table must never mean the check was skipped.)

### Adversarial Tests

- **Categories tested:** [e.g. boundary, negative-input, error-handling]
- **Tests written:** [N]  **Passed:** [N] / [N]
- **Test files committed:** [list, or "None"]

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | critical/high/medium/low | [category] | [description] | [file:line] | [Open/Fixed] |

(If none: "No bugs found.")

### Anti-Pattern Scan

- TODO/FIXME/placeholder/stub markers: [list files, or "None"]
- Empty function bodies / hardcoded values: [list, or "None"]
- Broken imports / convention violations: [list, or "None"]

### Quality Notes

- [Convention adherence, unnecessary abstractions, error handling — observations only]

(If clean: "No quality issues found.")

## Human Checks Required

[Items that cannot be verified programmatically:]

- [ ] [Description of what to manually verify]

(If none: "None — all criteria verified programmatically")

## Gaps

[If FAIL or INCONCLUSIVE:]

- [Gap description] — [Recommended fix]

## Fix Tasks

[If FAIL, write specific fix tasks in the same XML format as PLAN.md. These will be appended to PLAN.md for the next build run.]

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

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** {yes | no}
- **Reason:** {operator-supplied reason if applied, otherwise N/A}
- **Operator:** {git config user.email at time of override}
- **Timestamp:** {ISO 8601 timestamp}
