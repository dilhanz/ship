---
name: ship-go
description: Use when you want to auto-run all remaining Ship steps for a feature without manual step-by-step invocation
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion, Skill
argument-hint: "[feature-name]"
---

Auto-run all remaining steps for the active feature.

Read `.claude/ship/workflows/go.md` and follow its instructions.

If `$ARGUMENTS` is provided, use it as the feature name. Otherwise, auto-detect the active feature.

$ARGUMENTS
