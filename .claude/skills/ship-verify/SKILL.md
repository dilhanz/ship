---
name: ship-verify
description: Verify the active feature against its acceptance criteria from CONTEXT.md.
disable-model-invocation: true
allowed-tools: Read, Agent, Glob, Edit, Bash
argument-hint: "[feature-name]"
---

Verify the active feature's implementation.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `built`
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable features were found

## Run Parallel Review

Before invoking the verifier, launch 3 parallel reviewer sub-agents using the Agent tool. Run all three simultaneously in a single response:

First, identify the changed files:
```bash
git diff --name-only main...HEAD
```
If that fails, try: `git log --oneline --all --grep="{name}"` to find feature commits and their files.

**Agent 1 — Simplicity & DRY Reviewer:**
```
Review these files changed for feature '{name}': {list of changed files}.
Focus exclusively on: code duplication, unnecessary complexity, over-engineering,
dead code, opportunities to reuse existing utilities.
For each finding report: file, line(s), description, confidence score (0-100).
Only report findings with confidence ≥80. Max 600 words.
```

**Agent 2 — Bugs & Correctness Reviewer:**
```
Review these files changed for feature '{name}': {list of changed files}.
Focus exclusively on: logic errors, off-by-one, null/undefined access, missing awaits,
race conditions, incorrect type coercions, missing error handling at system boundaries.
For each finding report: file, line(s), description, confidence score (0-100).
Only report findings with confidence ≥80. Max 600 words.
```

**Agent 3 — Conventions & Security Reviewer:**
```
Review these files changed for feature '{name}': {list of changed files}.
Focus exclusively on: deviations from project naming conventions, broken abstraction layers,
missing wiring (functions created but never called), security issues (injection, XSS,
missing validation, exposed secrets, path traversal).
For each finding report: file, line(s), description, confidence score (0-100).
Only report findings with confidence ≥80. Max 600 words.
```

Collect outputs from all three. Consolidate into a `## Parallel Review Findings` block, deduplicating any finding that appears in 2+ reviews (keep highest confidence score).

## Run Verification

Use the Agent tool to invoke the `ship-verifier` agent with this prompt:

```
Verify feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

## Parallel Review Findings (pre-gathered for Stage 3)

{paste the consolidated Parallel Review Findings block here}

Follow your verification instructions. For Stage 3 (PR Review), incorporate the
pre-gathered findings above as your primary input. You may supplement with additional
reads but do not re-run the full Stage 3 discovery from scratch.
Stage 1 and Stage 2 remain fully independent — do not use review findings for those.
```

## Display Results

After the verifier agent completes, read `.planning/features/{name}/VERIFY.md` and display:

```
## VERIFICATION COMPLETE

Feature: {name}
Status: [PASS | PARTIAL | FAIL]

[Acceptance criteria table from VERIFY.md]

[If PARTIAL/FAIL:]
Gaps:
- [list gaps]

Recommendation: [from VERIFY.md]

[If PASS:] Feature complete!
[If PARTIAL/FAIL:] Next: /ship-build (fix tasks added to PLAN.md)
```

$ARGUMENTS
