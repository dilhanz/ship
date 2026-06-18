# Changelog

## 3.6.0

Build context isolation — three changes that push the build orchestrator's context window back toward its floor by keeping raw file bodies out of the orchestrator and bounding verify capture.

### Changed

- **Delegated pre-build digest**: the build orchestrator now spawns the read-only `Explore` agent to produce `## Key File Context`, keeping raw file bodies out of the orchestrator window (graceful-degrades to empty context on failure).
- **Bounded trust-but-verify capture**: verify pass/fail is decided on exit code; only a 5-line tail is kept on success, full output re-pulled only on failure.
- **JSON-only builder/reviewer handoffs**: `ship-builder` and `ship-reviewer` final messages are the fenced JSON block only, with no trailing prose.

## 3.5.0

Build quality — four orchestrator-level improvements that move quality checking into the build loop instead of deferring it all to `/ship:qa` and `/ship:verify`, plus a new read-only reviewer agent.

### Added

- **Per-phase review gate**: A new `ship-reviewer` agent reviews each completed phase's `git diff` before the phase is marked done. Critical/high findings are sent back to the same builder via SendMessage for exactly one fix round and re-reviewed; medium/low findings are recorded but don't burn builder turns. All findings (fixed and unresolved) append per-phase to `.planning/features/{name}/REVIEW.md` so `/ship:qa` and `/ship:verify` can cross-check and they survive compaction. A reviewer failure (error, turn exhaustion, unparseable output) degrades gracefully — the phase proceeds with a "review skipped" concern and the build is never blocked.
- **`ship-reviewer` agent**: New read-only agent in `agents/ship-reviewer.md` that emits a `review_result` JSON block. Ship now ships 5 agents (brainstormer, builder, qa, reviewer, verifier).
- **Trust-but-verify gate**: After the builder claims COMPLETE, the build orchestrator re-runs every task's `<verify>` command before marking the phase done. A failure is sent back to the builder with the command output; a repeat failure after the fix round stops the build with a CHECKPOINT.
- **Interactive NEEDS_CONTEXT**: A NEEDS_CONTEXT result now triggers AskUserQuestion in the orchestrator, and the answer is SendMessaged back to the still-alive builder instead of dead-stopping the loop and discarding warm context. Applies in both `/ship:build` and `/ship:go` (capped at 2 rounds per phase; a third stops the build).
- **`review_result` validation**: `hooks/subagent-stop.cjs` validates the `ship-reviewer` agent's `review_result` block, with recovery-message injection on missing/invalid output and tests under `node --test`.

### Changed

- **Builder inherits the session model**: Dropped the pinned `model: sonnet` from `agents/ship-builder.md` so the builder runs on the session model instead of silently downgrading Opus or Fable sessions. Other agents (brainstormer, qa, verifier) are unchanged.
- **`/ship:go` workflow**: Removed NEEDS_CONTEXT from its stop conditions and adopted the same ask-then-resume flow as the build skill.
- **CLAUDE.md and README**: Updated for the new build flow — reviewer agent, REVIEW.md artifact, per-phase review gate, trust-but-verify, interactive NEEDS_CONTEXT, and the updated agent count.

## 3.4.0

Pipeline rigor — five interlocking changes that tighten the brainstorm → plan → build → QA → verify pipeline.

### Added

- **Adaptive NFR probe in brainstormer**: Detects project signals (`package.json`, `Dockerfile`, `.github/workflows/`, prior CONTEXTs) and asks only the non-functional requirement questions that apply — perf/scale, observability, rollout/flag/migration, security/data, error handling. Skips irrelevant NFRs (e.g., no rollout questions for a CLI tool) to avoid "N/A spam."
- **INCONCLUSIVE verify verdict**: Verifier now emits per-criterion verdicts ∈ {PASS, FAIL, INCONCLUSIVE}. Criteria with no runnable `<verify>` command that would otherwise have been judged via grep-only evidence are marked INCONCLUSIVE instead of being rubber-stamped as PASS.
- **`qa-failed` status**: New first-class status replaces the broken `plan-verified` rollback on QA failure. Distinct from `plan-verified`; signals "plan was valid, implementation was buggy, fix tasks appended." Original task completion marks are preserved; new fix tasks append to PLAN.md under `## Fix Tasks (from QA)`. Status flow is now `brainstormed → planned → plan-verified → building → built → qa-passed → done`, with `qa-failed` as a side branch from `built`.
- **`--accept-inconclusive` override for `/ship:finish`**: When VERIFY.md contains any INCONCLUSIVE verdict, `/ship:finish` refuses to proceed unless `--accept-inconclusive` is passed. The override and reason are written into VERIFY.md for audit trail.
- **`test-rigor` exemplar fixture**: Synthetic dogfood feature preserved in the repo at `.planning/features/test-rigor/` as a reference exemplar of a feature walked through the upgraded pipeline end-to-end.

### Changed

- **QA agent uses git diff as source of truth**: QA now reads `git diff $(git merge-base HEAD main)..HEAD` instead of trusting `PLAN.md`'s `<files>` list. Catches builder deviations (Rule 1) that the static plan misses. QA.md cites files from the diff.
- **QA owns the anti-pattern scan**: TODO/FIXME/HACK/XXX/placeholder/stub/not-implemented scanning moved entirely into QA. The verifier now reads `QA.md` instead of re-scanning, eliminating duplicated grep work and contradictory verdicts.
- **VERIFY.md template**: Updated for per-criterion verdicts and override recording.
- **`/ship:resume`, `/ship:status`, `/ship:go` skills**: Recognize `qa-failed` as a first-class status. Resume routes from `qa-failed` to `/ship:build` then `/ship:qa`, skipping plan-verify.
- **`/ship:help` skill**: Documents the INCONCLUSIVE concept, `--accept-inconclusive` override, and `qa-failed` status.
- **CLAUDE.md**: Status-flow section updated to include `qa-failed`.

### Compatibility

In-flight features keep their original semantics; no auto-migration. New rules apply only to features started after 3.4.0.

## 3.3.0

### Added

- **QA step**: New standalone QA step between build and verify. The `ship-qa` agent acts as an adversarial tester — auto-discovers the project's test framework, writes risk-based tests across 6 categories (happy path, boundary, negative input, error handling, concurrency, security), commits test files with `test(feature): ...` format, and produces a structured QA.md report with bug findings.
- **`/ship:qa` skill**: Orchestrates QA execution, handles pass/fail status transitions, and appends fix tasks to PLAN.md on critical/high bugs.
- **QA.md template**: Structured report format with risk assessment, test files written, bug findings table, exploratory analysis, and verdict.
- **Verifier Stage 4**: Verifier agent now processes QA findings in a new Stage 4, affecting the verification verdict. Critical/high QA bugs block a PASS verdict.
- **QA agent output validation**: `subagent-stop.cjs` hook validates `qa_result` JSON blocks from the `ship-qa` agent, with recovery message injection on missing/invalid output.
- **New `qa-passed` status**: Status flow is now `brainstormed → planned → plan-verified → building → built → qa-passed → done`. QA gates verification — users cannot skip QA and go directly to verify.

### Changed

- **Go workflow**: Runs QA after build automatically. Stops on QA failure (fix tasks written, needs rebuild).
- **Verify skill**: Now looks for features with status `qa-passed` (not `built`). Reads QA.md and passes findings to verifier agent.
- **Resume, status, help skills**: Updated to reflect the new QA step in status tables, next-step suggestions, and command listings.

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
