---
feature: "plugin-distribution"
goal: "Restructure Ship as a standard Claude Code plugin with plugin.json manifest, declarative hooks.json, renamed skills/hooks (drop ship- prefix), ${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA} paths, and GitHub marketplace distribution"
---

## Exploration Findings

**Current structure:** 16 skill directories (`skills/ship-*/SKILL.md`), 7 hook files (`hooks/ship-*.cjs`), 3 agent files (`agents/ship-*.md`), 1 workflow (`ship/workflows/go.md`), 1 template (`ship/templates/VERIFY.md`), 6 test files (`tests/ship-*.test.js`).

**Hardcoded `.claude/` paths (3 files):**
- `skills/ship-go/SKILL.md:15` — `.claude/ship/workflows/go.md`
- `skills/ship-start/SKILL.md:42` — `.claude/agents/ship-brainstormer.md`
- `agents/ship-verifier.md:177` — `.claude/ship/templates/VERIFY.md`

**Temp/cache paths in hooks:**
- `context-monitor.cjs` — `os.tmpdir()` for session lock, metrics bridge, debounce files
- `statusline.cjs` — `os.tmpdir()` for usage cache dir and context bridge; `~/.claude/cache/` for update check cache

**Command references (`/ship-X`):** Found in 11 skill files, 2 agent files, 1 workflow, 2 hook files (guide.cjs, context-monitor.cjs). All use `/ship-` prefix (slash-prefixed, safe to pattern-replace).

**Agent skill references:** `ship-builder.md` frontmatter `skills:` lists `ship-deviation-rules`, `ship-git-commits`, `ship-tdd`.

**Conventions:** kebab-case naming, 2-space indent, zero npm dependencies, `node:test` framework, hooks use try-catch with silent `process.exit(0)` on error.

## Research Notes

Domain familiar. Claude Code plugin system verified in CONTEXT.md research notes:
- Plugin manifest: `.claude-plugin/plugin.json` at repo root
- Hooks: `hooks/hooks.json` with same structure as `settings.json` hooks, using `${CLAUDE_PLUGIN_ROOT}` for script paths
- Skills auto-namespaced as `plugin-name:skill-name` (e.g., `ship:start`)
- `${CLAUDE_PLUGIN_DATA}` persists at `~/.claude/plugins/data/{id}/`
- StatusLine supported in plugins via hooks.json
- Local testing: `claude --plugin-dir ./`
- Marketplace: `.claude-plugin/marketplace.json` with GitHub source

## Decisions

- **Env var fallback in hooks:** Hooks use `process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-ship')` so they work in both plugin mode and legacy install.js mode.
- **Agent names unchanged:** Agent `name:` fields stay as `ship-builder`, `ship-verifier`, `ship-brainstormer`. Not in scope per CONTEXT.md; keeps subagent-stop hook's `agent_name` check compatible.
- **install.js path substitution:** During copy, install.js replaces `${CLAUDE_PLUGIN_ROOT}/` with `.claude/` in `.md` files so skills/agents resolve paths correctly in legacy mode.
- **hooks.json includes statusLine:** Research confirms plugins declare statusLine in hooks.json.
- **Statusline update check removed:** `getShipUpdate()` function and its rendering removed from statusline since the check-update hook is deleted.

## Must Deliver

- `.claude-plugin/plugin.json` exists with correct schema
- `hooks/hooks.json` declaratively registers all 6 remaining hooks with `${CLAUDE_PLUGIN_ROOT}` paths
- All 14 remaining skill directories renamed (`ship-X` → `X`)
- All 6 remaining hook files renamed (drop `ship-` prefix)
- `check-update` hook deleted, `update` skill deleted, `uninstall` skill deleted
- Agent frontmatter `skills:` references updated to new names
- All hardcoded `.claude/` paths replaced with `${CLAUDE_PLUGIN_ROOT}/`
- Hook temp/cache paths use `${CLAUDE_PLUGIN_DATA}` with fallback
- Command references use `/ship:X` format throughout
- `install.js` marked deprecated but still functional
- `.claude-plugin/marketplace.json` created
- All existing tests pass with updated paths

## Acceptance Coverage Map

```
Criterion: plugin.json exists with correct schema → Task 1
Criterion: hooks.json registers all remaining hooks → Task 2
Criterion: All 14 skill directories renamed → Task 5
Criterion: All 6 hook files renamed → Task 6
Criterion: check-update hook removed → Task 4
Criterion: update skill removed → Task 4
Criterion: uninstall skill removed → Task 4
Criterion: Agent skills: references updated → Task 10
Criterion: .claude/ paths replaced with ${CLAUDE_PLUGIN_ROOT}/ → Task 7
Criterion: Hook temp/cache paths use ${CLAUDE_PLUGIN_DATA} → Task 8
Criterion: ship-guide hook uses /ship:X format → Task 9
Criterion: install.js deprecated but functional → Task 11
Criterion: marketplace.json created → Task 3
Criterion: claude --plugin-dir . loads correctly → Tasks 1+2 (structural)
Criterion: All existing tests pass → Task 12
```

