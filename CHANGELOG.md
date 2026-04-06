# Changelog

## 3.2.0

### Added

- **Feature archiving**: `/ship:finish` now moves completed feature directories from `.planning/features/` to `.planning/archive/` after PR creation or local merge. Keeps the active features directory clean while preserving full history (CONTEXT.md, PLAN.md, VERIFY.md). Option 3 (keep as-is) skips archiving.

## 3.1.0

### Added

- **Reference field in tasks**: Plan tasks now include a `<reference>` pointing to the closest existing code pattern. The builder reads the referenced file first and uses it as a template, producing more consistent code.
- **Adversarial self-review (Step 6.8)**: Plans are now stress-tested for idempotency, null inputs, unavailable dependencies, race conditions, and security surfaces before writing.
- **Integration verify rule**: The last task's verify command must exercise the complete feature path end-to-end, not just an isolated unit.
- **Exploration Summary in PLAN.md**: Key exploration findings (similar patterns, architecture, conventions) are now persisted in PLAN.md so the builder has codebase context without re-exploring.
- **Error path specification**: Tasks at system boundaries must specify error responses (status codes, error shapes, logging) in their action instructions.
- **Context-aware phasing**: Phases are now sized to fit within the builder's context window (40 maxTurns, ≤15 unique files per phase).
- **Task dependencies**: Optional `depends` attribute on tasks for non-sequential dependency chains.
- **Plan-verify enhanced checks (2.5)**: Verifier now validates reference file existence, dependency ordering, error path coverage, integration verify, and exploration summary presence.
- **Builder reference awareness**: Builder reads `<reference>` files before implementing each task.

## 3.0.3

### Changed

- **Structured agent output**: Builder and verifier agents now emit JSON blocks (`build_result`, `verify_result`) instead of free-text Markdown. Build and verify skills parse JSON fields directly for reliable status handling.
- **Shared feature scanner**: Extracted duplicated feature-scanning logic from `guide.cjs` and `post-compact.cjs` into a shared `scan-features.cjs` module.
- **Hook-injected feature state**: Skills no longer embed inline shell commands (`!` expansions) to scan feature state at load time. All 14 skills now rely on hook-injected "SHIP ACTIVE FEATURES" context from session start and post-compaction hooks.
- **Subagent-stop hook**: Updated to parse new JSON `build_result` format with fallbacks for raw JSON and legacy Markdown format.

## 3.0.2

### Fixed

- **Status line**: Rewrote statusline to use Claude Code's native `rate_limits` and `used_percentage` input schema fields. Removed OAuth token resolution and API fetch machinery (~100 lines). Rate limits and context percentage are now read directly from the input JSON.

### Added

- Session cost display in the status line (reads `cost.total_cost_usd` from input)

### Note

The plugin system does not support `statusLine` registration natively. After installing, add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/marketplaces/dilhanz-ship/hooks/statusline.cjs"
  }
}
```

## 3.0.0

Ship is now a Claude Code plugin. Install with `claude plugin install ship` or from the marketplace with `/plugin marketplace add dilhanz/ship`.

### Breaking Changes

- **Plugin distribution**: Ship is distributed as a Claude Code plugin instead of a manual installer. The old `npx github:dilhanz/ship` method is deprecated.
- **Skill names renamed**: All skills drop the `ship-` prefix. `ship-start` becomes `start`, invoked as `/ship:start`. The plugin namespace `ship:` handles disambiguation.
- **Hook files renamed**: All hook files drop the `ship-` prefix (e.g., `ship-guide.cjs` -> `guide.cjs`).
- **Removed skills**: `update` and `uninstall` skills removed — the plugin system handles both natively via `claude plugin update` and `claude plugin uninstall`.
- **Removed hooks**: `check-update` hook removed — plugin system handles update checks natively.

### Added

- `.claude-plugin/plugin.json` manifest for Claude Code plugin system
- `hooks/hooks.json` for declarative hook registration with `${CLAUDE_PLUGIN_ROOT}` paths
- `.claude-plugin/marketplace.json` for GitHub-based distribution via `/plugin marketplace add dilhanz/ship`
- `${CLAUDE_PLUGIN_DATA}` support for temp/cache file isolation (session metrics, context bridge files)

### Changed

- All 14 skill directories renamed: `ship-X` -> `X`
- All 6 hook files renamed: `ship-X.cjs` -> `X.cjs`
- Agent `skills:` frontmatter references updated to unprefixed names
- All hardcoded `.claude/` paths replaced with `${CLAUDE_PLUGIN_ROOT}/`
- Hook temp/cache paths use `${CLAUDE_PLUGIN_DATA}` with `os.tmpdir()` fallback for legacy mode
- Guide hook command references updated from `/ship-X` to `/ship:X` format
- `install.js` marked as deprecated with console warning (still functional for legacy users)
- `install.js` deregister filters tightened to path-anchored `.includes()` checks
- CLAUDE.md and README.md updated for plugin system documentation
