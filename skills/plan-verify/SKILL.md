---
name: plan-verify
description: Use when a plan has been created and needs independent verification against codebase patterns before building
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Agent
argument-hint: "[feature-name]"
---

Verify the implementation plan against the actual codebase.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `planned`
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no verifiable plans were found

## How This Skill Works

This skill is an orchestrator. The review itself runs in ONE `ship-plan-reviewer` subagent launched via the Agent tool, because the reviewer must be fresh-context: it must not share the planner's conversation, or it inherits the planner's assumptions and rubber-stamps its own reasoning. The skill launches the reviewer, waits for its structured verdict, then writes the results and status itself.

This skill is SINGLE-SHOT: exactly one review round, one verdict, and the user decides what happens next. There is no revision loop here — the automated review → replan → re-review loop lives in `ship/workflows/plan.workflow.js` and runs only under `/ship:go`.

The review contract itself (what the reviewer checks and how it reports) lives in `agents/ship-plan-reviewer.md` — that agent file is its home, and this skill does not restate it.

## Launch the Reviewer

Launch one `ship-plan-reviewer` subagent via the Agent tool with this prompt (substitute `{name}`):

```
Review the plan for feature: {name}

Read .planning/features/{name}/CONTEXT.md and .planning/features/{name}/PLAN.md, then
review the plan against the codebase following your review contract. Return your
plan_review_result block.
```

## Handle the Verdict

Findings are classified by severity:

| Severity | Meaning | Blocks Approval? |
|----------|---------|-----------------|
| **CRITICAL** | Will cause build failure or produce broken code (wrong paths, missing deps, pattern violation that won't compile) | Yes |
| **WARNING** | Inconsistent with codebase patterns, may cause issues | No, but must be noted |
| **SUGGESTION** | Minor improvement opportunity | No |

Overall Status:
- **APPROVED:** No CRITICAL findings. Plan is structurally sound.
- **NEEDS-REVISION:** One or more CRITICAL findings. Plan must be fixed.

If the subagent errors or returns no parseable verdict, relaunch it once; if it fails again, report the failure to the user and stop — never approve a plan without a completed review.

## Write Results

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
Next: /ship:build

[If NEEDS-REVISION:]
Critical issues: [N]
- [Issue 1 summary]
- [Issue 2 summary]

Next: /ship:plan {name} (replan with review notes)
```

## What NOT to Do

- **Rubber-stamp.** Never approve without a completed subagent review grounded in codebase exploration.
- **Review in this conversation.** The reviewer must be fresh-context — do not perform the review inline.
- **Rewrite the plan.** You review — the planner rewrites.
- **Block on style preferences.** Only CRITICAL findings block.
- **Invent requirements.** Only check what the plan claims against what the codebase shows.

$ARGUMENTS
