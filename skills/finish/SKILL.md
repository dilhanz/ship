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

## Auto Run (/ship:auto only)

Applies only when the `/ship:auto` skill invoked this skill in this session and `.planning/features/{name}/AUTO.json` exists. Invoked directly, this skill never enters this section and every question below still fires. In an auto run, and only then:

- **Prerequisites:** if the test command cannot be detected, do not ask. Stop and report `test command not detected`; nothing is pushed.
- **Present Options:** not shown, no AskUserQuestion; take Option 1. The user authorized one push and one PR when they invoked `/ship:auto`.
- **Branch guard:** before Option 1 runs anything, compare `git rev-parse --abbrev-ref HEAD` with the base branch Option 1 detects (`main`, else `master`) and with origin's default branch (`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, minus the `origin/` prefix, when it resolves). If the current branch equals either one, or the checkout is detached (the command prints `HEAD`), stop: nothing is pushed, no PR is opened, and the report says the feature is on the base branch and has to move onto its own branch first. An unprompted push of the base branch would publish the commits with no pull request.
- **Option 1:** the commands are unchanged: `gh auth status`, `git push -u origin HEAD` (never a force push), `gh pr create` (never `--draft`, never a merge). When the INCONCLUSIVE override was applied, the PR body gains a `## Inconclusive criteria` section after `## Test plan`, listing each inconclusive criterion from VERIFY.md. If `gh auth status`, the push, or `gh pr create` fails, stop there (no stamp, no archive, no ledger change) and report which step failed.
- **Archive outcome:** not asked; stamp `shipped`.
- **Run record:** the archive helper (`## Archive Feature`) deletes `.planning/features/{name}/AUTO.json` before it moves the directory, and in a repository that tracks `.planning/` it also removes the record from the index, so the record is never archived. Do not delete it separately.
- **Second push:** in tracked mode the archive lands as a commit on the PR branch, so run `git push` (never a force push) after it; that push is part of the PR the user authorized.
- **After the report:** return to the auto skill's final report. On any stop above, return to the auto skill's `## Route` with the reason.

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
PR_URL=$(gh pr create --title "{type}: {feature-name}" --body "$(cat <<'EOF'
## Summary
{2-3 bullets from CONTEXT.md acceptance criteria}

## Test plan
{key verify commands from PLAN.md}

Built with [Ship](https://github.com/dilhanz/ship)
EOF
)")

# `gh pr create` prints the URL on success. When its output is empty or is not
# a URL (an existing PR, a warning-only run), ask for the URL directly.
case "$PR_URL" in
  https://*) ;;
  *) PR_URL=$(gh pr view --json url -q .url) ;;
esac
```

Report the PR URL (`$PR_URL`) to the user, then stamp it into the feature record.

### Stamp the PR URL

Record the PR on the feature itself, so merge provenance is a lookup on disk rather than git archaeology later. The URL is written verbatim as `gh` printed it — the PR number stays derivable from it rather than stored twice.

Stamp it **before** the archive move, while the directory is still at `.planning/features/{feature-name}/`. Stamping after the move would target a path that no longer exists. This is the same ordering rule the `outcome:` stamp follows, and for the same reason.

This skill has no Write or Edit tool, so the stamp goes through the record helper — one plain command, with the URL as a literal argument (no shell variables, loops or functions: a worktree-isolated session refuses a command it cannot verify):

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/finish-record.cjs" stamp {feature-name} pr {the PR URL}
```

It replaces an existing `pr:` line, otherwise inserts one directly after the `status:` line inside the leading frontmatter block, and leaves every other byte alone. It prints one JSON line; `ok: false` with a `warning` means nothing was written.

A failed or impossible stamp is **not fatal** — report the failure, leave the field absent, and let the archive proceed. An empty value or one that is not a URL (neither `gh pr create` nor the `gh pr view` fallback produced one) writes nothing: an absent field is a recorded gap, whereas a literal `pr: ` line with no value would be a false record. A CONTEXT.md with no leading frontmatter block behaves the same way — left byte-identical.

Option 2 and Option 3 open no PR and stamp nothing.

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

Stamp the answer into the feature's CONTEXT.md frontmatter **before** the move, while the directory is still at `.planning/features/{feature-name}/`. Stamping after the move would target a path that no longer exists.

