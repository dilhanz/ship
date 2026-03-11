---
name: ship-plan-verify
description: Independently verify the implementation plan against existing codebase patterns and conventions before building.
disable-model-invocation: true
allowed-tools: Read, Agent, Glob
argument-hint: "[feature-name]"
---

Verify the implementation plan against the actual codebase.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` (ready for plan review)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable plans were found

## Run Verification

Use the Agent tool to invoke the `ship-plan-verifier` agent with this prompt:

```
Verify plan for feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

Follow your plan verification instructions with this feature.
```

## Display Results

After the verifier agent completes, read `.planning/features/{name}/PLAN.md` and display:

```
## PLAN REVIEW COMPLETE

Feature: {name}
Status: APPROVED | NEEDS-REVISION

Codebase patterns checked: [N files examined]
Tasks reviewed: [N] / [N]

[If APPROVED:]
Findings: [N warnings, N suggestions — or "Clean"]
Plan is ready to build.
Next: /ship-build

[If NEEDS-REVISION:]
Critical issues: [N]
- [Issue 1 summary]
- [Issue 2 summary]

Next: /ship-plan {name} (replan with review notes)
```

$ARGUMENTS
