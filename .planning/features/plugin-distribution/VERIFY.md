# Verification Report — plugin-distribution

**Feature:** plugin-distribution
**Verified:** 2026-03-28
**Overall Status:** PASS

## Stage 1 — Spec Compliance

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `.claude-plugin/plugin.json` exists with correct schema (name, version, description, hooks reference) | PASS | `node -e "const p=JSON.parse(...); assert(p.name==='ship'); assert(p.version==='3.0.0'); assert(p.hooks==='hooks/hooks.json'); console.log('PASS')"` -> output: `PASS` |
| `hooks/hooks.json` declaratively registers all remaining hooks with `${CLAUDE_PLUGIN_ROOT}` paths | PASS | Node script parsed hooks.json: 6 commands registered, all using `node ${CLAUDE_PLUGIN_ROOT}/hooks/<name>.cjs`. StatusLine also declared via `${CLAUDE_PLUGIN_ROOT}`. |
| All 14 skill directories renamed (`ship-X` -> `X`) | PASS | `ls skills/` -> 14 directories (build, design, deviation-rules, finish, git-commits, go, help, plan, plan-verify, resume, start, status, tdd, verify). No `ship-` prefixed directories remain. |
| All 6 hook files renamed (drop `ship-` prefix) | PASS | `ls hooks/*.cjs` -> context-monitor.cjs, guide.cjs, post-compact.cjs, safety-gate.cjs, statusline.cjs, subagent-stop.cjs. No `ship-` prefixed files remain. |
| check-update hook removed (file deleted) | PASS | `ls hooks/ship-check-update.cjs` -> file does not exist |
| update skill directory removed | PASS | Neither `skills/update` nor `skills/ship-update` exist |
| uninstall skill directory removed | PASS | Neither `skills/uninstall` nor `skills/ship-uninstall` exist |
| Agent frontmatter `skills:` references updated to new names (deviation-rules, git-commits, tdd) | PASS | `grep skills: agents/ship-builder.md` -> frontmatter lists `deviation-rules`, `git-commits`, `tdd` (no ship- prefix) |
| All hardcoded `.claude/` paths in skills and agents replaced with `${CLAUDE_PLUGIN_ROOT}/` | PASS | `grep CLAUDE_PLUGIN_ROOT skills/go/SKILL.md skills/start/SKILL.md agents/ship-verifier.md` -> all 3 files use `${CLAUDE_PLUGIN_ROOT}/`. `grep '\.claude/' skills/ agents/ --include="*.md"` -> 0 matches (excluding .planning paths). Note: `.claude/skills/` and `.claude/agents/` are stale legacy copies from old install.js; the source files at repo root are correct. |
| All hook scripts updated: temp/cache file paths use `${CLAUDE_PLUGIN_DATA}` with fallback | PASS | Both `hooks/context-monitor.cjs` and `hooks/statusline.cjs` use `process.env.CLAUDE_PLUGIN_DATA \|\| path.join(os.tmpdir(), 'claude-ship')`. Identical fallback ensures context bridge works in non-plugin mode. |
| ship-guide hook updated: command references use `/ship:X` format | PASS | `grep '/ship:' hooks/guide.cjs` -> `/ship:resume`, `/ship:start`, `/ship:status`, `/ship:help`. `grep '/ship-' hooks/guide.cjs` -> 0 matches. |
| install.js marked as deprecated (comment + console warning) but still functional | PASS | Line 13: `DEPRECATED: This installer is for legacy use only.` Line 371: `console.warn('DEPRECATED: install.js is the legacy installation method.')` |
| `.claude-plugin/marketplace.json` created for GitHub-based distribution | PASS | Content: `{"source": "github", "repository": "dilhanz/ship", ...}` |
| `claude --plugin-dir .` loads Ship correctly (local testing) | NEEDS-HUMAN | Structural prerequisites verified. Requires manual test to confirm skills load as `/ship:start` etc. |
| All existing tests pass (updated for new file names/paths) | PASS | `node --test tests/*.test.js` -> 48 tests, 48 pass, 0 fail |

**Stage 1 Result: 14 PASS, 1 NEEDS-HUMAN / 15 total.**

## Stage 2 — Code Quality

### Anti-Pattern Scan

- TODO/FIXME/placeholder: None in implementation code.
- Stub implementations: None.
- Hardcoded values: The fallback `path.join(os.tmpdir(), 'claude-ship')` in both hooks is intentional per PLAN.md — ensures legacy install.js mode works without `CLAUDE_PLUGIN_DATA`.
- Zero npm dependencies maintained throughout.
- Agent body prose references updated: `agents/ship-builder.md` line 69 uses `git-commits` (not `ship-git-commits`).
- CLAUDE.md references updated: line 79 uses "the build skill" (not `ship-build`).
- Comment accuracy: `hooks/context-monitor.cjs` line 8 references `${CLAUDE_PLUGIN_DATA}/claude-ctx-{session_id}.json` (matches actual code).

### Quality Notes

- Both hook files use identical fallback path `path.join(os.tmpdir(), 'claude-ship')` — consistent, required for context bridge.
- install.js `registerSettings` and `deregisterSettings` now use consistent path-anchored `.includes()` patterns (e.g., `hooks/context-monitor.cjs` instead of bare `context-monitor`).

## Stage 3 — PR Review (powered by /review)

### Findings

| # | Confidence | Severity | File | Line(s) | Finding | Evidence |
|---|------------|----------|------|---------|---------|----------|
| 1 | 90 | WARNING (RESOLVED) | install.js | 227, 236, 247, 258, 268, 298 | `registerSettings` and `deregisterSettings` used loose substring matching. Fixed: both now use consistent path-anchored patterns (`hooks/guide.cjs`, `hooks/context-monitor.cjs`, etc.) throughout. | Current code verified — all 6 hooks use path-anchored `.includes()` checks. |

### PR Review Summary

- **Source:** Claude Code `/review` skill with Ship context (3 parallel review agents)
- **Critical:** 0
- **Warnings:** 1 (resolved in code before verification)
- **Suggestions:** 0
- **Efficiency review:** No unnecessary work, no missed concurrency, no hot-path bloat
- **Reuse review:** No duplicated functionality, zero-dependencies constraint maintained

## Human Checks Required

- [ ] Run `claude --plugin-dir .` from the repo root and confirm: all 14 skills appear as `/ship:<name>`, all 6 hooks register without error, statusLine displays correctly.

## Gaps

None. All programmatically verifiable criteria pass. The single /review WARNING was resolved before this verification run.

## Recommendation

**PASS** (pending manual `claude --plugin-dir .` interactive check)

All 14 programmatic acceptance criteria pass, all 48 tests green, code quality clean, /review finding resolved. The feature is ready to ship once the human interactive check confirms plugin loading.
