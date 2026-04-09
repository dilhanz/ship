---
name: ship:qa
description: Use when a feature build is complete and needs adversarial QA testing before verification
effort: high
allowed-tools: Read, Write, Edit, Agent, Glob, Bash
argument-hint: "[feature-name]"
---

Run QA on the active feature's implementation.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for 'SHIP ACTIVE FEATURES' or 'SHIP FEATURE STATE' blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `built`
3. If no injected state, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates, list them and pick the most recent
5. If no candidates, report "no features found with status `built`. Run `/ship:build` first."

## Run QA

Use the Agent tool to invoke the `ship-qa` agent with this prompt:

```
QA feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

Follow your instructions: auto-discover the test framework, assess risk categories,
write and run tests, commit test files, write QA.md, and emit your qa_result JSON block.
```

## Display Results

After the QA agent completes, extract the `qa_result` JSON block from its output. Look for a fenced code block tagged `qa_result` and parse the JSON inside it.

Also read `.planning/features/{name}/QA.md` for the full report.

Display to the user using the JSON fields:

```
## QA COMPLETE

Feature: {result.feature}
Status: {result.status}

Tests: {result.tests_written} written, {result.tests_passed} passed, {result.tests_failed} failed
Test files: {result.test_files joined with ", "}
Commits: {result.commits joined with ", "}

[If result.bugs is non-empty:]
Bugs found:
- [{severity}] {description} ({file}) — {evidence}

[If result.status is "PASS":] QA passed! Next: /ship:verify
[If result.status is "FAIL":] QA found critical/high bugs. Fix tasks added to PLAN.md. Next: /ship:build
```

## Handle Result

**If status is "PASS":**
1. Update CONTEXT.md frontmatter to `status: qa-passed`
2. Display the success message above

**If status is "FAIL":**
1. Update CONTEXT.md frontmatter to `status: plan-verified`
2. Extract all bugs with severity "critical" or "high" from the `bugs` array
3. For each critical/high bug, append a fix task to PLAN.md in this format:

```xml
<task id="{next-id}" status="pending">
  <name>Fix: {bug description}</name>
  <files>{bug file path}</files>
  <action>Fix the {severity} bug found by QA: {bug description}.
Evidence: {bug evidence}.
Ensure the fix addresses the root cause, not just the symptom.</action>
  <verify>{test command that exercises the fix — use the test file that found the bug}</verify>
</task>
```

Task IDs should continue from the highest existing task ID in PLAN.md. If the plan is phased, add a new phase:

```xml
<phase id="{next-phase-id}" name="QA fixes" status="pending">
{fix tasks here}
</phase>
```

3. Display the failure message above

$ARGUMENTS
