# Conventions

- This directory is a committed test fixture, not real project state; tests copy it into a temp `.project-manager/` at run time.
- Directory names stay undotted (`pm-state`, `planning`) because the repo `.gitignore` matches `.project-manager` and `.planning` as bare patterns at any depth.
- The generated `dashboard.html` is never committed — every test regenerates it from these four files.
- Keep every row conformant with `skills/pm-state/SKILL.md`; the assertions are the format of record, the fixture is the thing under test.
