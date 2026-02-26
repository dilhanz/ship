---
description: Mark the project as complete. Generates a final summary and cleans up state.
allowed-tools: Read, Write, Glob
---

Generate a project completion summary.

## Process

1. Read `.planning/STATE.md` — check if all phases show "complete" in Phase History.
2. Read `.planning/ROADMAP.md` — get all phases and their goals.
3. Read all `NN-VERIFY.md` files to gather verification outcomes.
4. Read `.planning/PROJECT.md` — get the project vision for the summary.

If any phase is not complete, warn the user:
```
Warning: Phase [N] is not yet complete (status: [status]).
Run /ship:verify-phase N first, or confirm you want to mark the project complete anyway.
```

If all phases are complete (or user confirms), update STATE.md:
- Set `Status:` to "complete"
- Set `Last Action:` to "Project marked complete"
- Set `Next Action:` to "—"

Then output a completion summary:

```
## Project Complete

[Project Name] — [vision from PROJECT.md]

## Phases Delivered

[For each phase:]
Phase N — [Name]: [goal sentence] ✓

## Requirements Delivered

[List all FEAT-XX items from REQUIREMENTS.md that were implemented]

## Stats

Phases: N
Planning files: .planning/ ([X] files)

Ship it. 🚀
```
