---
name: ship-go
description: Automatically run all remaining steps for the active feature (plan -> build -> verify).
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
argument-hint: "[feature-name]"
---

Auto-run all remaining steps for the active feature.

Read `.claude/ship/workflows/go.md` and follow its instructions.

If `$ARGUMENTS` is provided, use it as the feature name. Otherwise, auto-detect the active feature.

$ARGUMENTS
