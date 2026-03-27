---
name: ship-plan-verify
description: Use when a plan has been created and needs independent verification against codebase patterns before building
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Agent
argument-hint: "[feature-name]"
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`
!`for f in .planning/features/*/PLAN.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d") plan: $(grep -c 'status="done"' "$f" 2>/dev/null || echo 0) done, $(grep -c 'status="pending"' "$f" 2>/dev/null || echo 0) pending"; done 2>/dev/null; true`

Verify the implementation plan against the actual codebase.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `planned` (ready for plan review)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable plans were found

## Read Inputs

Read both files:
- `.planning/features/{name}/CONTEXT.md`
- `.planning/features/{name}/PLAN.md`

Extract from PLAN.md: all file paths (existing and new), directories, key class/function names, and packages referenced. These are your verification targets.

## Verify the Plan

You are an independent reviewer checking whether this plan will actually work against the real codebase. You are NOT the planner and NOT the builder. Your job is to catch problems that would cause build failures or produce code that doesn't fit the project.

<HARD-RULES>
1. Do NOT approve based on reading PLAN.md alone. You MUST explore the actual codebase and verify structural claims. "Looks reasonable" is not evidence — only codebase exploration is evidence.
2. Stay plan-driven. Only explore what the plan touches — do not map the entire codebase.
3. You MUST write results to PLAN.md when done.
</HARD-RULES>

### Stage 1 — Targeted Codebase Discovery

Use the plan's file paths as exploration targets — do NOT do a broad survey of the entire project.

1. **Verify plan paths exist:** Glob for each directory and existing file mentioned in the plan. Batch related paths into single Glob calls using patterns (e.g., `src/components/**/*.tsx` instead of individual files).
2. **Read 1-2 analogous examples:** If the plan creates a new controller/component/service, find ONE existing example in the same directory and read it. Note patterns (naming, imports, structure).
3. **Check config only if relevant:** Only read tsconfig/package.json/etc. if the plan references new dependencies or build changes.

Do NOT: map the entire directory tree, read unrelated files, or explore areas the plan doesn't touch.

### Stage 2 — Plan Structural Verification

For each task in PLAN.md, verify:

#### 2.1 — File Path Accuracy

For every path in `<files>`:
- If the file should already exist (modification), verify it exists with Glob
- If the file is new, verify the parent directory exists and follows naming conventions
- Check that file extensions match the project's conventions

Use batch Glob calls — verify multiple paths per turn.

#### 2.2 — Pattern Consistency

For each task's `<action>`, check that the approach matches existing codebase patterns:

- **Architecture layers:** Does the plan respect the project's layering? (e.g., doesn't skip service layer and call DB from route handler if existing code uses services)
- **Naming conventions:** Do proposed names follow the project's conventions?
- **Library usage:** Does the plan use libraries already in the project, or introduce new ones without reason?

#### 2.3 — Dependency & Conflict Check

- **Existing code conflicts:** Does any planned change conflict with existing code?
- **Missing dependencies:** Does the plan assume packages or modules that don't exist?
- **Import chain validity:** Will the planned imports resolve correctly?

#### 2.4 — Verify Command Feasibility

For each task's `<verify>` command:
- Is the command syntactically valid for this project's setup?
- Does it actually prove the task is done?

### Stage 3 — Feature Landscape Review

Quick checks:

1. **Duplicate functionality:** Grep for similar function names or route paths the plan introduces
2. **Integration points:** Are all connection points to existing code identified?
3. **Side effects:** Will modifications break existing callers?

### Stage 4 — Verdict

Classify each finding:

| Severity | Meaning | Blocks Approval? |
|----------|---------|-----------------|
| **CRITICAL** | Will cause build failure or produce broken code (wrong paths, missing deps, pattern violation that won't compile) | Yes |
| **WARNING** | Inconsistent with codebase patterns, may cause issues | No, but must be noted |
| **SUGGESTION** | Minor improvement opportunity | No |

Overall Status:
- **APPROVED:** No CRITICAL findings. Plan is structurally sound.
- **NEEDS-REVISION:** One or more CRITICAL findings. Plan must be fixed.

### Stage 5 — Write Results

#### If APPROVED:

Update CONTEXT.md frontmatter: set `status: plan-verified`

Append to PLAN.md:

```markdown
## Plan Review

**Status:** APPROVED
**Reviewed against:** [list key codebase files/patterns examined]

### Findings

[Any WARNING or SUGGESTION items — or "No issues found."]
```

#### If NEEDS-REVISION:

Keep CONTEXT.md status as `planned` (do NOT change it).

Append to PLAN.md:

```markdown
## Plan Review

**Status:** NEEDS-REVISION

### Critical Issues

[List each CRITICAL finding with:]
- Task [id] — [issue description]
- Evidence: [what you found in the codebase]
- Fix: [specific recommendation]

### Warnings

[Any WARNING items]

### Suggestions

[Any SUGGESTION items]
```

## Display Results

After writing, display:

```
## PLAN REVIEW COMPLETE

Feature: {name}
Status: APPROVED | NEEDS-REVISION

Codebase patterns checked: [N files examined]
Tasks reviewed: [N] / [N]

[If APPROVED:]
Findings: [N warnings, N suggestions — or "Clean"]
Plan is ready to build.
Next: /ship-build

[If NEEDS-REVISION:]
Critical issues: [N]
- [Issue 1 summary]
- [Issue 2 summary]

Next: /ship-plan {name} (replan with review notes)
```

## What NOT to Do

- **Rubber-stamp.** Never approve without exploring the codebase.
- **Rewrite the plan.** You review — the planner rewrites.
- **Review code quality.** You review structural feasibility, not "good enough."
- **Block on style preferences.** Only CRITICAL findings block.
- **Invent requirements.** Only check what the plan claims against what the codebase shows.

$ARGUMENTS
