---
description: Resume a Ship project from wherever you left off. Reads state and automatically continues execution.
allowed-tools: Read, Glob
---

Read `.planning/STATE.md` to understand the current position, then automatically resume work.

If `.planning/STATE.md` does not exist, output:
```
No Ship project found in this directory.
Run /ship:new-project to start one.
```

Otherwise:
1. Read STATE.md fully
2. Read ROADMAP.md to understand the full picture
3. Check which phase files exist (Glob `.planning/*.md`) to understand what has been done
4. If STATE.md has an `## Execution Progress` section, note which tasks are already complete — the executor will skip them automatically

Determine the resumption action based on STATE.md status:

| Status | Resumption Action |
|--------|------------------|
| planning | `/ship:plan-phase N` — plan hasn't been written yet |
| executing | `/ship:execute-phase N` — plan exists, ready to execute (executor will skip completed tasks from Execution Progress) |
| paused | `/ship:execute-phase N` — execution was paused, resume from where it stopped |
| verifying | `/ship:verify-phase N` — execution done, needs verification |
| complete | All phases complete. Run `/ship:complete` or start a new phase with `/ship:add-phase` |

Output a clear resumption message and then **automatically invoke the next command**:

```
## Resuming Ship Project

[Project name] — Phase N of M

You were: [last action from STATE.md]
[If Execution Progress exists: "Tasks completed: X/Y — will resume from task X+1"]

Continuing automatically...
```

Then immediately invoke the appropriate command (e.g., `/ship:execute-phase N`). Do not wait for the user to manually type the next command — the whole point of resume is seamless continuation.

**Exception:** If the status is `complete`, do NOT auto-invoke. Just show the status and suggest next steps.
