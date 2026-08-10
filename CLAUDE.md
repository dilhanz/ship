# Ship

Ship is a feature-centric development framework for Claude Code. Every piece of work (feature or fix) gets its own directory under `.planning/features/{name}/`. The user drives requirements through intensive brainstorming, then Claude plans, builds, and verifies.

## Architecture

Three-layer design, all Markdown with YAML frontmatter:

```
skills/*/SKILL.md          17 skills (13 user-invocable commands + 4 reference skills)
skills/deviation-rules/    Reference skill preloaded into builder agent
skills/git-commits/        Reference skill preloaded into builder + verifier agents
skills/tdd/                Reference skill preloaded into builder agent (test-driven development)
skills/pm-state/           Reference skill defining the .project-manager/ state formats
ship/workflows/go.workflow.js   Workflow-engine script for the /ship:go build→verify spine
ship/workflows/plan.workflow.js Workflow-engine script for the /ship:go plan revision loop
agents/*.md                6 specialized agents (brainstormer, plan-reviewer, replanner, builder, reviewer, verifier)
```

**Skills** define frontmatter fields like `model` and `allowed-tools`. Some skills delegate to agents via the Agent tool; others run inline with full instructions embedded in the skill body.

**Workflow:** `/ship:go` runs two non-interactive spines through the Claude Code Workflow engine — the plan revision loop (`ship/workflows/plan.workflow.js`) and the build→verify spine (`ship/workflows/go.workflow.js`) — where schema-validated `agent()` calls keep per-agent output out of the main conversation context. The interactive steps (round-1 planning, the plan-loop `NEEDS_INPUT` questions, the build-approval gate, finish) run inline in the `go` skill.

**Agents** define `name`, `description`, `tools`, `model`, `maxTurns`, `memory`, and `skills` in frontmatter. Each agent has a single responsibility:
- `ship-brainstormer` — probes until requirements are testable and confirmed → CONTEXT.md
- `ship-plan-reviewer` — read-only plan review against the codebase → plan_review_result findings
- `ship-replanner` — revises PLAN.md against CRITICAL findings (PLAN.md only) → replan_result
- `ship-builder` — task execution with atomic commits
- `ship-reviewer` — re-runs phase verify commands + reviews the phase diff → review_result findings
- `ship-verifier` — acceptance criteria + adversarial bug hunt + anti-pattern scan → VERIFY.md (single post-build gate)

**Inline skills** (run in the main conversation for unlimited turns):
- `plan` — codebase exploration → PLAN.md (exploration scaled to uncertainty — reuses CONTEXT.md Codebase Notes when present, explores inline for small surfaces, fans out Explore agents for large ones)
- `plan-verify` — independent plan review against codebase patterns (runs inline as orchestrator, delegating the review to a fresh-context subagent for independence)

## Flow

```
/ship:start       "idea" → brainstorm (outcome-gated)   → CONTEXT.md
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
```

Status tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `plan-verified` → `building` → `built` → `done`. If verify fails: `built` → (verifier writes fix tasks, reverts to `plan-verified`) → rebuild via /ship:build → `built` → /ship:verify retried.

## Supporting Files

```
hooks/                 6 Node.js hooks (stdin->stdout, zero dependencies)
  guide.cjs              SessionStart event — injects Ship awareness so Claude proactively suggests commands
  statusline.cjs         StatusLine event — displays model, task, dir, context %
  context-monitor.cjs    PostToolUse event — injects warnings when context is high (matcher: Write|Edit|Bash|Agent)
  safety-gate.cjs        PreToolUse event — blocks git add . to enforce atomic commits (matcher: Bash)
  post-compact.cjs       PostCompact event — re-injects feature state after context compaction
  pm-sync-nudge.cjs      PostToolUse event — nudges /ship:pm-sync when ROADMAP.md drifts from feature statuses (matcher: Write|Edit)
  scan-features.cjs      Helper — scans .planning/features for state injected by guide/post-compact
  hooks.json             Declarative hook registration for the plugin system

ship/templates/        VERIFY.md planning template + dashboard.html PM dashboard template
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
- **Plan revision loop:** at status `planned`, `/ship:go` runs `ship/workflows/plan.workflow.js` — review → replan → re-review, capped at 5 rounds (5 reviews, at most 4 replans), with a convergence guard that returns `STUCK` the moment a round's CRITICAL set repeats (keyed on `task_id||file`). `APPROVED` is the only status that advances to `plan-verified`; `STUCK`, `UNRESOLVED`, and `BLOCKED` leave the feature at `planned` and never proceed to build. `NEEDS_INPUT` is the only case that interrupts: the go skill asks the replanner's questions via AskUserQuestion and re-invokes with `args.answers` plus a `roundOffset` so the replanner's `### Round n` subsections stay unique. `/ship:plan-verify` remains single-shot; `/ship:go --auto` additionally skips the build-approval gate.
- **Per-phase review gate:** after each build phase, the read-only ship-reviewer agent re-runs the phase's verify commands (trust-but-verify, a failing verify is a critical finding) and reviews the phase diff; critical/high findings trigger one builder fix round; all findings persist to REVIEW.md
- **Single post-build gate:** ship-verifier checks every acceptance criterion against running code AND hunts bugs with adversarial tests AND scans for anti-patterns, producing one VERIFY.md — there is no separate QA layer
- **Structured output:** the go workflow validates agent results via JSON Schema (`StructuredOutput`) rather than parsing fenced text-JSON blocks; agents still emit `build_result`/`review_result`/`verify_result` blocks for the manual skill paths
- **Builder continuation:** a builder that runs out of turn budget mid-phase is expected on large tasks, not a failure — its finished tasks are committed and marked done in PLAN.md, so a continuation resumes from the first pending task. The builder signals it with `PARTIAL`; if it dies without reporting, the `go` workflow probes PLAN.md for the real task status. Both paths continue the phase (up to 5 builder rounds in the workflow, 4 continuation rounds in the manual skill) and stop only when a round lands no new done tasks
- **Project manager:** two skills sit above the feature layer — `/ship:pm` (question router: next item, parallel lanes, status, decisions) and `/ship:pm-sync` (interactive bootstrap/reconcile). State lives in `.project-manager/` (ROADMAP.md, DECISIONS.md, generated dashboard.html) per the `skills/pm-state` reference skill; the pm-sync-nudge hook injects a sync reminder when Ship feature statuses drift from ROADMAP.md. No time concepts in PM state; the PM directs and hands off to Ship commands but never implements.

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
