---
name: ship-status
description: Show all features and their current status.
disable-model-invocation: true
allowed-tools: Read, Glob
---

Show the status of all features.

1. Check if `.planning/features/` exists. If not, tell the user no features have been started and suggest `/ship-start`.

2. List all feature directories in `.planning/features/`.

3. For each feature, read `CONTEXT.md` and extract:
   - Feature name (from frontmatter)
   - Status (from frontmatter)
   - Problem summary (first sentence of ## Problem)
   - Number of acceptance criteria

4. If a `PLAN.md` exists, also show:
   - Total tasks and how many are done

5. Display as a formatted table:

```
## Ship Status

| Feature | Status | Tasks | Summary |
|---------|--------|-------|---------|
| {name}  | {status} | {done}/{total} | {problem summary} |
```

If there's an active (non-done) feature, suggest the next command based on its status.

$ARGUMENTS
