# Ship

Ship is a feature-centric development framework for Claude Code. Every piece of work (feature or fix) gets its own directory under `.planning/features/{name}/`. The user drives requirements through intensive brainstorming, then Claude plans, builds, and verifies.

## Architecture

Three-layer design, all Markdown with YAML frontmatter:

```
skills/*/SKILL.md          15 skills (12 user-invocable commands + 3 reference skills)
skills/deviation-rules/    Reference skill preloaded into builder agent
skills/git-commits/        Reference skill preloaded into builder + verifier agents
skills/tdd/                Reference skill preloaded into builder agent (test-driven development)
ship/workflows/go.workflow.js   Workflow-engine script for the /ship:go build→verify spine
ship/workflows/plan.workflow.js Workflow-engine script for the /ship:go plan revision loop
agents/*.md                6 specialized agents (brainstormer, plan-reviewer, replanner, builder, reviewer, verifier)
```

**Skills** define frontmatter fields like `model` and `allowed-tools`. Some skills delegate to agents via the Agent tool; others run inline with full instructions embedded in the skill body.

**Workflow:** `/ship:go` runs two non-interactive spines through the Claude Code Workflow engine — the plan revision loop (`ship/workflows/plan.workflow.js`) and the build→verify spine (`ship/workflows/go.workflow.js`) — where schema-validated `agent()` calls keep per-agent output out of the main conversation context. The interactive steps (round-1 planning, the plan-loop `NEEDS_INPUT` questions, the build-approval gate, finish) run inline in the `go` skill.

**Agents** define `name`, `description`, `tools`, `model`, `maxTurns`, `memory`, and `skills` in frontmatter. Each agent has a single responsibility:
- `ship-brainstormer` — probes until requirements are testable and confirmed → CONTEXT.md
- `ship-plan-reviewer` — read-only plan review against the codebase → plan_review_result findings
- `ship-replanner` — revises PLAN.md against CRITICAL findings (PLAN.md plus its own `replan-round-{n}.json` scratch record) → replan_result
- `ship-builder` — task execution with atomic commits
- `ship-reviewer` — re-runs phase verify commands + reviews the phase diff → review_result findings
- `ship-verifier` — acceptance criteria + adversarial bug hunt + anti-pattern scan → VERIFY.md (single post-build gate)

**Inline skills** (run in the main conversation for unlimited turns):
- `plan` — codebase exploration → PLAN.md (exploration scaled to uncertainty — reuses CONTEXT.md Codebase Notes when present, explores inline for small surfaces, fans out Explore agents for large ones)
- `plan-verify` — independent plan review against codebase patterns (runs inline as orchestrator, delegating the review to a fresh-context subagent for independence)

## Flow

```
/ship:ledger             → ordered index of planned features → .planning/LEDGER.md
/ship:start       "idea" → brainstorm (outcome-gated)   → CONTEXT.md + ledger row + worktree
/ship:plan               → explore code, design tasks    → PLAN.md
/ship:plan-verify        → verify plan against codebase  → PLAN.md (review appended)
/ship:build              → implement, verify, commit     → tasks marked done
/ship:verify             → check acceptance criteria + hunt bugs → VERIFY.md
/ship:finish             → complete feature (PR, merge, or keep)
/ship:go                 → auto-run remaining steps (build→verify via Workflow engine)
```

## Feature Directory Structure

```
.planning/features/{feature-name}/
  CONTEXT.md    — brainstorm output (problem, decisions, acceptance criteria, scope)
  PLAN.md       — implementation plan with tasks (status tracked inline)
  REVIEW.md     — per-phase review findings (fixed and unresolved)
  VERIFY.md     — verification report (criteria + bug hunt)

.planning/archive/{feature-name}/   — completed features moved here by /ship:finish
.planning/LEDGER.md                — ordered index of planned features (Now / Next / Someday / Shipped)
```

Status tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `plan-verified` → `building` → `built` → `done`. If verify fails: `built` → (verifier writes fix tasks, reverts to `plan-verified`) → rebuild via /ship:build → `built` → /ship:verify retried.