---

<phase id="1" name="Plugin infrastructure" status="done">

<task id="1" status="done" commit="06810b3">
  <name>Create plugin manifest</name>
  <files>.claude-plugin/plugin.json</files>
  <action>
Create `.claude-plugin/` directory and `.claude-plugin/plugin.json` with this exact content:

```json
{
  "name": "ship",
  "version": "3.0.0",
  "description": "Feature-centric development framework for Claude Code — brainstorm, plan, build, and verify with structured workflows",
  "hooks": "hooks/hooks.json"
}
```

The plugin system auto-discovers skills in `skills/*/SKILL.md` and agents in `agents/*.md` — no explicit paths needed for those.
  </action>
  <verify>node -e "const p=JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.assert(p.name==='ship'); console.assert(p.version==='3.0.0'); console.assert(p.hooks==='hooks/hooks.json'); console.log('PASS')"</verify>
</task>

<task id="2" status="done" commit="268dc26">
  <name>Create declarative hooks.json for plugin hook registration</name>
  <files>hooks/hooks.json</files>
  <action>
Create `hooks/hooks.json` with this exact content. Uses `${CLAUDE_PLUGIN_ROOT}` template variable (resolved by the plugin system at runtime) and references the NEW hook filenames (after rename in Task 6):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/guide.cjs" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|Bash|Agent",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/context-monitor.cjs" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/safety-gate.cjs" }]
      }
    ],
    "PostCompact": [
      {
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-compact.cjs" }]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.cjs" }]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/statusline.cjs"
  }
}
```

Note: `statusLine` is a top-level key alongside `hooks`, not nested inside it — matching the settings.json structure.
  </action>
  <verify>node -e "const h=JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.assert(Array.isArray(h.hooks.SessionStart)); console.assert(h.hooks.SessionStart.length===1); console.assert(Array.isArray(h.hooks.PostToolUse)); console.assert(h.hooks.PreToolUse[0].matcher==='Bash'); console.assert(h.statusLine.command.includes('statusline.cjs')); console.log('PASS')"</verify>
</task>

<task id="3" status="done" commit="3dd2d68">
  <name>Create marketplace.json for GitHub distribution</name>
  <files>.claude-plugin/marketplace.json</files>
  <action>
Create `.claude-plugin/marketplace.json` with this exact content:

```json
{
  "source": "github",
  "repository": "dilhanz/ship",
  "description": "Feature-centric development framework — brainstorm, plan, build, and verify with structured workflows",
  "tags": ["development", "workflow", "planning", "feature-management"]
}
```
  </action>
  <verify>node -e "const m=JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.assert(m.source==='github'); console.assert(m.repository==='dilhanz/ship'); console.log('PASS')"</verify>
</task>

</phase>

<phase id="2" name="File removals and renames" status="done">

<task id="4" status="done" commit="0f3bcd0">
  <name>Delete obsolete hook, skills, and test file</name>
  <files>hooks/ship-check-update.cjs, skills/ship-update/SKILL.md, skills/ship-uninstall/SKILL.md, tests/ship-check-update.test.js</files>
  <action>
Remove the following files/directories using `git rm`:

```bash
git rm hooks/ship-check-update.cjs
git rm -r skills/ship-update
git rm -r skills/ship-uninstall
git rm tests/ship-check-update.test.js
```

These are replaced by the plugin system's native update/uninstall capabilities.
  </action>
  <verify>test ! -f hooks/ship-check-update.cjs && test ! -d skills/ship-update && test ! -d skills/ship-uninstall && test ! -f tests/ship-check-update.test.js && echo "PASS"</verify>
</task>

<task id="5" status="done" commit="9734fff">
  <name>Rename 14 skill directories and update name frontmatter</name>
  <files>skills/ship-start, skills/ship-plan, skills/ship-plan-verify, skills/ship-build, skills/ship-verify, skills/ship-go, skills/ship-status, skills/ship-resume, skills/ship-help, skills/ship-design, skills/ship-deviation-rules, skills/ship-git-commits, skills/ship-tdd, skills/ship-finish</files>
  <action>
**Step 1 — Rename directories** using `git mv`:

```bash
git mv skills/ship-start skills/start
git mv skills/ship-plan skills/plan
git mv skills/ship-plan-verify skills/plan-verify
git mv skills/ship-build skills/build
git mv skills/ship-verify skills/verify
git mv skills/ship-go skills/go
git mv skills/ship-status skills/status
git mv skills/ship-resume skills/resume
git mv skills/ship-help skills/help
git mv skills/ship-design skills/design
git mv skills/ship-deviation-rules skills/deviation-rules
git mv skills/ship-git-commits skills/git-commits
git mv skills/ship-tdd skills/tdd
git mv skills/ship-finish skills/finish
```

**Step 2 — Update `name:` frontmatter** in each SKILL.md. Change the `name:` field to drop the `ship-` prefix:

| File | Old name | New name |
|------|----------|----------|
| `skills/start/SKILL.md` | `name: ship-start` | `name: start` |
| `skills/plan/SKILL.md` | `name: ship-plan` | `name: plan` |
| `skills/plan-verify/SKILL.md` | `name: ship-plan-verify` | `name: plan-verify` |
| `skills/build/SKILL.md` | `name: ship-build` | `name: build` |
| `skills/verify/SKILL.md` | `name: ship-verify` | `name: verify` |
| `skills/go/SKILL.md` | `name: ship-go` | `name: go` |
| `skills/status/SKILL.md` | `name: ship-status` | `name: status` |
| `skills/resume/SKILL.md` | `name: ship-resume` | `name: resume` |
| `skills/help/SKILL.md` | `name: ship-help` | `name: help` |
| `skills/design/SKILL.md` | `name: ship-design` | `name: design` |
| `skills/deviation-rules/SKILL.md` | `name: ship-deviation-rules` | `name: deviation-rules` |
| `skills/git-commits/SKILL.md` | `name: ship-git-commits` | `name: git-commits` |
| `skills/tdd/SKILL.md` | `name: ship-tdd` | `name: tdd` |
| `skills/finish/SKILL.md` | `name: ship-finish` | `name: finish` |

Only change the `name:` frontmatter field. Do not change `description:` or body text (those are handled in later tasks).
  </action>
  <verify>test -f skills/start/SKILL.md && test -f skills/plan/SKILL.md && test -f skills/finish/SKILL.md && test -f skills/tdd/SKILL.md && ! ls -d skills/ship-* 2>/dev/null && grep -q '^name: start$' skills/start/SKILL.md && grep -q '^name: build$' skills/build/SKILL.md && grep -q '^name: finish$' skills/finish/SKILL.md && echo "PASS"</verify>
</task>

<task id="6" status="done" commit="c13dcec">
  <name>Rename 6 hook files</name>
  <files>hooks/ship-guide.cjs, hooks/ship-context-monitor.cjs, hooks/ship-safety-gate.cjs, hooks/ship-post-compact.cjs, hooks/ship-subagent-stop.cjs, hooks/ship-statusline.cjs</files>
  <action>
Rename all 6 remaining hook files using `git mv` to drop the `ship-` prefix:

```bash
git mv hooks/ship-guide.cjs hooks/guide.cjs
git mv hooks/ship-context-monitor.cjs hooks/context-monitor.cjs
git mv hooks/ship-safety-gate.cjs hooks/safety-gate.cjs
git mv hooks/ship-post-compact.cjs hooks/post-compact.cjs
git mv hooks/ship-subagent-stop.cjs hooks/subagent-stop.cjs
git mv hooks/ship-statusline.cjs hooks/statusline.cjs
```
  </action>
  <verify>test -f hooks/guide.cjs && test -f hooks/context-monitor.cjs && test -f hooks/safety-gate.cjs && test -f hooks/post-compact.cjs && test -f hooks/subagent-stop.cjs && test -f hooks/statusline.cjs && ! ls hooks/ship-*.cjs 2>/dev/null && echo "PASS"</verify>
</task>

</phase>

<phase id="3" name="Reference and path updates" status="done">

<task id="7" status="done" commit="762aeb9">
  <name>Replace .claude/ paths with ${CLAUDE_PLUGIN_ROOT}/ in skills and agents</name>
  <files>skills/go/SKILL.md, skills/start/SKILL.md, agents/ship-verifier.md</files>
  <action>
Update the 3 files that contain hardcoded `.claude/` paths:

**skills/go/SKILL.md** (line 15):
- Old: `Read \`.claude/ship/workflows/go.md\``
- New: `Read \`${CLAUDE_PLUGIN_ROOT}/ship/workflows/go.md\``

