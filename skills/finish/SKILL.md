---
name: ship:finish
description: Use when a feature has been verified and needs to be completed — creates PR, merges locally, or keeps branch
effort: medium
allowed-tools: Read, Bash, Glob, AskUserQuestion
argument-hint: "[feature-name] [--accept-inconclusive \"reason\"]"
---

Finish the active feature after verification passes.

## Parse Arguments

Parse `$ARGUMENTS` (a single string) into two components:
- `--accept-inconclusive "reason"` — if this flag appears anywhere in the string, set `ACCEPT_INCONCLUSIVE = true` and extract the quoted reason text (everything between the matching `"`s after the flag).
- Remaining tokens (after removing the flag + reason) — treat as feature name.

If `--accept-inconclusive` appears WITHOUT a quoted reason, abort and tell the user: `--accept-inconclusive requires a non-empty reason in quotes. Example: /ship:finish my-feature --accept-inconclusive "manually verified end-to-end on staging"`.

If `ACCEPT_INCONCLUSIVE = false`, behave as before.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `done`
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If no candidates, report that no finished features were found

## Check INCONCLUSIVE Verdicts

Read `.planning/features/{name}/VERIFY.md`. Search for any of:
- `status: INCONCLUSIVE` in the frontmatter, OR
- Any row in the Stage 1 table with verdict `INCONCLUSIVE`.

If found:
- **If `ACCEPT_INCONCLUSIVE = false`:** Display:
  ```
  Cannot finish — VERIFY.md contains INCONCLUSIVE verdicts:
  {list each INCONCLUSIVE criterion}

  Options:
  1. Add runnable <verify> commands to PLAN.md for the inconclusive criteria, then re-run /ship:verify.
  2. Override with: /ship:finish {name} --accept-inconclusive "reason for manual acceptance"
  ```
  Stop. Do not proceed to Prerequisites.
- **If `ACCEPT_INCONCLUSIVE = true`:** Append the override record to VERIFY.md's `## Inconclusive Override` section:
  - Set `Override applied: yes`
  - Set `Reason: {the reason text}`
  - Set `Operator: $(git config user.email || echo unknown)`
  - Set `Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)`
  Then continue to Prerequisites.

If VERIFY.md has no INCONCLUSIVE markers, proceed directly to Prerequisites.

## Prerequisites

Run the project's test suite to confirm everything passes:

```bash
# Auto-detect test command from package.json, Cargo.toml, etc.
# If unclear, ask the user for the test command
```

If tests fail, stop and report failures. Do not proceed.

## Present Options

```
Feature '{name}' is verified and complete.

1. Create a Pull Request (push branch + gh pr create)
2. Merge to {base-branch} locally
3. Keep as-is (I'll handle it later)

Which option?
```

Use AskUserQuestion to get the user's choice.

## Execute Choice

### Option 1: Create PR

First, check that `gh` is available: `gh auth status`. If it fails, tell the user to install/authenticate `gh` and abort.

```bash
# Detect base branch
git rev-parse --verify main &>/dev/null && echo main || echo master

# Determine PR title type from branch commits
# Look at commit prefixes (feat, fix, refactor, etc.) — use the most common one
# If mixed or unclear, default to "feat"

# Get feature summary from CONTEXT.md for PR body
# Push and create PR
git push -u origin HEAD
gh pr create --title "{type}: {feature-name}" --body "$(cat <<'EOF'
## Summary
{2-3 bullets from CONTEXT.md acceptance criteria}

## Test plan
{key verify commands from PLAN.md}

Built with [Ship](https://github.com/dilhanz/ship)
EOF
)"
```

Report the PR URL to the user.

### Option 2: Merge Locally

```bash
# Detect base branch
BASE=$(git rev-parse --verify main &>/dev/null && echo main || echo master)

git checkout $BASE
git merge {feature-branch}
```

Run tests again on the merged result. If tests pass, report success.

### Option 3: Keep As-Is

Report: "Feature '{name}' kept on current branch. Run `/ship:finish` again when ready."
Do NOT archive the feature directory for this option.

## Archive Feature

After Option 1 or Option 2 completes successfully, move the feature directory to the archive:

```bash
mkdir -p .planning/archive
mv .planning/features/{feature-name} .planning/archive/{feature-name}
```

This preserves the full history (CONTEXT.md, PLAN.md, VERIFY.md) while keeping `.planning/features/` clean for active work.

Then run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {feature-name}` to sync PM state (silent no-op when `.project-manager/` is absent) — archive presence is what maps the roadmap row to `done`.

## Report

```
## FEATURE FINISHED

Feature: {name}
Action: {PR created / Merged to main / Kept as-is}
{If PR:} PR: {url}
{If merged:} Branch merged and tests passing
Archived: .planning/archive/{name}
```

$ARGUMENTS
