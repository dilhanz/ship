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

## Command Template

```bash
git add <file1> <file2> ...
git commit -m "feat(feature-name): description of what was done"
```
