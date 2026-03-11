---
name: ship-plan
description: Create an implementation plan for the active feature from its CONTEXT.md.
disable-model-invocation: true
allowed-tools: Read, Agent, Glob, Edit, AskUserQuestion
argument-hint: "[feature-name]"
---

Create an implementation plan for the active feature.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `brainstormed` or `planned` (replanning)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no plannable features were found

## Pre-Planning Exploration

Before invoking the planner, launch 3 parallel exploration sub-agents using the Agent tool. Run all three simultaneously in a single response (do not wait for one before starting the next):

**Agent 1 — Similar Features:**
```
Explore the codebase and find features or patterns similar to this feature idea: {summary from CONTEXT.md}.
Use Glob, Read, and Grep to find analogous implementations. Report:
- File paths of similar implementations
- Patterns used (naming, structure, abstractions)
- Key function signatures and conventions
- How similar features integrate with the rest of the codebase
Be concise. Max 500 words.
```

**Agent 2 — Architecture Map:**
```
Map the architecture relevant to this feature: {summary from CONTEXT.md}.
Use Glob, Read, and Grep to identify:
- Module boundaries and directory structure in the relevant area
- Abstraction layers (models, services, routes, components, etc.)
- Entry points and integration patterns
- Dependencies between modules
Be concise. Max 500 words.
```

**Agent 3 — Codebase Conventions:**
```
Survey coding conventions in this project. Read 3-5 representative source files.
Report:
- File naming style (camelCase, kebab-case, PascalCase)
- Import patterns (relative vs alias, default vs named exports)
- Error handling conventions
- Test file locations and framework
- File extension conventions
- Any linting/formatting config (eslint, prettier, tsconfig)
Be concise. Max 500 words.
```

Collect the output from all three agents. Concatenate into an `## Exploration Findings` block.

## Post-Exploration Clarifying Questions

After exploration completes, review the Exploration Findings and CONTEXT.md together. Ask follow-up questions only if ANY of these conditions are true:

- An integration point exists that CONTEXT.md doesn't address (e.g., "you have existing auth middleware — should this feature use it?")
- A critical design decision wasn't settled during brainstorming but is now visible from the code
- A scope conflict exists between CONTEXT.md and actual codebase state
- The exploration revealed patterns that could significantly change the approach

If none of these apply, skip this step and proceed directly to Run Planning.

If questions are warranted, use AskUserQuestion with 1-4 targeted questions informed by the exploration findings. Frame as: "Now that I've explored your codebase, I have some follow-up questions before planning..." Each question must reference a specific finding from exploration (not a generic question).

After getting answers, incorporate them into the Exploration Findings block.

## Run Planning

Use the Agent tool to invoke the `ship-planner` agent with this prompt:

```
Plan feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md (if replanning)
- .planning/features/{name}/VERIFY.md (if replanning after failed verify)

## Exploration Findings (pre-gathered by parallel explorers)

{paste the full Exploration Findings block here, including any Q&A answers}

Follow your planning instructions. Use the exploration findings above as your Step 2
starting context — skip redundant exploration but do supplementary reads as needed.
Proceed through all remaining steps (decisions, task design, self-check, write PLAN.md).
```

## Display Results

After the planner agent completes, read `.planning/features/{name}/PLAN.md` and display:

```
## PLAN READY

Feature: {name}
Tasks: [N] [in M phases / flat]
Must Deliver: [N items]

[List each task name on its own line, grouped by phase if phased]

Next: /ship-build
```

$ARGUMENTS
