# Changelog

## 5.0.0

Doctrine release — the ruleset moves from prescriptive micromanagement to outcome-gated guidance: contract the artifacts, gate the outcomes, free the process. Machine contracts (task XML, result JSON shapes, go.workflow.js schemas, status state machine) are unchanged.

### Changed

- **Outcome gates replace question/task quotas**: the brainstormer writes CONTEXT.md only when the problem, scope boundary, and 3+ testable acceptance criteria can be stated without guessing and the user has confirmed — question count is judgment ("5-10+ questions" and the HARD-GATE minimums are gone). The plan's task-count floor is removed (the ~12-task ceiling stays as a split trigger).
- **Exploration scales to uncertainty**: the plan skill's mandatory 3-agent exploration fan-out is removed — it reuses CONTEXT.md Codebase Notes when present, explores inline for small or familiar surfaces, and fans out Explore agents only for large or unfamiliar ones.
- **Contracts-vs-internals task altitude**: plan `<action>`s specify observable, load-bearing contracts (schemas, endpoint shapes, error behavior at boundaries, library choices, integration points) and leave internals (function names, decomposition, imports) to the builder. New litmus: would two reasonable implementations differ in a way the user cares about?
- **Builder internals latitude with surface-don't-take**: the builder follows planned contracts exactly, owns unspecified internals, and surfaces materially better approaches as deviations/concerns or NEEDS_CONTEXT — never silently substituting its own approach for a planned contract.
- **Plan-verify runs as a fresh-context subagent**: the skill orchestrates inline but delegates the review to a general-purpose subagent that shares none of the planner's conversation. Grounding checks (paths, references, depends IDs, packages, verify-command feasibility) are retained; format-policing checks are gone; the plan's self-checks 6.2–6.7 move to the reviewer as judgment (the acceptance-coverage map and adversarial review stay in plan).
- **Design proposes feature-specific approaches**: the three canned philosophy agents (minimal changes / clean architecture / pragmatic balance) are replaced by 2-3 genuinely distinct approaches derived from the feature's actual decision axes.
- **Build skill deduplicated**: the orchestrator's Trust-But-Verify re-run is removed (the reviewer already re-runs every phase verify command — verifies run 2×, matching the go-workflow path), and the pre-build Explore digest is now conditional on phase size instead of mandatory.

### Removed

- **`INFRA_DETECTED` and the NFR routing table**: replaced by two sentences of judgment guidance — probe the NFR dimensions the codebase makes relevant, skip the ones that plainly don't apply.
- **Brainstormer `model: opus` pin**: the agent inherits the session model, consistent with the builder/reviewer/verifier.

## 4.1.0

Minor release — reviewer and verifier follow the session model, plus reliability fixes at the seams between the agents and the two orchestration paths.

### Changed

- **Reviewer and verifier inherit the parent model**: `ship-reviewer` and `ship-verifier` no longer pin `model: sonnet` in frontmatter — like the builder, they inherit the parent session model. The brainstormer keeps its explicit `opus` pin.

### Fixed

- **go workflow re-review prompt embeds the findings**: each workflow `agent()` call spawns a fresh agent, so the re-reviewer had no memory of the round-1 critical/high findings it was asked to confirm as resolved. The re-review prompt now lists the findings and the fix commits explicitly.
- **`VERIFY_SCHEMA` accepts `criteria_verdicts`**: the verifier is instructed to report per-criterion verdicts, but the workflow schema's `additionalProperties: false` rejected the field, forcing a validation retry that silently dropped the evidence. The schema now includes it.
- **Verifier diff-base handles an empty diff**: `git merge-base HEAD main` is HEAD itself when the feature was built directly on main, leaving Stage 2's changed-file list empty. The fallback (feature commits via `git log --grep`, or PLAN.md `<files>`) now also fires on an empty diff, not just a git error.
- **Reviewer Inputs documents all invocation forms**: diff range (manual build), commit list (go workflow), or neither (working tree vs merge-base) — previously only the diff-range form was described.
- **go skill persists review findings to REVIEW.md**: findings from `/ship:go` phases only appeared in the chat report; the reconcile step now appends them to REVIEW.md in the same format as the manual build path.
- **Verifier verdict asymmetry made explicit**: grep evidence can prove absence (→ FAIL) but never correctness (existence alone is at most INCONCLUSIVE); the FAIL definition previously required an executed verify command, contradicting the wiring rule.

## 4.0.2

Patch release — `/ship:go` survives flaky agent crashes instead of dying after the work is already committed.

### Fixed

