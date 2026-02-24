# Git Commit Conventions

Ship uses atomic commits — one commit per completed task.

---

## Format

```
<type>(<phase>): <description>
```

- `<type>` — one of: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- `<phase>` — two-digit phase number: `01`, `02`, etc.
- `<description>` — imperative, present tense, lowercase, no period, under 60 chars

## Examples

```
feat(01): add user model with prisma schema
feat(01): implement bcrypt password hashing
feat(02): create JWT auth middleware
fix(02): handle expired token edge case
test(03): add unit tests for auth service
refactor(03): extract email validation helper
chore(01): install bcrypt and jsonwebtoken
```

## Rules

1. **Stage specific files** — never `git add .` or `git add -A`. List exact files changed.
2. **One task = one commit** — do not batch multiple tasks into one commit.
3. **Commit only after verify passes** — the verify command in the task must succeed before committing.
4. **No WIP commits** — every commit on main represents working, verified code.

## Command Template

```bash
git add <file1> <file2> ...
git commit -m "feat(NN): description of what was done"
```
