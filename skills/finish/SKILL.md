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

Stamp it **before** the archive move, while the directory is still at `.planning/features/{feature-name}/`. Stamping after the `mv` would target a path that no longer exists — in a worktree-isolated session it would silently do nothing. This is the same ordering rule the `outcome:` stamp follows, and for the same reason.

This skill has no Write or Edit tool, so the stamp goes through Bash. Replace an existing `pr:` line if there is one, otherwise insert one directly after the `status:` line inside the leading frontmatter block, and leave every other byte alone:

```bash
CTX=".planning/features/{feature-name}/CONTEXT.md"
node -e '
  const fs = require("fs"), [p, v] = process.argv.slice(1);
  if (!v) process.exit(1);
  const s = fs.readFileSync(p, "utf8");
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) process.exit(1);
  let fm = m[1];
  fm = /^pr:/m.test(fm)
    ? fm.replace(/^pr:.*$/m, "pr: " + v)
    : fm.replace(/^(status:.*)$/m, "$1\npr: " + v);
  if (!/^pr:/m.test(fm)) fm += "\npr: " + v;
  fs.writeFileSync(p, s.slice(0, m.index) + "---\n" + fm + "\n---" + s.slice(m.index + m[0].length));
' "$CTX" "$PR_URL" && grep -n 'pr: ' "$CTX"
```

A failed or impossible stamp is **not fatal** — report the failure, leave the field absent, and let the archive proceed. An empty or unavailable URL (neither `gh pr create` nor the `gh pr view` fallback produced one) exits non-zero and writes nothing: an absent field is a recorded gap, whereas a literal `pr: ` line with no value would be a false record that the trailing `grep` would read back as success. A CONTEXT.md with no leading frontmatter block behaves the same way — exits non-zero, left byte-identical.

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

A failed stamp is **not fatal** — the archive still proceeds. CONTEXT.md then carries no `outcome:`, which is a visible gap rather than a false `shipped`. Report the failure and move on; never block the archive on it.

### Move the directory

Move the feature directory to the **main worktree's** archive. Resolve the main worktree root first:

```bash
MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
mkdir -p "$MAIN_ROOT/.planning/archive"
mv .planning/features/{feature-name} "$MAIN_ROOT/.planning/archive/{feature-name}"
```

In the main worktree, `MAIN_ROOT` resolves to the current root — behavior unchanged. From a linked worktree, this moves the record to the main worktree so the audit trail (CONTEXT.md, PLAN.md, VERIFY.md) survives `git worktree remove`. If `git rev-parse` fails (not a git repo), fall back to the local `.planning/archive/` exactly as before.

**The move relocates the record for everyone, out of band.** Once it lands on `main`, every open branch still carries `.planning/features/{feature-name}/`, so a branch that later amends that record — a follow-up fix PR marking a carried finding resolved in VERIFY.md, say — is editing a path `main` no longer has. Local git resolves this as the rename it is, but GitHub has been observed to report `mergeable: CONFLICTING` with no file named even for an isolated, near-pure-rename archive commit, so rename detection is not something to rely on. Two consequences worth stating when you archive:

- **Commit the move on its own**, touching nothing else. It does not guarantee clean rename detection, but it is the shape most likely to get it, and it keeps the resolution obvious when detection fails.
- **A branch that will amend the archived record must sync `main` first.** Merge `main` into the PR branch locally, confirm the resolution leaves exactly one copy of the record — at the archive path, carrying the branch's edits — and push that merge. GitHub then reports `MERGEABLE`. Say this in the report below whenever you archive a feature that has open follow-up branches.

Anything outside `.planning/` that hard-codes a feature path (an E2E script writing to `.planning/features/{name}/shots`, for instance) breaks at the same moment, for the same reason. Archiving moves the directory; it does not update references to it.

## Close the Ledger Row

The ledger lives at the **main worktree root** — `$MAIN_ROOT/.planning/LEDGER.md` — never in a linked worktree. Read `${CLAUDE_PLUGIN_ROOT}/skills/ledger/SKILL.md` for the format.

Move the feature's row out of `## Now` / `## Next` / `## Someday` and insert `- [x] {feature-name} → .planning/archive/{feature-name}/` at the **top of `## Shipped`**. This skill has no Write or Edit tool, so it goes through Bash:

```bash
node -e '
  const fs = require("fs"), [p, name] = process.argv.slice(1);
  if (!fs.existsSync(p)) process.exit(0);
  const row = "- [x] " + name + " \u2192 .planning/archive/" + name + "/";
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const slug = new RegExp("^- \\[[ x]\\] \\*{0,2}" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\*{0,2}(\\s|$|—|→)");
  const kept = lines.filter((l) => !slug.test(l.trim()));
  const i = kept.findIndex((l) => /^##\s+Shipped\s*$/.test(l));
  if (i === -1) { kept.push("", "## Shipped", row); }
  else {
    let j = i + 1;
    while (j < kept.length && (kept[j].trim() === "" || kept[j].trim() === "_(empty)_")) {
      if (kept[j].trim() === "_(empty)_") kept.splice(j, 1); else j++;
    }
    kept.splice(j, 0, row);
  }
  fs.writeFileSync(p, kept.join("\n"));
' "$MAIN_ROOT/.planning/LEDGER.md" "{feature-name}" && grep -n "{feature-name}" "$MAIN_ROOT/.planning/LEDGER.md"
```

`## Shipped` is ordered by recency, so the newest row goes first. If no row for the feature exists in any section, the `## Shipped` row is still added — a feature that shipped without ever sitting in the ledger still belongs in its history. A failed ledger edit is **not fatal**: report it and move on, the same as a failed `outcome:` stamp.

On **Option 3 (keep as-is)** the feature is not archived, so do not touch the ledger: the row stays where it is and the work is still in flight.

If `.planning/LEDGER.md` is absent, skip this silently. A project that never made a ledger is not in an error state.

## Report

```
## FEATURE FINISHED

Feature: {name}
Action: {PR created / Merged to main / Kept as-is}
{If PR:} PR: {url}
{If merged:} Branch merged and tests passing
Archived: .planning/archive/{name} — a branch that will amend this record must merge main first
Ledger: moved to ## Shipped{, or "unchanged — feature kept in flight" on Option 3}
```

$ARGUMENTS
