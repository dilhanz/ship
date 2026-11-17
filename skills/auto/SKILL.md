---
name: auto
description: Use when you want to take an idea, a ledger row or an in-flight feature all the way to a pull request with no prompts after the brainstorm
effort: high
allowed-tools: Read, Write, Edit, WebSearch, WebFetch, Glob, Grep, Bash, AskUserQuestion, EnterWorktree, Skill, ToolSearch
argument-hint: "[\"idea\" | slug] [--profile <quick|standard|thorough>] [--fix-rounds <n>]"
---

Carry one feature from an idea to a pull request. The run brainstorms with the user (same confirmation gate as `/ship:start`), then plans, builds, verifies, runs fix rounds and opens the PR in this session, in the feature's own worktree, without asking anything further. It starts from a quoted idea, a ledger row that has no folder yet, or a feature already in flight.

**Authorization.** Invoking `/ship:auto` authorizes one push and one ready-for-review pull request for this feature. It never merges, never force-pushes, never opens a draft, and never pushes or opens a PR on a run that did not pass verification (a PASS, or an INCONCLUSIVE with the override recorded in VERIFY.md). A harness permission prompt on `git push` or `gh pr create` depends on the user's permission mode and is outside this skill's control.

The run spans several turns. Whenever it continues (a workflow notification, a skill returning, a compaction), come back to this skill's sections; `## Route` decides what happens next.

## Parse arguments

From `$ARGUMENTS`, strip `--profile {value}` and `--fix-rounds {n}` (both the `--flag value` and `--flag=value` forms, any order) and the internal `--resume`. `--fix-rounds` must be a whole number 0–3; any other value is treated as absent. What remains is the **start text**. `--resume` is passed only by the compaction hook; its start text is always the slug of a feature in flight.

## Resolve the start

