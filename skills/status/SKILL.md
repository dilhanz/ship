---
name: status
description: Use when checking feature progress or wanting to see what features exist and their current status
effort: low
allowed-tools: Read, Glob, Bash
---

Show the status of all features with progress details.

1. Resolve every feature with the shared helper — it looks across the main checkout, every linked worktree, and the archive, so a feature whose directory `/ship:start` moved into a worktree is listed rather than missed:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"
   ```

   It prints one line of JSON. Parse it. `features` is a map keyed by slug; each entry carries `dir` (the absolute feature directory), `status`, `location` (`main` | `worktree` | `archive`), `branch`, `path` (the checkout that holds it), `here` (true when it sits in the current checkout), `owner` (`sole` | `branch` | `cwd` | `ambiguous`), `copies`, `candidates`, and `alsoArchived`. If `warning` is non-null, surface it verbatim before the summary.

2. If `features` is empty, tell the user no features have been started and suggest `/ship:start "your idea"`. Otherwise iterate the map.

3. For each entry, read `CONTEXT.md` from the entry's `dir` — it may be in another worktree; read it there, never in the cwd — and extract:
   - Feature name (from frontmatter)
   - Status (from frontmatter)
   - Problem summary (first sentence of ## Problem)
   - Number of acceptance criteria

   An `ambiguous` entry has `dir: null` (several checkouts hold the folder and no branch or cwd rule picks one). Do not read it; list its `candidates` (path, branch, status) in its place.

4. If a `PLAN.md` exists in `dir`, also extract:
   - Total tasks and how many are done
   - If the plan has `<phase>` elements, list each phase with its status and task counts
   - Identify the current phase (first phase with status != "done")

5. If a `VERIFY.md` exists in `dir`, note whether verification passed or found gaps.

6. Display as a formatted summary:

```
## Ship Status

| Feature | Status | Location | Progress | Summary |
|---------|--------|----------|----------|---------|
| {name}  | {status} | {location} | {done}/{total} tasks | {problem summary} |
```

   **Location** is `here` when `here` is true; otherwise `{branch}` (`detached` when null), `archive` for an archived entry, or `{copies} copies` for an ambiguous one.

7. For the active (non-done) feature, show additional detail:

   **Phase progress** (if phased plan):
   ```
   Phase 1: {name} — done (3/3 tasks)
   Phase 2: {name} — building (1/4 tasks) ← current
   Phase 3: {name} — pending (0/2 tasks)
   ```

   **Next step** based on status:
   - `brainstormed` → "Next: `/ship:plan` to create the implementation plan"
   - `planned` → "Next: `/ship:plan-verify` to verify the plan against the codebase"
   - `plan-verified` → "Next: `/ship:build` to start building"
   - `building` → "Next: `/ship:build` to continue building (or `/ship:resume` in a new session)"
   - `built` → "Next: `/ship:verify` to verify acceptance criteria and hunt bugs"
   - `done` → "Feature complete! Start something new with `/ship:start`"

   When the active feature is not `here`, append " (in worktree `{path}` — `/ship:resume {name}` offers to enter it)" to the next-step line — the command must run where the feature lives.

This skill is read-only: it writes nothing, and only reports.

$ARGUMENTS