**skills/start/SKILL.md** (line 42):
- Old: `Read \`.claude/agents/ship-brainstormer.md\``
- New: `Read \`${CLAUDE_PLUGIN_ROOT}/agents/ship-brainstormer.md\``

**agents/ship-verifier.md** (line 177):
- Old: `Read the template from \`.claude/ship/templates/VERIFY.md\``
- New: `Read the template from \`${CLAUDE_PLUGIN_ROOT}/ship/templates/VERIFY.md\``

Only change these 3 specific occurrences. Do not change `.planning/features/` paths (those are project-local, not plugin-relative).
  </action>
  <verify>grep -q 'CLAUDE_PLUGIN_ROOT' skills/go/SKILL.md && grep -q 'CLAUDE_PLUGIN_ROOT' skills/start/SKILL.md && grep -q 'CLAUDE_PLUGIN_ROOT' agents/ship-verifier.md && ! grep '\.claude/' skills/go/SKILL.md skills/start/SKILL.md agents/ship-verifier.md | grep -v '.planning' && echo "PASS"</verify>
</task>

<task id="8" status="done" commit="fae5a6b">
  <name>Update hook temp/cache paths to use CLAUDE_PLUGIN_DATA with fallback</name>
  <files>hooks/context-monitor.cjs, hooks/statusline.cjs</files>
  <action>
