---
name: status
description: Use when checking feature progress or wanting to see what features exist and their current status
effort: low
allowed-tools: Read, Glob
---

## Active Feature State
!`for f in .planning/features/*/CONTEXT.md; do [ -f "$f" ] && d=$(dirname "$f") && echo "$(basename "$d"): $(sed -n 's/^status: *//p' "$f")"; done 2>/dev/null; true`

Show the status of all features with progress details.

1. Check if `.planning/features/` exists. If not, tell the user no features have been started and suggest `/ship:start "your idea"`.

2. List all feature directories in `.planning/features/`.

3. For each feature, read `CONTEXT.md` and extract:
   - Feature name (from frontmatter)
   - Status (from frontmatter)
   - Problem summary (first sentence of ## Problem)
   - Number of acceptance criteria

4. If a `PLAN.md` exists, also extract:
   - Total tasks and how many are done
   - If the plan has `<phase>` elements, list each phase with its status and task counts
   - Identify the current phase (first phase with status != "done")

5. If a `VERIFY.md` exists, note whether verification passed or found gaps.

6. Display as a formatted summary:

```
## Ship Status

| Feature | Status | Progress | Summary |
|---------|--------|----------|---------|
| {name}  | {status} | {done}/{total} tasks | {problem summary} |
```

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
   - `built` → "Next: `/ship:verify` to verify acceptance criteria"
   - `done` → "Feature complete! Start something new with `/ship:start`"

$ARGUMENTS
