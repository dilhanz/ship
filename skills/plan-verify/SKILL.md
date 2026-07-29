---
name: ship:plan-verify
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

This skill is an orchestrator. The review itself runs in ONE general-purpose subagent launched via the Agent tool, because the reviewer must be fresh-context: it must not share the planner's conversation, or it inherits the planner's assumptions and rubber-stamps its own reasoning. The skill launches the reviewer, waits for its structured verdict, then writes the results and status itself.

## Launch the Reviewer

Launch one general-purpose subagent via the Agent tool with this prompt (substitute `{name}`):

```
You are an independent plan reviewer. You did not write this plan and must not trust
its claims — check whether it will actually work against the real codebase. Your job
is to catch problems that would cause build failures or produce code that doesn't fit
the project.

Read both files:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

You are READ-ONLY. Explore with Read/Glob/Grep; use Bash only for existence and
feasibility probes (e.g. does the test runner exist, does a package appear in a
manifest) — never modify any file.

Stay plan-driven: only explore what the plan touches — do not map the entire codebase.
Reading PLAN.md alone is not evidence; verify structural claims against the actual code.

### Mechanical grounding — verify each claim

For every task in PLAN.md:
- <files> paths: existing files resolve via Glob; for new files, the parent directory
  exists or its creation is plausible under project conventions
- <reference>: resolves to a real file; where a symbol, function, or pattern is named,
  confirm it exists there via Grep
- depends attributes: every referenced task ID exists, with no forward or circular
  references
- Packages: every named package exists in the project's dependency manifests or is
  stdlib
- <verify> commands: each is a runnable shell command whose runner exists in the
  repo/toolchain, and passing it would actually prove the task's completion

### Judgment review — against the real code

- Completeness: is each task specified enough to execute without guessing at contracts
  (schemas, endpoint shapes, error behavior, integration points)?
- Wiring: are artifacts created by one task consumed by another, or orphaned?
- Ordering: is the task order sound? Are phases self-contained?
- Pattern consistency: does the approach match how the codebase already does this
  (layering, naming, library choices)?
- Duplicate functionality: does the plan rebuild something that already exists? Grep
  for similar function names or route paths.
- Coverage: is any acceptance criterion in CONTEXT.md left unaddressed by the tasks?
- Side effects: will planned modifications break existing callers?

Do NOT police document format — review substance, not section presence or wording.

### Return a structured verdict

Report back in exactly this format:

## Review Verdict

**Status:** APPROVED | NEEDS-REVISION
**Examined:** [key codebase files/patterns you checked]

### Findings

[One line per finding:]
- [CRITICAL|WARNING|SUGGESTION] Task {id} / {file}: {description} —
  Evidence: {what the codebase shows} — Fix: {specific recommendation}

[Or "No issues found."]

APPROVED iff zero CRITICAL findings.
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
