---
name: start
description: Use when beginning new feature work, adding functionality, or fixing a bug — runs intensive brainstorming to capture requirements before planning
effort: high
allowed-tools: Read, Write, Edit, WebSearch, WebFetch, Glob, Bash, AskUserQuestion, EnterWorktree
argument-hint: "[feature description]"
---

Start a new feature brainstorming session.

## Setup

1. Ensure `.planning/features/` directory exists. Create it if not.

2. **First-run detection:** If `.planning/features/` was just created or is empty (no existing feature directories), this is the user's first feature. Show a brief welcome:

   > **Welcome to Ship!** This is your first feature. Here's how Ship works:
   > 1. **Brainstorm** — I'll ask questions until the problem, scope, and acceptance criteria are nailed down
   > 2. **Plan** — I'll explore your codebase and design a step-by-step plan
   > 3. **Build** — I'll implement the plan with atomic git commits
   > 4. **Verify** — I'll check that all acceptance criteria are met
   >
   > Let's start by understanding what you want to build.

3. Derive a feature name (kebab-case slug) from the user's input:
   - `$ARGUMENTS` → convert to a short kebab-case slug (e.g., "user authentication" → `user-auth`, "fix login bug" → `fix-login-bug`)
   - If no arguments provided, ask the user to describe what they want to build or fix

4. Check if `.planning/features/{name}/` already exists:
   - If it exists and status is `done`, tell the user this feature is complete. Ask if they want to start a new related feature.
   - If it exists and status is not `done`, tell the user this feature already exists and suggest `/ship:resume` instead.

5. Create the feature directory: `.planning/features/{name}/`

## Brainstorm

**IMPORTANT: Do NOT launch a subagent for brainstorming.** The brainstorming process requires interactive user input via `AskUserQuestion`, which only works correctly in the main conversation — not inside a subagent.

Read `${CLAUDE_PLUGIN_ROOT}/agents/ship-brainstormer.md` and follow its instructions **directly in this conversation** with:
- Feature name: `{name}`
- Feature idea: `$ARGUMENTS`

Explore the codebase, then probe with `AskUserQuestion` until the problem, scope boundary, and 3+ testable acceptance criteria can be stated without guessing and the user has confirmed the summary, then write `.planning/features/{name}/CONTEXT.md`.

## Ledger Row

Once CONTEXT.md is written, put the feature at the top of the ledger — it is what you are working on now, by definition.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ledger/SKILL.md` for the format. Then, in `.planning/LEDGER.md` (create it with the four empty headings if absent):

- If a row for `{name}` already exists in any of `## Now` / `## Next` / `## Someday`, **move it to the top of `## Now`** and leave its one-liner alone — the user wrote it, and brainstorming does not license rewriting it.
- If no row exists, insert `- [ ] **{name}** — {one-line summary from CONTEXT.md}` at the top of `## Now`.
- If `{name}` is already under `## Shipped`, do not touch that row. Say so, and add the new row to `## Now` only if the user confirms this is genuinely new work rather than a resumed slug.

This is the only file outside the feature directory that `/ship:start` writes.

## Offer the Worktree

Brainstorming happens in the main checkout; the build happens in a worktree. Now is the handoff point — CONTEXT.md exists, nothing is committed yet, and no code has been touched.

1. Confirm this is the main checkout:

   ```bash
   MAIN_ROOT=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
   CWD_ROOT=$(git rev-parse --show-toplevel)
   ```

   If `MAIN_ROOT` != `CWD_ROOT`, you are already in a worktree — skip this whole section and go straight to the report.
   If `git` is unavailable or this is not a repository, skip it too, and say the worktree step was skipped for that reason.

2. Ask once with `AskUserQuestion`: spin up the worktree now, or stay here?

3. **On yes:**

   ```bash
   git worktree add -b feature/{name} "$MAIN_ROOT/.claude/worktrees/{name}" main
   mkdir -p "$MAIN_ROOT/.claude/worktrees/{name}/.planning/features/{name}"
   cp -R "$CWD_ROOT/.planning/features/{name}/." "$MAIN_ROOT/.claude/worktrees/{name}/.planning/features/{name}/"
   rm -rf "$CWD_ROOT/.planning/features/{name}"
   ```

   The `rm -rf` is safe **only** because the directory was just created and is entirely untracked — verify that with `git status --porcelain -- ".planning/features/{name}"` and confirm every line begins `??` before running it. If any line does not, **copy without removing** and say the main checkout still holds a copy. Leaving the sole copy in the worktree is the point: two divergent CONTEXT.md files is the failure this avoids.

   `.planning/LEDGER.md` stays in the main checkout and is **not** carried across. The ledger is the project's index, not the feature's; it belongs where you brainstorm.

   Then call `EnterWorktree` with `path: "$MAIN_ROOT/.claude/worktrees/{name}"`. The session is now in the worktree, and `/ship:go` runs there.

   If `git worktree add` fails (the branch or path already exists), stop, report it, and leave the feature directory where it is — a half-made worktree is worse than none.

4. **On no:** say nothing more about it. `/ship:plan` and `/ship:go` work fine in the main checkout, and the user can make the worktree later.

## Report

```
## FEATURE STARTED

Feature: {name}
Context: .planning/features/{name}/CONTEXT.md
Ledger: top of ## Now
Worktree: {branch + path, or "not created — building in the main checkout"}
Next: /ship:go {name}
```

$ARGUMENTS
