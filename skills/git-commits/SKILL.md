---
name: git-commits
description: Use when making git commits during Ship feature builds — provides atomic commit format and conventions
effort: medium
user-invocable: false
---

# Git Commit Conventions

Ship uses atomic commits — one commit per completed task.

---

## Format

```
<type>(<feature-name>): <description>
```

- `<type>` — one of: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- `<feature-name>` — the feature slug from `.planning/features/{name}/`
- `<description>` — imperative, present tense, lowercase, no period, under 60 chars

## Examples

```
feat(user-auth): add user model with prisma schema
feat(user-auth): implement bcrypt password hashing
fix(user-auth): handle expired token edge case
test(user-auth): add unit tests for auth service
refactor(user-auth): extract email validation helper
chore(user-auth): install bcrypt and jsonwebtoken
```

## Rules

1. **Stage specific files** — never `git add .` or `git add -A`. List exact files changed.
2. **One task = one commit** — do not batch multiple tasks into one commit.
3. **Commit only after verify passes** — the verify command in the task must succeed before committing.
4. **No WIP commits** — every commit on main represents working, verified code.
5. **Stage and commit in ONE command** — `git add ... && git commit -m ...`, never `git add` in one turn and `git commit` in the next. A turn budget that runs out between the two leaves the whole task staged and uncommitted: invisible to PLAN.md, invisible to the progress probe, and indistinguishable from a builder that did nothing. That is not hypothetical — it is how a finished, green, 470-line task was read as "no progress" and stopped a run that had four minutes of work left in it.
6. **Nothing between green and committed** — the moment a task's verify passes, the very next thing you do is the commit. Not a `git status`, not a backlog lookup, not one more read "while I'm here". Those are free once the work is safe and unrecoverable if the turn budget ends first.

## Command Template

One command — the `&&` is the point, not a style preference:

```bash
git add <file1> <file2> ... && git commit -m "feat(feature-name): description of what was done"
```
