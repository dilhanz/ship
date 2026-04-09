---
name: ship:verify
description: Use when a feature build is complete and needs verification against acceptance criteria and independent code review
effort: high
allowed-tools: Read, Agent, Glob, Edit, Bash, Skill
argument-hint: "[feature-name]"
---

Verify the active feature's implementation.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `qa-passed`
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no verifiable features were found

## Run Code Review

Before invoking the verifier, run Claude Code's `/review` skill with Ship context so the review is aligned with the feature's goals and acceptance criteria.

Use the Skill tool:
- skill: "review"
- args: "Review all code changes on the current branch. Use these Ship planning files as context for the feature's goals, acceptance criteria, and design decisions: .planning/features/{name}/CONTEXT.md and .planning/features/{name}/PLAN.md — review through the lens of what this feature is trying to achieve."

After `/review` completes, collect its complete output. Format it as a `## /review Findings` section preserving all findings with their severity levels (CRITICAL, WARNING, SUGGESTION), file paths, line numbers, and descriptions. If `/review` produced no findings, write `## /review Findings\n\nNo issues found.`

## Gather QA Findings

Read `.planning/features/{name}/QA.md` if it exists. Extract:
- Test coverage numbers (tests written, passed, failed)
- Bug findings table with severity, category, description, file, evidence
- QA verdict (PASS/FAIL)

Format as a `## QA Findings` section preserving all findings. If QA.md doesn't exist, write `## QA Findings\n\nNo QA report found — QA was not run.`

## Run Verification

Use the Agent tool to invoke the `ship-verifier` agent with this prompt:

```
Verify feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

## /review Findings (pre-gathered for Stage 3)

{paste the /review findings here}

## QA Findings (pre-gathered for Stage 4)

{paste the QA findings here}

Follow your verification instructions. For Stage 3, write the /review findings above
into VERIFY.md's Stage 3 section. For Stage 4, write the QA findings above into
VERIFY.md's Stage 4 section. Both CRITICAL and WARNING /review findings block a PASS verdict.
Critical and high QA bugs also block a PASS verdict.
Stage 1 and Stage 2 remain fully independent — do not use review or QA findings for those.
```

## Display Results

After the verifier agent completes, extract the `verify_result` JSON block from its output. Look for a fenced code block tagged `verify_result` and parse the JSON inside it.

Also read `.planning/features/{name}/VERIFY.md` for the full report.

Display to the user using the JSON fields:

```
## VERIFICATION COMPLETE

Feature: {result.feature}
Status: {result.status}

Criteria: {result.criteria_passed} / {result.criteria_total} passed
Anti-patterns: {result.anti_patterns} found
PR Review: {result.review_findings.critical} critical / {result.review_findings.warnings} warnings / {result.review_findings.suggestions} suggestions
QA: {result.qa_findings.critical} critical / {result.qa_findings.high} high / {result.qa_findings.medium} medium / {result.qa_findings.low} low ({result.qa_findings.tests_written} tests)
Human checks: {result.human_checks} items

[If result.gaps is non-empty:]
Gaps:
- {each item from result.gaps}

[If result.pr_findings has CRITICAL or WARNING entries:]
PR Review Findings:
- {each item: [severity] description}

[If result.status is "PASS":] Feature complete! Next: /ship:finish
[If result.status is "PARTIAL" or "FAIL":] Next: /ship:build (fix tasks added to PLAN.md)
```

$ARGUMENTS