## Supporting Files

```
hooks/                 5 Node.js hooks (stdin->stdout, zero dependencies)
  guide.cjs              SessionStart event — injects Ship awareness so Claude proactively suggests commands
  statusline.cjs         StatusLine event — displays model, task, dir, context %
  context-monitor.cjs    PostToolUse event — injects warnings when context is high (matcher: Write|Edit|Bash|Agent)
  safety-gate.cjs        PreToolUse event — blocks git add . to enforce atomic commits (matcher: Bash)
  post-compact.cjs       PostCompact event — re-injects feature state after context compaction
  scan-features.cjs      Helper — scans .planning/features for state injected by guide/post-compact
  hooks.json             Declarative hook registration for the plugin system

ship/templates/        VERIFY.md planning template
ship/resolve-profile.cjs  Helper — resolves a feature's workflow profile to knob values (module + CLI)
ship/find-features.cjs  Helper — resolves feature slugs across every git worktree and the archive (module + CLI)
install.js             Deprecated legacy installer — use claude plugin install ship instead
```

## Key Concepts

- **Feature-centric:** Each feature/fix gets its own directory — no phases, no milestones, no FEAT-XX IDs
- **Intensive brainstorming:** The brainstormer probes until the problem, scope boundary, and testable acceptance criteria can be stated without guessing — and the user has confirmed — before writing CONTEXT.md
- **Atomic commits:** One commit per task, specific files staged (never `git add .`), format: `feat(feature-name): description`
- **Deviation rules:** 3 escalation levels when reality diverges from the plan, with structured debugging in Rule 2 (see `skills/deviation-rules/SKILL.md`)
- **Test-driven development:** Builder follows RED-GREEN-REFACTOR when tasks have test-based verify commands
- **Context bridge:** The statusline hook writes context metrics to `${CLAUDE_PLUGIN_DATA}/claude-ctx-{session}.json`, which the context-monitor hook reads to inject warnings
- **Auto-discovery:** The guide SessionStart hook injects Ship awareness into every conversation, so Claude proactively suggests commands when it detects feature work. Skill descriptions use "Use when..." trigger-condition format for semantic matching (inspired by superpowers CSO pattern).
- **Workflow-engine `/ship:go`:** the build→verify spine runs in `ship/workflows/go.workflow.js` via schema-validated `agent()` calls, so per-phase builder/reviewer/verifier output never enters the main conversation context. The interactive steps (round-1 planning, plan-approval, finish) stay inline in the `go` skill. Trade-off: the workflow cannot prompt mid-run, so a builder NEEDS_CONTEXT stops it and is surfaced to the manual `/ship:build`. Turn-budget exhaustion does not stop it — see Builder continuation below.
- **Plan revision loop:** at status `planned`, `/ship:go` runs `ship/workflows/plan.workflow.js` — review → replan → re-review, capped at 5 rounds (5 reviews, at most 4 replans), with a convergence guard that returns `STUCK` the moment a round's CRITICAL set repeats (keyed on `task_id||file`). `APPROVED` is the only status that advances to `plan-verified`; `STUCK`, `UNRESOLVED`, and `BLOCKED` leave the feature at `planned` and never proceed to build. `NEEDS_INPUT` is the only case that interrupts: the go skill asks the replanner's questions via AskUserQuestion and re-invokes with `args.answers`, the escalated `findings`, and a `roundOffset` so the replanner's `### Round n` subsections stay unique. Whenever `args.answers` is present the workflow runs an **apply-answers step** first — one `replan:answers` replanner call before `plan-review:r1` that lands the ruling in PLAN.md, so an answer can no longer be dropped by a review that approves without a replanner ever running; it consumes a `### Round n` label but not a review round, and every result carries `nextRoundOffset` (labels consumed across all invocations, answers step included), which is what the go skill threads back as the next `roundOffset` and into QUESTIONS.md. Every `BLOCKED` result names the missing agent in `blockedBy` (`reviewer` | `replanner` | `answers`); on `reviewer` the go skill runs a **scratch fallback** before reporting — it reads `.review-scratch/plan-round-{rounds}.json`, and a `complete` record whose `plan_hash` equals `git hash-object PLAN.md` is adopted as that round's review: zero CRITICALs approves, otherwise the record is copied over `plan-round-1.json` and the workflow is re-invoked once, so the fresh round-1 reviewer adopts it through its own salvage check instead of re-reviewing. `/ship:plan-verify` remains single-shot, but still writes an incremental `plan-round-1.json` scratch record — a turn-capped reviewer dies with no chance to report, so the record is what a rerun salvages, and plan-verify applies the same hash-matched adoption after its own second failure. `/ship:plan` has a **replan mode**: when PLAN.md exists with a `## Plan Review` whose latest verdict is not approved (`NEEDS-REVISION`, `STUCK`, `UNRESOLVED`, `BLOCKED`), the open CRITICALs are required inputs, the tasks they name are revised in place with ids and the whole review section preserved, and a `### Round n — /ship:plan` subsection is appended — rather than rewriting the file from the template and discarding the findings it was invoked to address; `/ship:go --auto` additionally skips the build-approval gate.
- **Workflow profiles:** the *structure* of the go spine is fixed, but its *policy* is per-feature. A `profile:` field in CONTEXT.md frontmatter — `quick` | `standard` | `thorough`, proposed by the brainstormer at `/ship:start` and overridable per run with `/ship:go {name} --profile {p}` — names a bundle of knobs. `ship/resolve-profile.cjs` holds the profile→knob table (the workflow scripts cannot `require()` anything, so resolution must live outside them) and is the single place it exists: the go skill shells out to it, precedence **flag > CONTEXT.md frontmatter > standard**, and an unrecognized value degrades to `standard` plus a warning — the safe direction is more ceremony, not less, and the CLI always exits 0 so a resolution hiccup cannot kill a go run. The resolved knobs travel as real JSON values in the two Workflow `args` objects, and each workflow defaults its knob to today's constant when absent. `quick` skips the per-phase review gate entirely (no reviewer, fix-round, or re-review agent runs; the phase is recorded as `Status: SKIPPED (profile: quick)` in REVIEW.md — deliberately distinct from a bare `SKIPPED`, which means the review was supposed to run and failed) and narrows the verifier to criteria-only (Stage 2a, the discretionary adversarial tests, and the anti-pattern scan drop out; Stage 1, the verdict rules, and *carried unresolved review findings* never do — narrowing never waives them — and VERIFY.md's Stage 2 section records the trade). Round caps are 2/5/8 builder continuation rounds and 2/5/5 plan-loop rounds. An absent field or an absent knob is `standard`, which is exactly the previous behavior byte-for-byte; profiles are a go-path concept only, so the manual `/ship:build`, `/ship:verify`, and `/ship:plan-verify` keep full ceremony and hands-on control.
- **Per-phase review gate:** after each build phase, the read-only ship-reviewer agent re-runs the phase's verify commands (trust-but-verify, a failing verify is a critical finding) and reviews the phase diff; critical/high findings trigger one builder fix round, then a re-review that checks both whether each finding is resolved *and* whether the fix commits introduced anything new (`new_issue`); all findings persist to REVIEW.md. Every review must return its own evidence — `verify_runs` (one entry per re-run command, `pass`/`fail`/`not_runnable`) and `files_reviewed` are required schema fields, so an APPROVED verdict backed by nothing is visible as a concern instead of indistinguishable from a real review, and REVIEW.md records the counts per phase. A fix round that lands no commits gets no re-review: with no fix diff a re-reviewer inspects a clean tree and approves, which would record every finding as fixed, so they are marked `unresolved` with a concern instead
- **Single post-build gate:** ship-verifier checks every acceptance criterion against running code AND hunts bugs with adversarial tests AND scans for anti-patterns, producing one VERIFY.md — there is no separate QA layer. It is also the backstop for the review gate's one-fix-round cap, which requires it to know what survived: it reads REVIEW.md and treats every `unresolved` critical/high finding as a mandatory Stage 2b target (reproduced / not reproduced / not testable, each with a command, recorded in VERIFY.md's Carried Review Findings table). On the `/ship:go` path REVIEW.md is written *after* the build workflow returns, so the workflow passes the same findings in the verifier's prompt — the file and the prompt block are one deduplicated list
- **Structured output:** the go workflow validates agent results via JSON Schema (`StructuredOutput`) rather than parsing fenced text-JSON blocks; agents still emit `build_result`/`review_result`/`verify_result` blocks for the manual skill paths. Every schema-driven agent must be told explicitly that **calling `StructuredOutput` is its final action, overriding the "nothing after the closing fence" rule** — without that exception the agent stops at the fence, the harness's nudge fails, and `agent()` throws `subagent completed without calling StructuredOutput`
- **Salvage retries:** a lost structured result is a transport failure, not proof the work never happened, so `safeAgent`'s optional `retryPrompt` (in both workflows) points the retry at a durable record instead of redoing ~90k tokens of work. Four call sites use it: the phase reviewer and plan reviewer write scratch records under `.planning/features/{name}/.review-scratch/` (`phase-{id}[-rereview].json`, `plan-round-{n}.json` — their one permitted write; the read-only-on-source gate still holds), the replanner writes `replan-round-{n}.json` (`n` is its `### Round n` label — written before the first edit with every finding `pending`, rewritten after each finding is revised, disproved, or escalated, and stamped `complete` once the subsection lands, so a salvage resumes from the first `pending` finding instead of re-applying edits already in PLAN.md; the subsection itself is written last and so is exactly what a cut-off run never leaves), and the verifier salvages its own VERIFY.md. The replanner runs at 60 turns like both reviewers — plans carrying 7–8 CRITICALs did reach 30. Every record is **fingerprinted** — `head` (git HEAD) for phase reviews, `plan_hash` (`git hash-object PLAN.md`) for plan reviews, and a `**Head:**` line in VERIFY.md itself for verifications — so a record from a different build or a different plan is rejected rather than salvaged. The replanner's `plan_hash` is taken before its first edit, so it tells an untouched plan from a partly revised one; its salvage matches on `round` plus the finding key set (`task_id||file`) instead, because a successful replan necessarily changes the hash. The verifier's stamp is what makes its salvage safe: a FAIL verdict sends the feature back for a fix round, so a *complete* VERIFY.md from the previous round is exactly what the re-verification finds on disk, and a report with no stamp is treated as stale rather than trusted. No salvage check ends with "and stop": calling `StructuredOutput` is the final action on the salvage path too, or the salvage is itself a lost result. Deleting `.review-scratch/` (section 6 of the go skill, step 7 of the build skill, plus the plan loop's terminal outcomes) is hygiene, not the safety net. The builder needs none of this — PLAN.md plus the progress probe already cover it, which is why its call site keeps `retry: false`
- **Precomputed diff range:** the builder reports `commits` oldest-first (one atomic commit per task, in task order), so the go workflow derives `{oldest}~1..HEAD` and hands the reviewer a finished range instead of paying turns for it to re-derive one with `git log`. The reviewer falls back to deriving it only when the range errors, diffs empty, or the phase starts at the repo's root commit (where `~1` does not resolve and the empty-tree hash is used instead)
- **Builder continuation:** a builder that runs out of turn budget mid-phase is expected on large tasks, not a failure — its finished tasks are committed and marked done in PLAN.md, so a continuation resumes from the first pending task. The builder signals it with `PARTIAL`; if it dies without reporting, the `go` workflow probes PLAN.md for the real task status. Both paths continue the phase (up to 5 builder rounds in the workflow, 4 continuation rounds in the manual skill) and stop only when a round lands no new done tasks
- **Ledger:** one ordered index of planned features at `.planning/LEDGER.md`, with four fixed sections — `## Now`, `## Next`, `## Someday`, `## Shipped`. **Position is priority**: the top line of `## Now` is the next thing to do, so reprioritising is moving a line rather than editing a cell. A row is `- [ ] **{slug}** — {one-liner}` and holds nothing else; everything about a feature lives in `.planning/features/{slug}/`, and status is read live every time the ledger is displayed through `ship/find-features.cjs`, which derives each feature's location from `git worktree list --porcelain` on every render (never stored) — so a feature whose directory `/ship:start` moved into a worktree still renders, as `[{status} · {branch}]` when it lives elsewhere and a bare `[{status}]` when it is in the current checkout — and there is no status cell, so nothing can drift. The ledger itself always lives at the main worktree root (`MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`), read and written there from any worktree; a linked worktree never gets a second copy. A row does not require a folder (an idea may sit under `## Next` indefinitely; `/ship:start` is what gives it one), and a folder without a row is reported as an orphan rather than silently adopted. `/ship:start` inserts the row at the top of `## Now`; `/ship:finish` moves it to the top of `## Shipped` (recency order there, not priority) via Bash, since finish has no Write or Edit tool. `/ship:ledger` owns the other three sections. Nothing else writes the file — the ordering belongs to the user
- **Brainstorm in main, build in a worktree:** `/ship:start` runs in the main checkout, and once CONTEXT.md is written it offers to create the `feature/{slug}` worktree and `EnterWorktree` into it, moving the feature directory across so the worktree holds the sole copy (a copy-without-remove fallback whenever any part of the directory is already tracked — two divergent CONTEXT.md files is the failure this avoids). `.planning/LEDGER.md` is deliberately **not** carried across: it indexes the project, not the branch, and lives at the main root. When `/ship:start` is already running inside a worktree, the whole offer is skipped. `/ship:ledger`, `/ship:status`, and `/ship:resume` see the moved directory through `ship/find-features.cjs` (resume reports where the feature lives and offers `EnterWorktree`, never entering on its own); `hooks/guide.cjs` and `hooks/post-compact.cjs` deliberately stay per-checkout, calling `scanFeatures(cwd)` so a session's injected state describes the checkout it is in
- **Worktree-aware lookup:** `ship/find-features.cjs` runs `git worktree list --porcelain` once, scans `.planning/features/` in every listed checkout plus `.planning/archive/` at the main root, and returns one entry per slug with `status`, `location` (`main` | `worktree` | `archive`), `branch`, `here`, and `owner`. When a slug has copies in several checkouts (a repo that tracks `.planning/`), the **ownership ladder** picks one without reading statuses: the copy whose worktree branch is exactly `feature/{slug}` or `{slug}` wins as `branch` (two such matches → `ambiguous`), else the copy in the current checkout wins as `cwd`, else the entry is honestly `ambiguous` with `copies` and every candidate listed — "furthest-along status" was rejected because a stale copy can carry the later-looking status. A live copy anywhere beats the archive; the archive resolves only when no live copy exists. The **fallback** is today's behavior: no `git`, not a repo, or unparsable output → the cwd is treated as the sole main worktree, `warning` says why, and the CLI still exits 0 with valid JSON (no `process.exit()`, same doctrine as `resolve-profile.cjs`). The `slug` filter (module `slug` option / CLI positional) is a **name, not a path**: a slug that is empty, whitespace-only, or contains `/`, `\`, or `..` is rejected inside `findFeatures()` — `features` comes back `{}` and `warning` names the slug (`ignored invalid slug '{slug}' — a slug is one path segment`) — rather than coerced with `path.basename()` (which could resolve a different real feature) or thrown (which would break the pipe-reading skills). `/ship:resume` no longer passes a slug at all — it calls unfiltered and picks `features[name]`, so a typo'd name reports "not found" with a listing of what exists instead of suggesting `/ship:start`

