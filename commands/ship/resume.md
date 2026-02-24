---
description: Resume a Ship project from wherever you left off. Reads state and tells you exactly what to do next.
allowed-tools: Read, Glob
---

Read `.planning/STATE.md` to understand the current position, then give the user a clear resumption prompt.

If `.planning/STATE.md` does not exist, output:
```
No Ship project found in this directory.
Run /ship:new-project to start one.
```

Otherwise:
1. Read STATE.md fully
2. Read ROADMAP.md to understand the full picture
3. Check which phase files exist (Glob `.planning/*.md`) to understand what has been done

Determine the resumption action based on STATE.md status:

| Status | Resumption Action |
|--------|------------------|
| planning | `/ship:plan-phase N` — plan hasn't been written yet |
| executing | `/ship:execute-phase N` — plan exists, ready to execute |
| verifying | `/ship:verify-phase N` — execution done, needs verification |
| complete | All phases complete. Run `/ship:complete` or start a new phase with `/ship:add-phase` |

Output a clear resumption message:

```
## Resuming Ship Project

[Project name] — Phase N of M

You were: [last action from STATE.md]
Next: [specific command to run]

[1-2 sentences of context about where things stand]

Run: [exact command]
```
