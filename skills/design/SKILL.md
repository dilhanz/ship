---
name: ship:design
description: Use when a brainstormed feature needs architectural decisions — presents 2-3 approaches for user to choose before planning
effort: medium
allowed-tools: Read, Write, Edit, Agent, Glob, Grep, AskUserQuestion
argument-hint: "[feature-name]"
---

Present architecture options for the active feature so the user can choose an approach before planning.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `brainstormed` or `planned` (replanning with architecture input)
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no designable features were found

## Generate Architecture Options

Launch 3 parallel architecture sub-agents using the Agent tool. Run all three simultaneously in a single response. Each explores the codebase and proposes a concrete approach under a different philosophy.

**Agent 1 — Minimal Changes:**
```
Design an architecture for feature '{name}' using a MINIMAL CHANGES philosophy.
Read .planning/features/{name}/CONTEXT.md for the feature requirements.

Explore the codebase with Glob/Read/Grep to understand existing patterns.
Propose the approach that achieves the feature with the smallest diff and maximum
reuse of existing code.

Report in this exact format:
## Approach: Minimal Changes
**Philosophy:** Smallest diff, maximum reuse
**Summary:** [2-3 sentences]
**Key implementation points:**
- [concrete point 1]
- [concrete point 2]
- [concrete point 3]
**Pros:** [2 items]
**Cons:** [2 items]
**Estimated tasks:** [N]
```

**Agent 2 — Clean Architecture:**
```
Design an architecture for feature '{name}' using a CLEAN ARCHITECTURE philosophy.
Read .planning/features/{name}/CONTEXT.md for the feature requirements.

Explore the codebase with Glob/Read/Grep to understand existing patterns.
Propose the approach that prioritizes maintainability, proper abstractions, and
elegant design — even if it means more files or refactoring.

Report in this exact format:
## Approach: Clean Architecture
**Philosophy:** Maintainability, elegant abstractions
**Summary:** [2-3 sentences]
**Key implementation points:**
- [concrete point 1]
- [concrete point 2]
- [concrete point 3]
**Pros:** [2 items]
**Cons:** [2 items]
**Estimated tasks:** [N]
```

**Agent 3 — Pragmatic Balance:**
```
Design an architecture for feature '{name}' using a PRAGMATIC BALANCE philosophy.
Read .planning/features/{name}/CONTEXT.md for the feature requirements.

Explore the codebase with Glob/Read/Grep to understand existing patterns.
Propose the approach that balances speed with quality — ship quickly without
accruing significant tech debt.

Report in this exact format:
## Approach: Pragmatic Balance
**Philosophy:** Ship quickly, quality where it matters
**Summary:** [2-3 sentences]
**Key implementation points:**
- [concrete point 1]
- [concrete point 2]
- [concrete point 3]
**Pros:** [2 items]
**Cons:** [2 items]
**Estimated tasks:** [N]
```

## Present Options

After all three agents return, read their outputs and present a comparison to the user.

Display a summary of all three approaches, then form your own recommendation based on the feature's complexity, the codebase's current state, and the trade-offs.

Use AskUserQuestion to ask: "Which architecture approach should we use for this feature?"
- Options: the 3 approaches, with your recommendation marked
- Include a brief note about why you recommend that approach

## Record Choice

After the user chooses:

1. Read `.planning/features/{name}/CONTEXT.md`
2. Append the chosen approach under a `## Chosen Architecture` section:

```markdown
## Chosen Architecture

**Approach:** {chosen approach name}
**Summary:** {summary from the chosen approach}

**Key implementation points:**
{points from the chosen approach}
```

3. Status remains unchanged (no new status in the state machine)

## Display Results

```
## DESIGN COMPLETE

Feature: {name}
Chosen: {approach name}

The planner will use this architecture to guide task design.
Next: /ship:plan
```

$ARGUMENTS