- **go workflow retries agent crashes, then degrades gracefully**: the Workflow harness's final-JSON schema wrapper (`StructuredOutput`) has flaked and thrown even when the agent's underlying work was already committed and green, killing the whole run and losing only orchestration state. Every `agent()` call in `ship/workflows/go.workflow.js` now goes through a `safeAgent` wrapper — one retry, then degrade to a `null` result that the existing null-paths handle (build → `stoppedAt: NO_RESULT`, review → `SKIPPED`, verify → null verdict). Retrying is safe because PLAN.md tracks task status and commits are atomic, so a retried builder sees done tasks and returns quickly.
- **Unconfirmed re-reviews surface as unresolved**: if critical/high findings triggered a fix round but the re-review produced no result, the findings are now reported as `unresolved` instead of the phase silently reading as clean.
- **go skill handles a null verdict**: when all phases build but the verifier produces no result, the skill sets `status: built`, confirms the build commits landed, and directs the user to manual `/ship:verify` (previously this case had no defined handling).
- **Version test derives from `ship/VERSION`**: `tests/rearchitecture-v4.test.js` asserted a hardcoded `4.0.0` and broke on every release; it now reads the expected version from `ship/VERSION` so the three version files just have to agree.

## 4.0.1

Patch release — fix `/ship:go` failing on a clean run.

### Fixed

- **`/ship:go` workflow tolerates string-encoded `args`**: the Workflow runtime can deliver the `args` payload to `ship/workflows/go.workflow.js` as a JSON-encoded string (sometimes double-encoded) instead of the parsed object the docs promise, so `args.feature` read `undefined` and the workflow threw `go.workflow: args.feature is required` immediately. The workflow now unwraps up to a couple of layers of string encoding before reading `feature`/`phases`/`keyFileContext`, and still fails with the clear required-field error on genuinely malformed input. The fix is pure JavaScript (no shell, paths, or platform calls), so it runs identically on macOS and Windows.

## 4.0.0

Re-architecture for modern Claude Code capabilities — cut token waste in `/ship:go` by moving orchestration onto the Workflow engine, collapsing the verification stack, and stripping defensive prose the agents no longer need. **Breaking:** `/ship:qa` is removed and the status flow changes.

### Changed

- **`/ship:go` runs on the Workflow engine**: the repetitive, non-interactive build→verify spine now executes in `ship/workflows/go.workflow.js` via schema-validated `agent()` calls, so per-phase builder/reviewer/verifier output stays out of the main conversation context instead of being collected into it. The interactive steps (plan, plan-verify, plan-approval gate, finish) still run inline in the `go` skill. The old `ship/workflows/go.md` markdown state-machine is removed.
- **Verification collapsed from 4 layers to 2**: a pre-build plan check (`/ship:plan-verify`) and a single post-build gate (`/ship:verify`). The verifier now does its own adversarial testing and anti-pattern scan instead of re-synthesizing pre-gathered `/review` + QA findings, eliminating the findings-shuttling that double-handled text through the main window.
- **Reviewer absorbs trust-but-verify**: `ship-reviewer` now re-runs each phase's `<verify>` command before reviewing the diff (a failing verify is a critical finding), so the workflow doesn't need a separate orchestrator-level re-run.
- **Agents slimmed ~50%**: removed the rationalization tables, forbidden-responses sections, and analysis-paralysis guards that were scaffolding for weaker models. Net ~960 → ~400 lines across the agents, reducing input tokens on every agent invocation.
- **Structured output replaces text-JSON parsing**: the go workflow validates agent output via JSON Schema (`StructuredOutput`) rather than parsing fenced `build_result`/`review_result`/`verify_result` blocks. The agents still emit those blocks for the manual skill paths.
- **`VERIFY.md` template collapsed from 4 stages to 2**: a Stage 1 acceptance-criteria table and a Stage 2 "Bug Hunt & Quality" section (adversarial tests, bug findings, anti-pattern scan, quality notes). The separate Stage 3 (`/review`) and Stage 4 (QA) sections are gone.

### Removed

- **`/ship:qa` skill and `ship-qa` agent**: adversarial testing and the anti-pattern scan are now part of `ship-verifier` (single post-build gate). `QA.md` and its template are gone.
- **`hooks/subagent-stop.cjs`**: schema validation replaces text-JSON format validation; the manual build skill retains its own auto-continue recovery. Ship now ships 5 hooks.
- **Status states `qa-passed` / `qa-failed`**: the flow is now `built → done` via `/ship:verify` (FAIL appends fix tasks and reverts to `plan-verified`).

### Migration

- `claude plugin update ship` (or re-sync a legacy `.claude/` install). Any feature sitting at `qa-passed` should be advanced with `/ship:verify`; `qa-failed` features should run `/ship:build` then `/ship:verify`.

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