**hooks/context-monitor.cjs:**

Add a `dataDir` constant near the top (after the `require` statements, before the threshold constants):

```js
const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-ship');
```

Add directory creation at the start of the main logic (right after parsing `sessionId`):

```js
try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
```

Replace ALL occurrences of `tmpDir` with `dataDir`:
- `const lockPath = path.join(dataDir, 'claude-ship-session.lock');`
- `const lockWarnPath = path.join(dataDir, \`claude-ctx-\${sessionId}-lock-warned.json\`);`
- `const metricsPath = path.join(dataDir, \`claude-ctx-\${sessionId}.json\`);`
- `const warnPath = path.join(dataDir, \`claude-ctx-\${sessionId}-warned.json\`);`

Remove the existing `const tmpDir = os.tmpdir();` line.

**hooks/statusline.cjs:**

1. Replace the cache directory constants (lines 28-29):
   - Old: `const CACHE_DIR = path.join(os.tmpdir(), 'claude');`
   - New: `const CACHE_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-ship');`
   - `CACHE_FILE` stays the same (derived from `CACHE_DIR`).

2. Update the context bridge path in `writeContextBridge()` (line 301):
   - Old: `const bridgePath = path.join(os.tmpdir(), \`claude-ctx-\${session}.json\`);`
   - New: `const bridgePath = path.join(CACHE_DIR, \`claude-ctx-\${session}.json\`);`
   - Add `try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}` before the bridgePath line if not already ensured.

3. Remove the `getShipUpdate()` function entirely (lines 287-294). It reads `~/.claude/cache/ship-update-check.json` which no longer exists since the check-update hook is deleted.

4. Remove the `shipUpdate` variable assignment and rendering:
   - Remove: `const shipUpdate = getShipUpdate();` (line 347)
   - Remove: `if (shipUpdate) parts.push(shipUpdate);` (line 359)

IMPORTANT: Both hooks must use the SAME `dataDir`/`CACHE_DIR` base path so the context bridge file written by statusline can be read by context-monitor. The fallback path must be identical: `path.join(os.tmpdir(), 'claude-ship')`.
  </action>
  <verify>grep -q 'CLAUDE_PLUGIN_DATA' hooks/context-monitor.cjs && grep -q 'CLAUDE_PLUGIN_DATA' hooks/statusline.cjs && ! grep -q 'getShipUpdate' hooks/statusline.cjs && ! grep -q 'shipUpdate' hooks/statusline.cjs && echo "PASS"</verify>
</task>

<task id="9" status="done" commit="24f3243">
  <name>Update command references from /ship-X to /ship:X format</name>
  <files>skills/plan-verify/SKILL.md, skills/help/SKILL.md, skills/start/SKILL.md, skills/finish/SKILL.md, skills/plan/SKILL.md, skills/status/SKILL.md, skills/build/SKILL.md, skills/resume/SKILL.md, skills/design/SKILL.md, skills/verify/SKILL.md, agents/ship-brainstormer.md, agents/ship-verifier.md, ship/workflows/go.md, hooks/guide.cjs, hooks/context-monitor.cjs</files>
  <action>
In every file listed above, replace the pattern `/ship-` with `/ship:` for ALL command references. This is a literal string replacement of `/ship-` → `/ship:` (only where preceded by `/`, which targets command invocations — not bare `ship-` in agent names or other contexts).

**Specific changes by file:**

