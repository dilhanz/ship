# Changelog

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
