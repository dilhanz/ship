# Build Workflow

Execute the implementation plan for the active feature. Reads PLAN.md, implements each task sequentially, and makes atomic commits.

## Prerequisites

Before starting, verify:
1. An active feature exists with `status: planned` or `status: building` in CONTEXT.md
2. `.planning/features/{name}/PLAN.md` exists with pending tasks
3. Git is initialized and working directory is clean (no uncommitted changes)

If prerequisites fail, stop and tell the user what's missing.

## Execution Loop

For each task in PLAN.md with `status="pending"`, in order:

### 1. Read the Task

Read the `<task>` element. Understand the `<action>` instructions fully before writing any code.

### 2. Implement

Follow the `<action>` instructions precisely:
- Create or modify the files listed in `<files>`
- Follow the function signatures, field names, and patterns specified
- Do not add features beyond what the action describes

### 3. Verify

Run the `<verify>` command. It must pass before committing.

If verification fails, apply the deviation rules (see `.claude/ship/references/deviation-rules.md`):
- **Rule 1 — Fix and continue:** Small issues (wrong path, missing import) — fix it and retry
- **Rule 2 — Fix with limits:** Verify fails after implementation — debug and fix, max 3 attempts
- **Rule 3 — Stop and report:** Architectural conflict or persistent failure — stop execution

### 4. Commit

Stage only the specific files changed for this task (never `git add .`):
```bash
git add <file1> <file2> ...
git commit -m "feat({feature-name}): {task description}"
```

Follow the commit conventions in `.claude/ship/references/git-commits.md`.

### 5. Mark Done

Update the task's status attribute in PLAN.md from `pending` to `done`:
```xml
<task id="N" status="done" commit="{short-hash}">
```

### 6. Update CONTEXT.md

After the first task completes, update CONTEXT.md frontmatter to `status: building`.

## Completion

When all tasks are done:

1. Update CONTEXT.md frontmatter to `status: built`
2. Output:

```
## BUILD COMPLETE

Feature: {name}
Tasks completed: [N] / [N]
Commits: [list short hashes]

Next: /ship:verify
```

## On Checkpoint (Rule 3 triggered)

If execution must stop:

1. Leave CONTEXT.md status as `building`
2. Output:

```
## CHECKPOINT REACHED

Feature: {name}
Tasks completed: [N] / [M]
Stopped at: Task [N] — [task name]
Reason: [clear explanation of the blocker]

Recommendation: [what needs to change before continuing]
```