## Plugin Structure

Ship is distributed as a Claude Code plugin. The `.claude-plugin/plugin.json` manifest declares the plugin name, version, and hooks reference. `hooks/hooks.json` declaratively registers the hooks with `${CLAUDE_PLUGIN_ROOT}` paths. Skills are auto-discovered from `skills/*/SKILL.md` and auto-namespaced as `ship:skill-name`. Plugin data (session metrics, context bridge files) is stored under `${CLAUDE_PLUGIN_DATA}` which persists across updates at `~/.claude/plugins/data/ship/`.

Install via:
```bash
claude plugin install ship
# or from marketplace:
/plugin marketplace add dilhanz/ship
```

## Development Guidelines

### No Dependencies

Ship uses zero npm packages. All hooks are pure Node.js built-ins (`fs`, `path`, `os`, `https`, `child_process`). Keep it that way.

### Hooks

Hooks are stdin->stdout Node.js scripts. They receive JSON on stdin and (optionally) write JSON to stdout. They must never throw or block — always wrap in try/catch and exit silently on error. The context-monitor uses `hookSpecificOutput.additionalContext` to inject messages into the agent's conversation.

### Installation

**Primary:** `claude plugin install ship` — uses the Claude Code plugin system for automatic updates and clean uninstall.

**Legacy (deprecated):** `npx github:dilhanz/ship` — copies the full directory tree to `.claude/` and registers hooks in `.claude/settings.json`. Still functional but will be removed in a future major version.

