---
name: verify
description: Use when a feature build is complete and needs verification against acceptance criteria and independent code review
effort: high
allowed-tools: Read, Agent, Glob, Edit, Bash, Skill
argument-hint: "[feature-name]"
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`
!`for f in .planning/features/*/PLAN.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d") plan: $(grep -c 'status="done"' "$f" 2>/dev/null || echo 0) done, $(grep -c 'status="pending"' "$f" 2>/dev/null || echo 0) pending"; done 2>/dev/null; true`

Verify the active feature's implementation.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `built`
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no verifiable features were found

## Run Code Review

Before invoking the verifier, run Claude Code's `/review` skill with Ship context so the review is aligned with the feature's goals and acceptance criteria.

Use the Skill tool:
- skill: "review"
- args: "Review all code changes on the current branch. Use these Ship planning files as context for the feature's goals, acceptance criteria, and design decisions: .planning/features/{name}/CONTEXT.md and .planning/features/{name}/PLAN.md — review through the lens of what this feature is trying to achieve."

After `/review` completes, collect its complete output. Format it as a `## /review Findings` section preserving all findings with their severity levels (CRITICAL, WARNING, SUGGESTION), file paths, line numbers, and descriptions. If `/review` produced no findings, write `## /review Findings\n\nNo issues found.`

## Run Verification

Use the Agent tool to invoke the `ship-verifier` agent with this prompt:

```
Verify feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

## /review Findings (pre-gathered for Stage 3)

{paste the /review findings here}

Follow your verification instructions. For Stage 3, write the /review findings above
into VERIFY.md's Stage 3 section. Both CRITICAL and WARNING findings block a PASS verdict.
Stage 1 and Stage 2 remain fully independent — do not use review findings for those.
```

## Display Results

After the verifier agent completes, read `.planning/features/{name}/VERIFY.md` and display:

```
## VERIFICATION COMPLETE

Feature: {name}
Status: [PASS | PARTIAL | FAIL]

[Acceptance criteria table from VERIFY.md]

[If PARTIAL/FAIL:]
Gaps:
- [list gaps]

Recommendation: [from VERIFY.md]

[If PASS:] Feature complete!
[If PARTIAL/FAIL:] Next: /ship:build (fix tasks added to PLAN.md)
```

$ARGUMENTS