Run the lookup, always unfiltered, and parse its one line of JSON (`features` is a map keyed by slug; surface a non-null `warning`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/start/SKILL.md` once, here. Take the `MAIN_ROOT` command and the ledger file's path from its `## Ledger Row` section, and read the ledger at that path if it exists. This skill calls that file "the ledger" and never spells its name: start's section owns the path.

A **slug-shaped token** is a start text with no whitespace that matches `^[a-z0-9][a-z0-9-]*$`. Take the first case that applies:

1. A slug-shaped token that is a key in `features` with `location` `main` or `worktree` → **in flight**. If `owner` is `ambiguous`, stop and list the `candidates` (path, branch, status). If `here` is false, call `EnterWorktree` with `path:` set to the entry's `path`, without asking; if that fails, stop and say where the feature lives. Then go to **Branch guard**.
2. A slug-shaped token that matches a ledger row under `## Now`, `## Next` or `## Someday` and has no folder → **new**. The feature name is the slug and the idea is the row's one-liner verbatim.
3. A slug-shaped token found only in the archive (`location` is `archive`) → report that the feature is already shipped, and stop.
4. A slug-shaped token that matches nothing → report `{slug}` as not found, list the live features (`{slug} [{status} · {location}]`) and the ledger rows, say that a new idea needs a description, and stop.
5. Empty start text → ask the user to describe the idea. This is the one question before the brainstorm.
6. Anything else → **new**. The idea is the start text and the slug is derived as `/ship:start` does (a short kebab-case slug). If that slug is already a live feature, treat it as in flight (case 1).

## New: brainstorm

The brainstorm is interactive and runs in this conversation, never in a subagent (`AskUserQuestion` fails there). Read `${CLAUDE_PLUGIN_ROOT}/skills/start/references/brainstorm.md` and follow it unchanged, with the feature name and the idea from above, including its confirm-before-writing gate. Do not create the feature directory before the user has confirmed the summary.

Where CONTEXT.md is written depends on the checkout (`MAIN_ROOT` as above, `CWD_ROOT=$(git rev-parse --show-toplevel)`):

- **Main checkout** (`MAIN_ROOT` equals `CWD_ROOT`): write `.planning/features/{name}/CONTEXT.md` here. The worktree section moves it.
- **Already in a linked worktree:** once the summary is confirmed, run the worktree section's `git worktree add` first and write CONTEXT.md directly into `$MAIN_ROOT/.claude/worktrees/{name}/.planning/features/{name}/`. There is nothing to move.

## New: ledger row

Follow the `## Ledger Row` section of `skills/start/SKILL.md` as read above. That section owns the file's path, the create-if-absent rule and the move and insert rules. The outcome: a row that already exists for `{name}` moves to the top of `## Now` with its one-liner untouched; otherwise `- [ ] **{name}** — {one-line summary}` is inserted there. The ledger is the one at the main worktree root, never a linked worktree's copy. The row format is given here so the section's pointer to the ledger skill need not be followed.

One difference from start: a slug already under `## Shipped` keeps that row untouched and the new row is added without asking. Start asks; an auto run does not.

## New: worktree, no offer

A new feature always gets its own worktree, and the session enters it. No question.

```bash
git worktree add -b feature/{name} "$MAIN_ROOT/.claude/worktrees/{name}" main
mkdir -p "$MAIN_ROOT/.claude/worktrees/{name}/.planning/features/{name}"
cp -R "$CWD_ROOT/.planning/features/{name}/." "$MAIN_ROOT/.claude/worktrees/{name}/.planning/features/{name}/"
```

Remove the main-checkout copy (`rm -rf "$CWD_ROOT/.planning/features/{name}"`) only when `git status --porcelain -- ".planning/features/{name}"` shows every line beginning `??`. If any line does not, copy without removing and say the main checkout still holds a copy. The ledger is not carried across. When CONTEXT.md was written straight into the new worktree, `git worktree add` has already run: skip all three commands and the removal, and do not run it a second time.

Then call `EnterWorktree` with `path: "$MAIN_ROOT/.claude/worktrees/{name}"`.

- `git worktree add` fails (the branch or path exists), or git is unavailable → stop, leave the feature directory where it is, and report.
- `EnterWorktree` fails → stop, and say to open a session in the worktree and run `/ship:auto {name}`.

## Branch guard

An auto run ends in `git push -u origin HEAD` with no prompt, so it must never run on the base branch. An in-flight feature can sit there: `/ship:start` leaves it in the main checkout on the default branch when the user declines the worktree. Check every start, new or in flight, from the checkout that holds the feature:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BASE=$(git rev-parse --verify main &>/dev/null && echo main || echo master)
ORIGIN_DEFAULT=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
echo "branch=$BRANCH base=$BASE origin-default=$ORIGIN_DEFAULT"
```

The base-branch detection is the one finish's Option 1 uses. The guard **fails** when `BRANCH` equals `BASE`, equals a non-empty `ORIGIN_DEFAULT`, or is `HEAD` (a detached checkout has no branch to open a PR from). On a failure, stop here: do not run go, write no run record, and run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" end {name}` so a record an earlier run left is not re-injected after a compaction. Then report:

   ```
   ## AUTO STOPPED

   Feature: {name}
   Reason: the feature is on the base branch `{branch}` (or a detached HEAD); an auto run would push it to origin with no pull request
   Unblock: move the feature onto its own branch, for example `git switch -c feature/{name}`
   Nothing was pushed and no PR was opened.
   Resume: /ship:auto {name}
   ```

Otherwise continue to **Record the run**.

## Record the run

From the checkout that holds the feature:

```bash
node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" start {name} --session "${CLAUDE_SESSION_ID}"
```

Append `--fix-rounds {n}` and `--profile {value}` when they were given, and `--resume` when it was passed. The helper prints `{ ok, resumed, record }`. The record (`.planning/features/{name}/AUTO.json`) is what the compaction hook re-injects and what tells go and finish that this is an auto run. Without `--resume` the counters start fresh. `ok: false` → Stop report with its `warning`.

## No-prompt rule

From here to the PR, the only question that may be asked is a plan-loop `NEEDS_INPUT`, which go asks in this session. Every other point where a downstream skill would ask has a fixed replacement, and the rule applies to every skill this run invokes:

- `/ship:plan` clarifying or open questions → decide, and record the decision in PLAN.md `## Decisions`, marked as decided by `/ship:auto`.
- "Ready to build?" → skipped (go runs with `--auto`).
- A manual-mode builder `NEEDS_CONTEXT` → not asked; a stop.
- Finish's PR / merge / keep choice and its archive-outcome question → Option 1 and `shipped`.
- A test command that cannot be detected → a stop.

## Resume a recorded workflow

Only when the record's `workflow` is set, which means a compaction happened while a workflow was in flight. Do not launch another workflow. Look for its result:

- **The completion result is in the conversation, or the task's output file is non-empty** (the lookup from step 3 of go's `### Headless workflow wait`, run once for the recorded `taskId`, with no loop): Read `${CLAUDE_PLUGIN_ROOT}/skills/go/SKILL.md` and apply to that result its section 2a outcome block and branch (kind `plan`) or its section 6 (kind `build`). Run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" workflow {name} clear`, then go to `## Route`.
- **The output file exists and is empty:** the workflow is still running. Say so and end the turn; its notification brings the run back here.
- **Neither can be found:** the result is lost. Clear the workflow as above and continue to **Run go**, which resumes from PLAN.md's task marks and the head-stamped VERIFY.md. First, when the lost workflow was kind `build` and CONTEXT.md already reads `done`, set it back to `built`. Go's section 6 never reconciled that verdict, so a PASS the workflow downgraded to FAIL would otherwise reach Finish. From `built`, go re-runs verification only (the verifier salvages its VERIFY.md) and the downgrade is applied again.