### Skills

Skills live in `skills/*/SKILL.md`. Each file is a Markdown document with YAML frontmatter. Key fields: `model`, `allowed-tools`. The body is the task prompt. `$ARGUMENTS` is replaced with user-provided arguments. The plan skill runs inline in the main conversation (full instructions in the skill body) with exploration scaled to uncertainty. The plan-verify skill runs inline as an orchestrator and delegates the review to a fresh-context subagent for independence. Start runs inline. The manual `build` skill runs inline and invokes the builder agent per-phase so the main context sees phase-by-phase progress. The `go` skill runs the interactive steps inline but delegates the build→verify spine to the Workflow engine (`ship/workflows/go.workflow.js`), keeping per-agent output out of the main context. Skills are auto-namespaced as `ship:skill-name` by the plugin system (e.g., `/ship:start`).

### Agents

Agents live in `agents/`. Frontmatter: `name`, `description`, `tools`, `model`, `maxTurns`, `memory`, `skills`. The body contains detailed instructions for the agent's role. Agents are invoked by skills via the Agent tool, not directly by users.

### Templates

The VERIFY.md template in `ship/templates/` is read at runtime by the verifier agent. CONTEXT.md and PLAN.md structures are inlined in the brainstormer and plan skill instructions respectively.

### Testing

Use `node --test` (Node.js built-in test runner). Test files go in the `tests/` directory.

### Releasing

The version lives in three files — `ship/VERSION`, `package.json`, `.claude-plugin/plugin.json` — and they must agree. Bump all three plus a `## {version}` CHANGELOG entry in the release PR, then tag `main` after merge:

```bash
git tag -a v5.1.0 -m "v5.1.0 — short description" main && git push origin v5.1.0
```

`.github/workflows/release.yml` takes it from there: it checks the tag against the three version files, runs the test suite, extracts the matching CHANGELOG section as the release notes, and publishes the GitHub release. A version mismatch, a missing CHANGELOG section, or a tag that is already released fails the run instead of publishing.

The same job runs from the Actions tab (**Run workflow** → tag) for a tag pushed before the workflow existed, or to retry a failed publish. It reads the tagged commit either way, so a manual run publishes exactly what the tag push would have.

### Commit Conventions

```
<type>(<feature-name>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Feature name is the kebab-case slug from the feature directory. Description is imperative, lowercase, no period, under 60 chars. For changes to Ship itself (not a user project), omit the feature name:

```
feat: rewrite to feature-centric architecture
refactor: simplify deviation rules to 3 levels
```
