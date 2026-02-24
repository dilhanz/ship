---
description: Execute phase N. Implements tasks sequentially, verifies each, and commits atomically. Usage: /ship:execute-phase [N]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Follow the execute-phase workflow at `~/.claude/ship/workflows/execute-phase.md`.

The phase number to execute is: $ARGUMENTS

If no phase number is provided, read `.planning/STATE.md` to determine the current phase (status: executing) and execute that one.