Skills (use new paths after rename):
- `skills/plan-verify/SKILL.md`: `/ship-build` → `/ship:build`, `/ship-plan` → `/ship:plan`
- `skills/help/SKILL.md`: ALL command references (13 occurrences): `/ship-start` → `/ship:start`, `/ship-design` → `/ship:design`, `/ship-plan` → `/ship:plan`, `/ship-plan-verify` → `/ship:plan-verify`, `/ship-build` → `/ship:build`, `/ship-verify` → `/ship:verify`, `/ship-go` → `/ship:go`, `/ship-finish` → `/ship:finish`, `/ship-status` → `/ship:status`, `/ship-resume` → `/ship:resume`, `/ship-update` → REMOVE (skill deleted), `/ship-uninstall` → REMOVE (skill deleted), `/ship-help` → `/ship:help`
- `skills/start/SKILL.md`: `/ship-resume` → `/ship:resume`
- `skills/finish/SKILL.md`: `/ship-finish` → `/ship:finish`
- `skills/plan/SKILL.md`: `/ship-plan-verify` → `/ship:plan-verify`
- `skills/status/SKILL.md`: `/ship-start` → `/ship:start`, `/ship-plan` → `/ship:plan`, `/ship-plan-verify` → `/ship:plan-verify`, `/ship-build` → `/ship:build`, `/ship-resume` → `/ship:resume`, `/ship-verify` → `/ship:verify`, `/ship-start` → `/ship:start`
- `skills/build/SKILL.md`: `/ship-build` → `/ship:build`, `/ship-verify` → `/ship:verify`
- `skills/resume/SKILL.md`: `/ship-start` → `/ship:start`, `/ship-plan` → `/ship:plan`, `/ship-plan-verify` → `/ship:plan-verify`, `/ship-build` → `/ship:build`, `/ship-verify` → `/ship:verify`
- `skills/design/SKILL.md`: `/ship-plan` → `/ship:plan`
- `skills/verify/SKILL.md`: `/ship-build` → `/ship:build`

Agents:
- `agents/ship-brainstormer.md`: description field `/ship-start` → `/ship:start`, body `/ship-plan` → `/ship:plan`
- `agents/ship-verifier.md`: `/ship-build` → `/ship:build`

Workflow:
- `ship/workflows/go.md`: ALL command references: `/ship-start`, `/ship-plan`, `/ship-plan-verify`, `/ship-build`, `/ship-verify`, `/ship-finish`, `/ship-go` — all change `-` to `:` after `/ship`

Hooks (JavaScript strings):
- `hooks/guide.cjs`: `/ship-start` → `/ship:start`, `/ship-resume` → `/ship:resume`, `/ship-status` → `/ship:status`, `/ship-help` → `/ship:help`
- `hooks/context-monitor.cjs`: `/ship-resume` → `/ship:resume`

**Special case for skills/help/SKILL.md:** Remove the lines for `/ship-update` and `/ship-uninstall` commands entirely since those skills are deleted. The help text should list only the remaining commands.
  </action>
  <verify>! grep -rn '/ship-[a-z]' skills/ agents/ ship/workflows/ hooks/guide.cjs hooks/context-monitor.cjs 2>/dev/null | head -1 && echo "PASS"</verify>
</task>

<task id="10" status="done" commit="af95e3e">
  <name>Update agent frontmatter skills references to new names</name>
  <files>agents/ship-builder.md</files>
  <action>
In `agents/ship-builder.md`, update the `skills:` frontmatter section (lines 9-11):

Old:
```yaml
skills:
  - ship-deviation-rules
  - ship-git-commits
  - ship-tdd
```

New:
```yaml
skills:
  - deviation-rules
  - git-commits
  - tdd
```

These match the renamed skill directory names from Task 5.
  </action>
  <verify>grep -A3 '^skills:' agents/ship-builder.md | grep -q 'deviation-rules' && grep -A3 '^skills:' agents/ship-builder.md | grep -q 'git-commits' && grep -A3 '^skills:' agents/ship-builder.md | grep -q 'tdd' && ! grep -A3 '^skills:' agents/ship-builder.md | grep 'ship-' && echo "PASS"</verify>
</task>

</phase>

<phase id="4" name="Integration, tests, and docs" status="building">

<task id="11" status="pending">
  <name>Deprecate install.js and update internal references to new names</name>
  <files>install.js</files>
  <action>
**1. Add deprecation banner** — insert at line 3 (after the opening comment block):

```js
/**
 * DEPRECATED: This installer is for legacy use only.
 * The recommended installation method is the Claude Code plugin system:
 *   claude plugin install ship
 * Or from marketplace:
 *   /plugin marketplace add dilhanz/ship
 *
 * This file will be removed in a future major version.
 */
```

**2. Add runtime deprecation warning** — at the start of the `install()` function, before the "Installing Ship..." log:

```js
console.warn('\n⚠️  DEPRECATED: install.js is the legacy installation method.');
console.warn('   Recommended: claude plugin install ship');
console.warn('   See README.md for plugin installation instructions.\n');
```

**3. Update SKILL_DIRS** array — drop `ship-` prefix, remove `ship-update` and `ship-uninstall`:

