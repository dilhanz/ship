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

(If this run was narrowed by profile: open this section with the line "Stage 2 narrowed by profile: criteria-only — discretionary bug hunt and anti-pattern scan skipped." copied verbatim — audits grep for that exact string, so do not paraphrase or reword it. Extra context goes in a following sentence. The Carried Review Findings table remains mandatory, and the Trial Merge and the repo checklist rows remain mandatory too; only the generic checklist rows are omitted.)

### Carried Review Findings

Every finding from REVIEW.md (or the prompt's carry-over blocks): the unresolved critical/high ones are mandatory, the recorded medium/low ones are located targets — each needs a command, not an opinion. Unresolved rows first.

| Severity | Phase | File | Finding | Outcome | Evidence |
|----------|-------|------|---------|---------|----------|
| critical/high | [phase id] | [file:line] | [what the reviewer found — unresolved] | reproduced / not reproduced / not testable | [command run and what it showed] |
| medium/low | [phase id] | [file:line] | [what the reviewer found — recorded] | reproduced / not reproduced / not testable | [command run and what it showed] |

(If none were carried: "None carried." An empty table must never mean the check was skipped.)

### Trial Merge

HEAD built alone in a detached throwaway worktree as a baseline, then main merged in and built again. The feature branch is never touched. Runs at every depth.

- **Target:** [origin/main | main | master | none found]
- **Command:** [build command] (source: verify-checklist.md Build line | discovered)
- **Outcome:** PASS | FAIL | NOT_RUNNABLE
- **Evidence:** [baseline exit code, merge output and post-merge build exit code; conflicting files or failing output on FAIL; the reason on NOT_RUNNABLE]

(FAIL — a conflict, or a green baseline that goes red after the merge — is also a high-severity Open bug in Bug Findings. A red baseline means the environment, not main, broke the build (e.g. missing dependencies in the fresh worktree): that is NOT_RUNNABLE, never FAIL. NOT_RUNNABLE goes in Gaps with the reason.)

### Verify Checklist

| Item | Source | Verdict | Evidence |
|------|--------|---------|----------|
| [checklist item] | generic / repo | PASS / FAIL / N/A | [command run, or file:line; N/A needs a one-line reason] |

One row per item, every row decided, none skipped. N/A needs a reason. A FAIL row also appears in Bug Findings at medium severity or above. Repo rows come from `.planning/verify-checklist.md`; when that file is absent, state "No repo checklist" here. At criteria-only, the generic rows are omitted and this section says so.

### Adversarial Tests

- **Categories tested:** [e.g. boundary, negative-input, error-handling]
- **Tests written:** [N]  **Passed:** [N] / [N]
- **Test files committed:** [list, or "None"]

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | critical/high/medium | [category] | [description] | [file:line] | Open |
| 2 | low | [category] | [description] | [file:line] | Left open |

(If none: "No bugs found.")

One row per defect class, not per call site: the Description starts with the pattern and the File cell lists every site (`a.cs:12, b.cs:40`), so the fix task covers them all in one round.

Any row with Status `Open` makes the Overall Status FAIL. The verifier never fixes code, so every critical, high, or medium bug is Open. A low bug is `Left open`: recorded with its evidence, but it does not decide the verdict and gets no fix task. Citation rule: something judged not to be a defect (accepted by design, outside scope) moves to Quality Notes or Gaps only with a citation quoting the CONTEXT.md `## Decisions` or `## Scope` line that covers it; an uncited item stays here and fails the verify.

### Anti-Pattern Scan

- TODO/FIXME/placeholder/stub markers: [list files, or "None"]
- Empty function bodies / hardcoded values: [list, or "None"]
- Broken imports / convention violations: [list, or "None"]

### Quality Notes

- [Convention adherence, unnecessary abstractions, error handling — observations only]
- [Non-defect moved out of Bug Findings] — cites CONTEXT.md: "{quoted line}"

(If clean: "No quality issues found.")

## Human Checks Required

[Items that cannot be verified programmatically:]

- [ ] [Description of what to manually verify]

(If none: "None — all criteria verified programmatically")

## Gaps

[If FAIL or INCONCLUSIVE:]

- [Gap description] — [Recommended fix]
- [Non-defect moved out of Bug Findings] — cites CONTEXT.md: "{quoted line}"

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