## Run go

If CONTEXT.md reads `status: done`, skip to **Finish**. Otherwise say that this is an auto run, then invoke the Skill tool: `ship:go` with args `{name} --auto`, plus `--profile {value}` when the record has one. Go's **Auto run** paragraph applies: it records each workflow in the run record, makes no finish offer, and hands its ending back here. Go may end the turn while a workflow runs. When its run ends, continue at `## Route`.

## Route

Read CONTEXT.md `status` and what go (or finish) just reported. Take the first row that applies:

- **Stopped** → **Stop report**. This covers a plan loop `STUCK`, `UNRESOLVED` or `BLOCKED`, a third `NEEDS_INPUT`, a builder stop of any kind, a null verdict, and a finish stop. It is checked first because a finish stop leaves the status at `done`.
- **`done`** → **Finish**.
- **`plan-verified` after a verify FAIL** (a downgraded verdict included) → count the failing set: FAIL acceptance criteria, bugs above `low`, FAIL checklist rows, and a FAIL trial merge. Take them from the workflow `verdict`, or count them from VERIFY.md in manual mode. Then:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" verdict {name} {count}
  ```

  `next: fix-round` → **Run go** again (it builds the pending fix phase and verifies again). `next: stop` → **Stop report** with its `reason` and `trend`. A second call for the same VERIFY.md returns the same decision with `repeated: true` and spends nothing, so re-entering this row after a compaction is safe.
- **`planned` after a manual-mode `NEEDS-REVISION`** → run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" bump {name} planRounds --cap 2`. `allowed: true` → invoke `ship:plan` with args `{name}` (its replan mode, no questions), then **Run go**. Otherwise → **Stop report**.
- **More to do, nothing stopped** → run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" bump {name} continueRounds --cap 5`. `allowed: true` → **Run go** again; otherwise → **Stop report** (go keeps ending with neither progress nor a stop). This is `plan-verified` with no verify verdict yet (a plan just approved, such as a plan-loop result reconciled after a compaction), or `building` or `built` with no stop reported.
- **Anything else** → **Stop report**.

## Finish

1. Run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" get {name}` and keep `fixRoundsUsed`, `fixRounds` and the `failingSets` trend for the final report: finish deletes the record before that report is written.
2. Run the `## Branch guard` check again, before `ship:finish` is invoked: the branch may have changed since the run started (a resumed run, a checkout in between). If it fails → **Stop report** with the guard's reason. Finish is not invoked and nothing is pushed.
3. If VERIFY.md carries INCONCLUSIVE markers (frontmatter `status: INCONCLUSIVE`, or a Stage 1 row with that verdict), invoke the Skill tool: `ship:finish` with args `{name} --accept-inconclusive "automatic override by /ship:auto: the pull request is the review gate; the inconclusive criteria are listed in the PR body"`. Otherwise `ship:finish` with args `{name}`. Finish's `## Auto Run (/ship:auto only)` section does the rest: the test suite, the push, the PR, both stamps, the archive move and the ledger row. If finish stops, go to `## Route`.
4. Write the final report:

   ```
   ## AUTO COMPLETE

   Feature: {name}
   PR: {url}
   Verify: {PASS | INCONCLUSIVE (override recorded)}
   Fix rounds: {used} of {budget}{ — failing set {trend}, when any round ran}
   Archived: .planning/archive/{name}
   Ledger: moved to Shipped
   ```

## Stop report

Push nothing and open no PR. Run `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" get {name}` for the counters, then `node "${CLAUDE_PLUGIN_ROOT}/ship/auto-run.cjs" end {name}` so a later `/ship:go` in this checkout is an ordinary run. Then report:

   ```
   ## AUTO STOPPED

   Feature: {name}
   Reason: {what stopped the run}
   Status: {status left in CONTEXT.md}
   [If any fix round ran:] Fix rounds: {used} of {budget} — failing set {trend}
   [If go named one:] Unblock: {the manual step go recommended}
   Nothing was pushed and no PR was opened.
   Resume: /ship:auto {name}
   ```

$ARGUMENTS