```js
const SKILL_DIRS = [
  'start',
  'plan',
  'plan-verify',
  'build',
  'verify',
  'go',
  'status',
  'resume',
  'help',
  'design',
  'deviation-rules',
  'git-commits',
  'tdd',
  'finish',
];
```

**4. Update HOOK_FILES** array — drop `ship-` prefix, remove `ship-check-update.cjs`:

```js
const HOOK_FILES = [
  'context-monitor.cjs',
  'guide.cjs',
  'post-compact.cjs',
  'subagent-stop.cjs',
  'safety-gate.cjs',
  'statusline.cjs',
];
```

**5. Add old names to LEGACY_FILES** — append to the LEGACY_FILES array so re-running install cleans up old ship-prefixed files:

```js
// Old ship-prefixed skills (renamed to drop prefix in v3 plugin migration)
path.join('skills', 'ship-start'),
path.join('skills', 'ship-plan'),
path.join('skills', 'ship-plan-verify'),
path.join('skills', 'ship-build'),
path.join('skills', 'ship-verify'),
path.join('skills', 'ship-go'),
path.join('skills', 'ship-status'),
path.join('skills', 'ship-resume'),
path.join('skills', 'ship-help'),
path.join('skills', 'ship-update'),
path.join('skills', 'ship-uninstall'),
path.join('skills', 'ship-design'),
path.join('skills', 'ship-deviation-rules'),
path.join('skills', 'ship-git-commits'),
path.join('skills', 'ship-tdd'),
path.join('skills', 'ship-finish'),
// Old ship-prefixed hooks
path.join('hooks', 'ship-check-update.cjs'),
path.join('hooks', 'ship-guide.cjs'),
path.join('hooks', 'ship-context-monitor.cjs'),
path.join('hooks', 'ship-safety-gate.cjs'),
path.join('hooks', 'ship-post-compact.cjs'),
path.join('hooks', 'ship-subagent-stop.cjs'),
path.join('hooks', 'ship-statusline.cjs'),
```

Note: LEGACY_FILES removal uses `fs.rmSync(fullPath)` which works for files. For skill directories (which are directories, not files), the cleanup loop needs to use `fs.rmSync(fullPath, { recursive: true, force: true })` instead of just `fs.rmSync(fullPath)`. Update the cleanup loop to handle both files and directories.

**6. Update registerSettings** — use new hook filenames and remove check-update registration:

- Change `ship-check-update.cjs` → remove entirely (delete the `checkUpdateCmd` variable and the SessionStart block that registers it)
- Change `ship-guide.cjs` → `guide.cjs` in the `guideCmd` variable
- Change `ship-context-monitor.cjs` → `context-monitor.cjs` in the `contextMonitorCmd` variable
- Change `ship-safety-gate.cjs` → `safety-gate.cjs` in the `safetyGateCmd` variable
- Change `ship-post-compact.cjs` → `post-compact.cjs` in the `postCompactCmd` variable
- Change `ship-subagent-stop.cjs` → `subagent-stop.cjs` in the `subagentStopCmd` variable
- Change `ship-statusline.cjs` → `statusline.cjs` in the `statuslineCmd` variable
- Update the SessionStart filter to check for both old (`ship-check-update`, `ship-guide`) and new (`guide`) names to properly clean up

**7. Update deregisterSettings** — update filter strings to match new filenames:

- SessionStart filter: check for both `ship-guide` and `guide` (handles both old and new installs)
- PostToolUse filter: check for both `ship-context-monitor` and `context-monitor`
- PreToolUse filter: check for both `ship-safety-gate` and `safety-gate`
- PostCompact filter: check for both `ship-post-compact` and `post-compact`
- SubagentStop filter: check for both `ship-subagent-stop` and `subagent-stop`
- statusLine filter: check for both `ship-statusline` and `statusline`

**8. Add ${CLAUDE_PLUGIN_ROOT} replacement** — in the `copyDir` function, when copying `.md` files, replace `${CLAUDE_PLUGIN_ROOT}/` with `.claude/` so paths resolve in legacy mode:

After `fs.copyFileSync(srcPath, destPath);`, add:
```js
if (entry.name.endsWith('.md')) {
  let content = fs.readFileSync(destPath, 'utf8');
  if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
    content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\//g, '.claude/');
    fs.writeFileSync(destPath, content);
  }
}
```

**9. Update "Get started" message** — change the final log line from `/ship-start` to `/ship:start`:
```js
console.log('  /ship:start "your feature idea"');
```
  </action>
  <verify>node -e "const s=require('fs').readFileSync('install.js','utf8'); console.assert(s.includes('DEPRECATED')); console.assert(s.includes('guide.cjs')); console.assert(!s.includes(\"'ship-check-update\")); console.assert(s.includes('CLAUDE_PLUGIN_ROOT')); console.assert(s.includes('/ship:start')); console.log('PASS')"</verify>
