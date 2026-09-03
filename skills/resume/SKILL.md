---
name: resume
description: Use when returning to continue work on an in-progress feature — picks up where you left off based on feature status
effort: medium
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, AskUserQuestion, EnterWorktree
argument-hint: "[feature-name]"
---

Resume work on a feature.

1. Find the feature with the shared helper — it looks across the main checkout, every linked worktree, and the archive, so a feature whose directory `/ship:start` moved into a worktree is found from anywhere:

   ```bash
   # with a name in $ARGUMENTS:
   node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs" {name}
   # without one:
   node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"
   ```

   It prints one line of JSON. Parse it. `features` is a map keyed by slug; each entry carries `dir` (the absolute feature directory), `status`, `location` (`main` | `worktree` | `archive`), `branch`, `path` (the checkout that holds it), `here` (true when it sits in the current checkout), `owner` (`sole` | `branch` | `cwd` | `ambiguous`), `copies`, and `candidates`. If `warning` is non-null, surface it verbatim.

   Only after the helper has looked across every worktree: if `features` is empty, tell the user no features exist and suggest `/ship:start`. Saying so from a cwd-only glob is how a second directory gets created for work already in flight.

2. Pick the feature: the named one when `$ARGUMENTS` is given; otherwise the entries whose `status` is not `done`. If several qualify, show them (slug, status, location) and ask which one to resume.

3. **Hop if needed.** Before consulting the status table, check where the chosen entry lives:

   - `here` is true → continue.
   - `here` is false and `location` is `worktree` or `main` → report "`{name}` lives in `{path}` on `{branch}`" and ask once with `AskUserQuestion`, options **Enter that worktree** / **Stay here**. On yes, call `EnterWorktree` with `path: {path}` and continue from there. On no, report the next step from the table below and stop — do not run a build step against a checkout that does not hold the feature. Never enter automatically — relocating the session is a side effect a read-shaped command must ask about.
   - `owner` is `ambiguous` → several checkouts hold the folder and no branch or cwd rule picks one. List the `candidates` (path, branch, status), ask which copy to resume, then hop to it the same way.
   - `location` is `archive` → say the feature is already shipped and stop.

4. Read the feature's `CONTEXT.md` from the entry's `dir` — not from the cwd — and determine the next action based on status:

| Status | Action |
|--------|--------|
| `brainstormed` | Run `/ship:plan` |
| `planned` | Run `/ship:plan-verify` |
| `plan-verified` | Run `/ship:build` |
| `building` | Run `/ship:build` (will resume from last completed task) |
| `built` | Run `/ship:verify` |
| `done` | Tell the user this feature is complete |

5. Tell the user what you found and what the next step is, then invoke the appropriate command.

$ARGUMENTS
