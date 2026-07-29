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

Identify the 2-3 genuinely distinct viable approaches for THIS feature. They come from the feature's actual decision axes — e.g. extend an existing module vs. build a new one, sync vs. async, buy (use a library) vs. build — not from a fixed menu of philosophies. The count and framing come from the feature: if only two real contenders exist, present two; do not invent a third to fill a slot.

1. Read `.planning/features/{name}/CONTEXT.md` for the requirements and constraints.
2. Find the decision axes: where would two reasonable architects genuinely diverge on this feature?
3. Develop each candidate approach until it is concrete: what changes, the key files involved, its tradeoffs against the other approaches, and a rough task count.

For small or familiar surfaces, explore inline with Glob/Read/Grep and develop the approaches yourself. For larger or unfamiliar surfaces, launch one parallel sub-agent per candidate approach via the Agent tool — each explores the codebase and reports back in this format:

```
## Approach: {approach name}
**Summary:** [2-3 sentences]
**Key implementation points:**
- [concrete point, naming key files]
- [concrete point, naming key files]
**Tradeoffs:** [what this buys and costs vs. the alternatives]
**Estimated tasks:** [N]
```

## Present Options

Once every candidate approach is concrete, present a comparison to the user.

Display a summary of each approach, then form your own recommendation based on the feature's complexity, the codebase's current state, and the trade-offs.

Use AskUserQuestion to ask: "Which architecture approach should we use for this feature?"
- Options: the candidate approaches, with your recommendation marked
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