</task>

<task id="12" status="pending">
  <name>Rename test files and update hook path references</name>
  <files>tests/ship-safety-gate.test.js, tests/ship-context-monitor.test.js, tests/ship-statusline.test.js, tests/ship-post-compact.test.js, tests/ship-subagent-stop.test.js</files>
  <action>
**Step 1 — Rename test files** using `git mv`:

```bash
git mv tests/ship-safety-gate.test.js tests/safety-gate.test.js
git mv tests/ship-context-monitor.test.js tests/context-monitor.test.js
git mv tests/ship-statusline.test.js tests/statusline.test.js
git mv tests/ship-post-compact.test.js tests/post-compact.test.js
git mv tests/ship-subagent-stop.test.js tests/subagent-stop.test.js
```

**Step 2 — Update HOOK_PATH** in each test file. Each test has a line like:
```js
const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'ship-X.cjs');
```
Change to reference the new hook filename:

| Test file | Old HOOK_PATH | New HOOK_PATH |
|-----------|--------------|---------------|
| `tests/safety-gate.test.js` | `'ship-safety-gate.cjs'` | `'safety-gate.cjs'` |
| `tests/context-monitor.test.js` | `'ship-context-monitor.cjs'` | `'context-monitor.cjs'` |
| `tests/statusline.test.js` | `'ship-statusline.cjs'` | `'statusline.cjs'` |
| `tests/post-compact.test.js` | `'ship-post-compact.cjs'` | `'post-compact.cjs'` |
| `tests/subagent-stop.test.js` | `'ship-subagent-stop.cjs'` | `'subagent-stop.cjs'` |

**Step 3 — Update describe() strings** in each test. Change `describe('ship-X hook'` to `describe('X hook'`:

| Test file | Old describe | New describe |
|-----------|-------------|-------------|
| `tests/safety-gate.test.js` | `'ship-safety-gate hook'` | `'safety-gate hook'` |
| `tests/context-monitor.test.js` | `'ship-context-monitor hook'` | `'context-monitor hook'` |
| `tests/statusline.test.js` | `'ship-statusline hook'` | `'statusline hook'` |
| `tests/post-compact.test.js` | `'ship-post-compact hook'` | `'post-compact hook'` |
| `tests/subagent-stop.test.js` | `'ship-subagent-stop hook'` | `'subagent-stop hook'` |

**Step 4 — Update test assertions** that reference `/ship-` commands in hook output. For example, if `context-monitor.test.js` tests output strings containing `/ship-resume`, update to `/ship:resume`. Check each test file for string assertions that contain `/ship-` patterns and update them.

**Step 5 — For statusline test:** The test may reference `getShipUpdate` or the update check. If any test cases exercise the ship update notification, remove those test cases since that feature was removed in Task 8.

**Step 6 — Run all tests** to verify everything passes.
  </action>
  <verify>node --test tests/</verify>
</task>

<task id="13" status="done" commit="da5dcb4">
  <name>Update CLAUDE.md and README.md documentation</name>
  <files>CLAUDE.md, README.md</files>
  <action>
**CLAUDE.md updates:**

1. Update the Architecture section — file tree:
   - `skills/ship-*/SKILL.md   16 skills` → `skills/*/SKILL.md   14 skills` (update count)
   - `skills/ship-deviation-rules/` → `skills/deviation-rules/`
   - `skills/ship-git-commits/` → `skills/git-commits/`
   - `skills/ship-tdd/` → `skills/tdd/`

2. Update Supporting Files section — hooks list:
   - `ship-guide.cjs` → `guide.cjs` (for all 6 hooks, update names)
   - Remove `ship-check-update.cjs` line entirely
   - Update count from 7 to 6: `hooks/                 6 Node.js hooks`
   - Add `hooks/hooks.json` to the list

3. Update Flow section — all `/ship-X` commands → `/ship:X`:
   ```
   /ship:start       "idea" → brainstorm → CONTEXT.md
   /ship:plan               → explore code → PLAN.md
   /ship:plan-verify        → verify plan → PLAN.md (review appended)
   /ship:build              → implement → tasks marked done
   /ship:verify             → check criteria → VERIFY.md
   /ship:finish             → complete feature
   /ship:go                 → auto-run remaining steps
   ```

4. Update Installation section:
   - Add note: "Primary install: `claude plugin install ship`. Legacy: `npx github:dilhanz/ship` (deprecated)."
   - Update `install.js` description to mention it's deprecated

5. Update Commit Conventions example: `/ship-start` → `/ship:start` if mentioned

