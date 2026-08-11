# Conventions

- Zero npm dependencies. Everything is Node built-ins (`fs`, `path`, `os`, `https`, `child_process`) —
  adding a package is a decision, not a detail.
- Hooks are stdin→stdout Node CJS scripts that must never throw and never block: wrap everything in
  try/catch and exit 0 on error, however broken the input.
- The version lives in three files — `ship/VERSION`, `package.json`, `.claude-plugin/plugin.json` —
  and they must agree with a matching `## {version}` CHANGELOG section, or the release workflow
  rejects the tag.
- Commits are `<type>(<feature-name>): <description>`; for changes to Ship itself the feature name is
  omitted (`feat: …`). Imperative, lowercase, no period.
- Tests are `node --test` files under `tests/`. CI runs `node --test "tests/*.test.js"` — pass the
  glob, not the bare directory, which recent Node versions try to resolve as a module.
- Stage specific files, never `git add .` — a PreToolUse hook blocks it to keep commits atomic.
- Skill and agent descriptions use the "Use when …" trigger format so semantic matching can route to
  them.
- Conventions are appended here as they are discovered. The test for whether something belongs: would
  a fresh session tomorrow know it without being told?
