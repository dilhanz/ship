---
name: ship-verify
description: Verify the active feature against its acceptance criteria from CONTEXT.md.
disable-model-invocation: true
allowed-tools: Read, Agent, Glob, Edit
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

## Run Verification

Use the Agent tool to invoke the `ship-verifier` agent with this prompt:

```
Verify feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

Follow your verification instructions to check all acceptance criteria, scan for anti-patterns, write VERIFY.md, and update CONTEXT.md status.
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