6. Update Key Concepts section:
   - Update any `/ship-` command references to `/ship:`
   - Update hook filenames in auto-discovery bullet

7. Add a Plugin section explaining the plugin structure:
   ```
   ### Plugin Structure

   Ship is distributed as a Claude Code plugin. The `.claude-plugin/plugin.json` manifest and `hooks/hooks.json` handle registration. Skills are auto-namespaced as `ship:skill-name`.
   ```

**README.md updates:**

1. Update Install section — add plugin as primary method:
   ```markdown
   ## Install

   ```bash
   claude plugin install ship
   ```

   Or from the marketplace:
   ```
   /plugin marketplace add dilhanz/ship
   ```

   ### Legacy Installation

   ```bash
   cd your-project
   npx github:dilhanz/ship
   ```

   > **Note:** The npx installer is deprecated. Use the plugin system for automatic updates and clean uninstall.
   ```

2. Update Usage section — all `/ship-X` → `/ship:X`

3. Update Utility Commands — remove `/ship-update` and `/ship-uninstall`, update remaining to `/ship:X`

4. Update Hooks table:
   - Remove `ship-check-update` row
   - Rename all hooks (drop `ship-` prefix)
   - Update count: "6 hooks" instead of "7 hooks"
   - Change "registered in `.claude/settings.json`" to "declared in `hooks/hooks.json`"

5. Update Core Principles — `/ship-go` → `/ship:go` in phased builds section

6. Remove the Update/Uninstall bash commands (plugin handles this natively)
  </action>
  <verify>grep -q '/ship:start' CLAUDE.md && grep -q 'plugin' README.md && grep -q 'claude plugin install' README.md && ! grep -q 'ship-check-update' CLAUDE.md && ! grep -q '/ship-update' README.md && echo "PASS"</verify>
</task>

</phase>

## Risk Notes

- **Task 8 — Context bridge path sync:** Both `statusline.cjs` and `context-monitor.cjs` must use the same fallback path (`path.join(os.tmpdir(), 'claude-ship')`) for the context bridge file. If they diverge, the context monitor won't find the metrics file and warnings will silently stop working. Verify by checking the fallback string is identical in both files.
- **Task 9 — Over-replacement of /ship-:** The replacement pattern `/ship-` → `/ship:` must only target command references (preceded by `/`). Agent names like `ship-builder` in frontmatter or the subagent-stop hook must NOT be changed. The leading `/` in the pattern prevents this, but verify no agent names were corrupted.
- **Task 11 — install.js LEGACY_FILES cleanup:** The existing cleanup loop uses `fs.rmSync(fullPath)` which doesn't work for directories. The loop must use `{ recursive: true, force: true }` for the new legacy skill directory entries. If missed, re-running install.js will error on the old skill directories.
- **Task 12 — Test failures from hook behavior changes:** The statusline test may have assertions about the update notification that was removed in Task 8. If tests fail, remove/update those specific test cases rather than reverting the hook change.
- **Plugin schema uncertainty:** The exact `plugin.json` and `hooks.json` schemas are based on CONTEXT.md research notes. If `claude --plugin-dir .` fails to load, check the Claude Code plugin documentation for the current schema and adjust.

## Plan Review

**Status:** APPROVED
**Reviewed against:** 16 skill SKILL.md files, 7 hook .cjs files, 3 agent .md files, 6 test files, install.js (registerSettings/deregisterSettings/copyDir/removeFile/LEGACY_FILES/SKILL_DIRS/HOOK_FILES), ship/workflows/go.md, CLAUDE.md, README.md

### Findings

**WARNING — install.js LEGACY_FILES cleanup loop uses raw `fs.rmSync`:** The plan correctly identifies this (Risk Notes + Task 11 note), but it bears emphasis: line 350 of install.js uses `fs.rmSync(fullPath)` without `{ recursive: true }`, while the `removeFile()` helper at line 320 already has it. The builder should either refactor the loop to use `removeFile()` or add the option directly. The plan already calls this out — just confirming the codebase matches the claim.

**WARNING — Double hook registration in legacy+plugin coexistence:** If a user installs the plugin AND runs install.js, hooks get registered in both `hooks/hooks.json` (plugin) and `.claude/settings.json` (legacy), potentially causing double execution. The deprecation warning mitigates this but no programmatic guard exists. Low risk since install.js is deprecated, but worth noting.

**SUGGESTION — CONTEXT.md acceptance criteria count discrepancies:** Line 34 says "All 16 skill directories renamed" but lists 14 (correct after 2 deletions). Line 35 says "All 5 remaining hook files" but lists 6. The PLAN.md correctly handles 14 skills and 6 hooks — these are cosmetic issues in CONTEXT.md only, not blocking.
