---
name: go
description: Auto-run all remaining Ship steps for a feature end-to-end
when_to_use: >-
  TRIGGER when: user says "go", "run everything", or wants hands-off execution.
  DO NOT TRIGGER when: user wants manual step-by-step control.
effort: medium
allowed-tools: Read, Glob, Skill
argument-hint: "[feature-name]"
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`
!`for f in .planning/features/*/PLAN.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d") plan: $(grep -c 'status="done"' "$f" 2>/dev/null || echo 0) done, $(grep -c 'status="pending"' "$f" 2>/dev/null || echo 0) pending"; done 2>/dev/null; true`

Auto-run all remaining steps for the active feature.

Read `.claude/ship/workflows/go.md` and follow its instructions.

If `$ARGUMENTS` is provided, use it as the feature name. Otherwise, auto-detect the active feature.

$ARGUMENTS
