---
description: Explore and sharpen a feature idea before planning. Use --deep for parallel market, competitive, and technical research before brainstorming.
allowed-tools: Read, Write, WebSearch, WebFetch, Glob, Task
---

Check if `$ARGUMENTS` contains the `--deep` flag.

**If `--deep` is present:** Follow the workflow at `.claude/ship/workflows/deep-brainstorm.md`. Pass the full arguments (including `--deep`) to the workflow.

**If `--deep` is NOT present:** Use the `ship-feature-brainstormer` agent to handle this request. Follow the agent instructions at `.claude/agents/ship-feature-brainstormer.md`.

$ARGUMENTS
