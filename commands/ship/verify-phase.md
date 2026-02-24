---
description: Verify phase N against roadmap success criteria. Writes a pass/fail report. Usage: /ship:verify-phase [N]
allowed-tools: Read, Write, Bash, Glob, Grep
---

Follow the verify-phase workflow at `~/.claude/ship/workflows/verify-phase.md`.

The phase number to verify is: $ARGUMENTS

If no phase number is provided, read `.planning/STATE.md` to determine the current phase (status: verifying) and verify that one.
