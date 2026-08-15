---
name: ship:verify
description: Use when a feature build is complete and needs verification against acceptance criteria and adversarial testing
effort: high
allowed-tools: Read, Agent, Glob, Edit, Bash
argument-hint: "[feature-name]"
---

Verify the active feature's implementation.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `built`
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no verifiable features were found

## Run Verification

Use the Agent tool to invoke the `ship-verifier` agent. It is the single post-build quality gate: it verifies every acceptance criterion against the running code, hunts bugs with adversarial tests, scans for anti-patterns, and writes VERIFY.md.

```
Verify feature: {name}

Read .planning/features/{name}/CONTEXT.md and PLAN.md, then follow your verification
instructions: verify acceptance criteria with the gate function, write and run
adversarial tests for the relevant risk categories, scan the changed files for
anti-patterns, and write VERIFY.md. Critical or high bugs and any failing criterion
block a PASS.

Also read .planning/features/{name}/REVIEW.md if it exists. Every finding marked
unresolved there is a defect the per-phase review gate evidenced and the build's one
fix round did not clear — each is a mandatory Stage 2b target, and a reproduced
critical/high one is a FAIL.
```

## Sync PM State

The verifier sets CONTEXT.md status (`done` on PASS/INCONCLUSIVE/DEFERRED, `plan-verified` on FAIL). After it returns, run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` to sync PM state (silent no-op when `.project-manager/` is absent).

This is mechanical reconciliation only — status cells and the dashboard, which the script performs from any lane. It never applies a PM handoff: authored `.project-manager/` edits belong to `/ship:pm apply`.

## Display Results

Extract the `verify_result` JSON block from the agent's output and read `.planning/features/{name}/VERIFY.md` for the full report. Display:

```
## VERIFICATION COMPLETE

Feature: {result.feature}
Status: {result.status}

Criteria: {result.criteria_passed} / {result.criteria_total} passed ({result.criteria_inconclusive} inconclusive, {result.criteria_deferred} deferred to PM)
Tests: {result.tests_written} written, {result.tests_passed} passed
Bugs: {by severity from result.bugs}
Anti-patterns: {result.anti_patterns} found

[If result.gaps is non-empty:]
Gaps:
- {each item from result.gaps}

[If result.pm_handoff is non-null:]
PM handoff: {result.pm_handoff.edits} shared .project-manager/ edit(s) recorded in {result.pm_handoff.path} — apply with /ship:pm apply

[If result.status is "PASS", "INCONCLUSIVE", or "DEFERRED":] Next: /ship:finish
[If result.status is "FAIL":] Next: /ship:build (fix tasks added to PLAN.md)
```

A DEFERRED verdict is not a failure and must not be reported as one. The code work is complete; what remains is PM-layer work with a written owner. If `result.criteria_deferred` is non-zero but `result.pm_handoff` is null, say so — a deferral with no record is a dropped criterion.

$ARGUMENTS
