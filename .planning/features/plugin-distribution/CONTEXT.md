---
feature: "plugin-distribution"
status: done
created: "2026-03-26"
---

## Problem

Ship uses a custom `install.js` that copies files into `.claude/` and manually registers hooks in `settings.json`. This requires users to run `npx github:dilhanz/ship` for install and updates, maintain a custom update-check hook, and a custom uninstall skill. The Claude Code plugin system provides all of this natively — install, update, uninstall, hook registration, skill discovery — with a single `claude plugin install` command.

## Solution

Restructure Ship as a standard Claude Code plugin by adding `.claude-plugin/plugin.json` manifest and `hooks/hooks.json` for declarative hook registration. Drop the `ship-` prefix from all skill directories and hook files (plugin namespace `ship:` handles disambiguation). Remove the update-check hook and uninstall skill (plugin system handles both natively). Update all hardcoded `.claude/` paths to use `${CLAUDE_PLUGIN_ROOT}`. Move all temp/cache files to `${CLAUDE_PLUGIN_DATA}` for clean isolation. Set up GitHub marketplace.json for distribution via `/plugin marketplace add dilhanz/ship`.

## Decisions

- **Skill naming**: Drop `ship-` prefix from all 16 skill directories. `ship-start` becomes `start`, invoked as `/ship:start`. Eliminates redundant `ship:ship-start` namespace.
- **Hook naming**: Drop `ship-` prefix from all 7 hook files. `ship-guide.cjs` becomes `guide.cjs`. Internal to plugin, users never see these.
- **Agent skill references**: Rename internal references too (e.g., builder's `skills:` frontmatter: `ship-deviation-rules` becomes `deviation-rules`). Full clean break, no backward compat.
- **install.js**: Deprecate (keep but mark deprecated). Plugin is the primary install path. Remove in next major version.
- **Temp/cache files**: Move everything to `${CLAUDE_PLUGIN_DATA}` — session locks, context metrics, update caches, warning debounce files. Full isolation.
- **Path references**: Replace `.claude/` with `${CLAUDE_PLUGIN_ROOT}/` in skills and agents. Keep current file structure (no co-location of templates with skills — that's a separate improvement).
- **ship-check-update hook**: Remove entirely. Plugin system handles updates natively via `claude plugin update`.
- **ship-update skill**: Remove entirely. Same reason.
- **ship-uninstall skill**: Remove entirely. Plugin system handles uninstall via `claude plugin uninstall`.
- **ship-guide hook**: Keep — Ship's proactive feature detection and command suggestions are too valuable. Update command references from `/ship-start` to `/ship:start` etc.
- **Distribution**: GitHub marketplace. Users: `/plugin marketplace add dilhanz/ship`, then `claude plugin install ship`. No npm dependency.
- **Marketplace config**: Include `.claude-plugin/marketplace.json` in this feature scope.

## Acceptance Criteria

- [ ] `.claude-plugin/plugin.json` exists with correct schema (name, version, description, hooks reference, etc.)
- [ ] `hooks/hooks.json` declaratively registers all remaining hooks (guide, context-monitor, safety-gate, post-compact, subagent-stop, statusline) with `${CLAUDE_PLUGIN_ROOT}` paths
- [ ] All 16 skill directories renamed: `ship-X` becomes `X` (start, plan, plan-verify, build, verify, go, status, resume, help, design, deviation-rules, git-commits, tdd, finish)
- [ ] All 5 remaining hook files renamed: drop `ship-` prefix (guide.cjs, context-monitor.cjs, safety-gate.cjs, post-compact.cjs, subagent-stop.cjs, statusline.cjs)
- [ ] check-update hook removed (file deleted)
- [ ] update skill directory removed
- [ ] uninstall skill directory removed
- [ ] Agent frontmatter `skills:` references updated to new names (deviation-rules, git-commits, tdd)
- [ ] All hardcoded `.claude/` paths in skills and agents replaced with `${CLAUDE_PLUGIN_ROOT}/`
- [ ] All hook scripts updated: temp/cache file paths use `${CLAUDE_PLUGIN_DATA}` instead of `/tmp/` and `~/.claude/cache/`
- [ ] ship-guide hook updated: command references use `/ship:X` format
- [ ] install.js marked as deprecated (comment + console warning) but still functional
- [ ] `.claude-plugin/marketplace.json` created for GitHub-based distribution
- [ ] `claude --plugin-dir .` loads Ship correctly (local testing)
- [ ] All existing tests pass (updated for new file names/paths)

## Scope

**In scope:**
- Plugin manifest and hooks.json creation
- Skill directory and hook file renames
- Path variable updates (CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA)
- Removal of update/uninstall skills and check-update hook
- Marketplace.json for distribution
- install.js deprecation (not removal)
- Test updates for new names/paths
- CLAUDE.md and README.md updates

**Out of scope:**
- Co-locating templates with skills (item 6 — separate feature)
- Removing install.js entirely (next major version)
- npm distribution (GitHub marketplace chosen)
- `paths:` frontmatter for scope limiting (item 15 — separate feature)
- `context: fork` for lightweight skills (item 16 — separate feature)

## Research Notes

Claude Code plugin system verified against latest docs (March 2026):
- Plugin format: `.claude-plugin/plugin.json` manifest at root, all components at plugin root
- Hooks: `hooks/hooks.json` with same structure as settings.json hooks object, using `${CLAUDE_PLUGIN_ROOT}` for script paths
- Skills auto-namespaced as `plugin-name:skill-name`
- `${CLAUDE_PLUGIN_DATA}` persists across plugin updates at `~/.claude/plugins/data/{id}/`
- StatusLine supported in plugins via hooks.json
- Local testing via `claude --plugin-dir ./`
- Marketplace: `.claude-plugin/marketplace.json` with GitHub source type
