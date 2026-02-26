---
description: Execute the current phase. Implements tasks sequentially, verifies each, and commits atomically. Reads current phase from STATE.md.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Follow the execute-phase workflow at `.claude/ship/workflows/execute-phase.md`.

Read `.planning/STATE.md` to determine the current phase (status: executing) and execute that one.
