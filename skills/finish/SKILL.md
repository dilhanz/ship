---
name: finish
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

After Option 1 or Option 2 completes successfully, archive the feature — first stamp the outcome, then move the directory.

### Stamp the archive outcome

Ask the user, with AskUserQuestion, which outcome this archive records:

- **shipped** (default) — the feature was built and verified, and this archive records working work.
- **abandoned** — the work stopped and is not coming back.
- **superseded** — another feature replaced it.
- **umbrella** — a container for other features rather than shippable work of its own.

Stamp the answer into the feature's CONTEXT.md frontmatter **before** the move, while the directory is still at `.planning/features/{feature-name}/`. Stamping after the `mv` would target a path that no longer exists — in a worktree-isolated session it would silently do nothing.

This skill has `allowed-tools: Read, Bash, Glob, AskUserQuestion` and **no Write or Edit**, so the stamp goes through Bash. Replace an existing `outcome:` line if there is one, otherwise insert one directly after the `status:` line inside the leading frontmatter block, and leave every other byte alone:

```bash
CTX=".planning/features/{feature-name}/CONTEXT.md"
OUTCOME={shipped|abandoned|superseded|umbrella}
node -e '
  const fs = require("fs"), [p, v] = process.argv.slice(1);
  const s = fs.readFileSync(p, "utf8");
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) process.exit(1);
  let fm = m[1];
  fm = /^outcome:/m.test(fm)
    ? fm.replace(/^outcome:.*$/m, "outcome: " + v)
    : fm.replace(/^(status:.*)$/m, "$1\noutcome: " + v);
  if (!/^outcome:/m.test(fm)) fm += "\noutcome: " + v;
  fs.writeFileSync(p, s.slice(0, m.index) + "---\n" + fm + "\n---" + s.slice(m.index + m[0].length));
' "$CTX" "$OUTCOME" && grep -n '^outcome:' "$CTX"
```

A failed stamp is **not fatal** — the archive still proceeds. The ledger then records `outcome: unknown`, which is a recorded gap rather than a false `shipped`. Report the failure and move on; never block the archive on it.

### Move the directory

Move the feature directory to the **main worktree's** archive. Resolve the main worktree root first:

```bash
MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
mkdir -p "$MAIN_ROOT/.planning/archive"
mv .planning/features/{feature-name} "$MAIN_ROOT/.planning/archive/{feature-name}"
```

In the main worktree, `MAIN_ROOT` resolves to the current root — behavior unchanged. From a linked worktree, this moves the record to the main worktree so the audit trail (CONTEXT.md, PLAN.md, VERIFY.md) survives `git worktree remove`. If `git rev-parse` fails (not a git repo), fall back to the local `.planning/archive/` exactly as before.

Then run pm-update **from the main root** so its archive check sees the moved directory (`mappedStatus` runs against its cwd):

```bash
cd "$MAIN_ROOT" && node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {feature-name}
```

This syncs PM state (silent no-op when `.project-manager/` is absent — pm-update finds the main root's `.project-manager/` itself via the resolver) — archive presence at the main root is what maps the roadmap row to `done`. It is mechanical only: status cells and the dashboard. Authored `.project-manager/` edits are never applied here.

## Carry the PM Handoff

Check for `PM-HANDOFF.md` in the feature directory — at its archived location after Option 1 or 2, or in place under `.planning/features/{name}/` after Option 3.

The archive `mv` above moves the whole feature directory, so on Options 1 and 2 the handoff reaches the main worktree root with the rest of the record and needs no separate step. Do not attempt to apply it: the edits belong to the PM layer, and this skill has no Write or Edit tool by design.

If the handoff exists and its frontmatter reads `applied: no`, surface it in the report below. On Option 3 (keep as-is), say explicitly that the handoff is still sitting in this worktree — if the lane is later removed without finishing, an unapplied handoff goes with it.

## Report

```
## FEATURE FINISHED

Feature: {name}
Action: {PR created / Merged to main / Kept as-is}
{If PR:} PR: {url}
{If merged:} Branch merged and tests passing
Archived: .planning/archive/{name}
{If an unapplied PM-HANDOFF.md exists:} PM handoff pending: {N} shared .project-manager/ edit(s) at {path} — run /ship:pm apply
```

$ARGUMENTS
