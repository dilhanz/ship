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

## Pre-Verification Exploration

Before invoking the verifier, launch 2 parallel exploration sub-agents using the Agent tool. Run both simultaneously in a single response:

**Agent 1 — Codebase Patterns & Conventions:**
```
Survey coding conventions and architecture in this project. Read 3-5 representative source files.
Report:
- Directory layout and module boundaries
- File naming style (camelCase, kebab-case, PascalCase)
- Import patterns (relative vs alias, default vs named exports)
- File extension conventions
- Error handling conventions
- Test file locations and framework
- Any linting/formatting config (eslint, prettier, tsconfig)
Be concise. Max 500 words.
```

**Agent 2 — Plan File Analysis:**
```
Read .planning/features/{name}/PLAN.md.
Extract and report:
- Every file path mentioned in <files> elements across all tasks
- For each path, whether it's a new file or modifying an existing one (use Glob to check existence)
- For modification targets, read the file and note its structure, key exports, and patterns
- Count of tasks and phases
Be concise. Max 600 words.
```

Collect the output from both agents. Concatenate into an `## Exploration Findings` block.

## Run Verification

Use the Agent tool to invoke the `ship-plan-verifier` agent with this prompt:

```
Verify plan for feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

## Exploration Findings (pre-gathered by parallel explorers)

{paste the full Exploration Findings block here}

Follow your plan verification instructions. Use the exploration findings above as your
Stage 1 starting context — skip redundant exploration but do supplementary reads as needed.
Proceed through all remaining stages (structural verification, landscape review, verdict, write results).
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
