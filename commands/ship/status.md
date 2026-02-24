---
description: Show current project status — phase, progress, and next action.
allowed-tools: Read, Glob
---

Read `.planning/STATE.md` and `.planning/ROADMAP.md`, then produce a clean status summary.

If `.planning/STATE.md` does not exist, output:
```
No Ship project found in this directory.
Run /ship:new-project to start one.
```

Otherwise, output a status report in this format:

```
## Ship Status

Project: [Read from .planning/PROJECT.md — project name]
Current Phase: [from STATE.md]
Status: [planning / executing / verifying / complete]

Progress:
[For each phase in ROADMAP.md, show one line:]
  ✓ Phase 1 — Name (complete)
  ▶ Phase 2 — Name (executing)  ← current
  ○ Phase 3 — Name (pending)

Last Action: [from STATE.md]
Next Action: [from STATE.md]

[If there are active blockers in STATE.md, show:]
Blockers:
- [blocker description]
```

Use ✓ for complete phases, ▶ for the current phase, ○ for pending phases.

Determine phase completion status from STATE.md Phase History table.
