---
description: Add a new phase to the roadmap. Use when scope grows or new requirements emerge mid-project. Usage: /ship:add-phase [description]
allowed-tools: Read, Write, Edit, Glob
---

Add a new phase to `.planning/ROADMAP.md` based on the user's description.

The description of the new phase is: $ARGUMENTS

## Process

1. Read `.planning/ROADMAP.md` to understand existing phases and their numbering.
2. Read `.planning/REQUIREMENTS.md` — check if there are any FEAT-XX items not yet assigned to a phase (these might be the motivation for this new phase).
3. Read `.planning/STATE.md` to understand current position.

If no description was provided ($ARGUMENTS is empty), ask the user:
- What is the goal of this new phase? (one sentence: what can users do when it's done?)
- What requirements does it cover? (FEAT-XX IDs, or describe new features)
- Does it depend on an existing phase?

## Adding the Phase

Determine the next phase number (current highest + 1).

Append to ROADMAP.md:

```markdown
## Phase N — [Descriptive Name]

**Goal:** [One sentence from user]

**Requirements:** [FEAT-XX list, or "New requirements — see below"]

**Success Criteria:**
1. [Derive 2-3 observable criteria from the goal]
2. [Observable criterion]

**Depends on:** Phase [N-1]
```

If the phase adds new requirements not in REQUIREMENTS.md, add them to REQUIREMENTS.md with new FEAT-XX IDs (continuing from the highest existing ID).

Update `.planning/STATE.md`:
- Add a new row to Phase History for the new phase (status: —)
- Update `Next Action` if appropriate

Output:
```
## Phase Added

Phase [N] — [Name] added to roadmap.
Requirements: [list]
Success criteria: [N items]

[If this is a future phase:] Proceed with the current phase. When ready: /ship:plan-phase N
[If adding to plan immediately:] /ship:plan-phase N
```