This skill has `allowed-tools: Read, Bash, Glob, AskUserQuestion` and **no Write or Edit**, so the stamp goes through the record helper, as one plain command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/finish-record.cjs" stamp {feature-name} outcome {shipped|abandoned|superseded|umbrella}
```

It replaces an existing `outcome:` line, otherwise inserts one directly after the `status:` line inside the leading frontmatter block, and leaves every other byte alone. Any other outcome value is refused and nothing is written.

A failed stamp is **not fatal** — the archive still proceeds. CONTEXT.md then carries no `outcome:`, which is a visible gap rather than a false `shipped`. Report the failure and move on; never block the archive on it.

### Move the directory

One command archives the feature and closes its ledger row (see `## Close the Ledger Row` below). Run it from the checkout that holds the feature:

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/finish-record.cjs" archive {feature-name}
```

It prints one JSON line: `{ ok, mode, archived, ledger, commit, warning? }`. The helper picks the mode from git, never from a flag:

- **`tracked`** — `.planning/features/{feature-name}/` is in git (the repository commits its planning records). The archive happens **inside the current branch**: `git mv` to `.planning/archive/{feature-name}/`, the row moves in this checkout's tracked `.planning/LEDGER.md`, and one commit, `chore({feature-name}): archive the feature record`, records both. After Option 1, run `git push` so the pull request carries that commit; the merge then lands the archive and the ledger move on the base branch, and nothing has to be reconciled by hand afterwards. Two open branches that both move a row to the top of `## Shipped` touch the same lines; that is a mechanical conflict (keep both rows) for whoever merges second.
- **`untracked`** — the record is not in git. The directory moves to the **main worktree's** archive (`$MAIN_ROOT/.planning/archive/{feature-name}/`, where `MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`), so the audit trail survives `git worktree remove`, and the row moves in `$MAIN_ROOT/.planning/LEDGER.md`, the one ledger at the main root. Not a git repository → the local `.planning/archive/` and `.planning/LEDGER.md`.

Either way the helper deletes `AUTO.json` first, and in tracked mode removes it from the index too, so a `/ship:auto` run record is never archived. `ok: false` means nothing was moved: report the `warning` and do not claim an archive in the report.

**In untracked mode the move relocates the record for everyone, out of band.** Once it lands on `main`, every open branch still carries `.planning/features/{feature-name}/`, so a branch that later amends that record is editing a path `main` no longer has. GitHub has been observed to report `mergeable: CONFLICTING` with no file named even for a near-pure-rename archive commit. **A branch that will amend the archived record must sync `main` first**: merge `main` into it locally, confirm exactly one copy of the record remains — at the archive path, carrying the branch's edits — and push that merge. Say this in the report whenever you archive a feature that has open follow-up branches.

Anything outside `.planning/` that hard-codes a feature path (an E2E script writing to `.planning/features/{name}/shots`, for instance) breaks at the same moment, for the same reason. Archiving moves the directory; it does not update references to it.

## Close the Ledger Row

The archive command above does this; there is no separate step. Read `${CLAUDE_PLUGIN_ROOT}/skills/ledger/SKILL.md` for the format. It removes the feature's row from `## Now` / `## Next` / `## Someday` and inserts `- [x] {feature-name} → .planning/archive/{feature-name}/` at the **top of `## Shipped`**, which is ordered by recency, so the newest row goes first. The ledger it edits is the tracked `.planning/LEDGER.md` of the current checkout in tracked mode, and `$MAIN_ROOT/.planning/LEDGER.md` otherwise.

If no row for the feature exists in any section, the `## Shipped` row is still added — a feature that shipped without ever sitting in the ledger still belongs in its history. An absent `.planning/LEDGER.md` is skipped silently (`ledger: "absent"`): a project that never made a ledger is not in an error state. A `ledger: "failed"` with `ok: true` is **not fatal** — the archive happened; report the warning and move on, the same as a failed `outcome:` stamp.

On **Option 3 (keep as-is)** the feature is not archived, so do not run the helper and do not touch the ledger: the row stays where it is and the work is still in flight.

## Report

```
## FEATURE FINISHED

Feature: {name}
Action: {PR created / Merged to main / Kept as-is}
{If PR:} PR: {url}
{If merged:} Branch merged and tests passing
Archived: .planning/archive/{name} ({tracked: "committed on the branch as {commit}" | untracked: "in the main checkout — a branch that will amend this record must merge main first"})
Ledger: moved to ## Shipped{, "no ledger" when absent, or "unchanged — feature kept in flight" on Option 3}
```

$ARGUMENTS
