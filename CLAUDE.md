# Ship

Ship is a feature-centric development framework for Claude Code. Every piece of work (feature or fix) gets its own directory under `.planning/features/{name}/`. The user drives requirements through intensive brainstorming, then Claude plans, builds, and verifies.

## Architecture

Three-layer design, all Markdown with YAML frontmatter:

```
commands/ship/*.md   10 slash commands (thin entry points, invoked as /ship:command-name)
ship/workflows/*.md   2 orchestration workflows (build, go)
agents/*.md           3 specialized agents (brainstormer, planner, verifier)
```

**Commands** define `description` and `allowed-tools` in frontmatter, then delegate to a workflow or agent.

**Workflows** define multi-step processes: `build` (execute tasks), `go` (auto-run remaining steps).

**Agents** define `name`, `description`, and `tools` in frontmatter. Each agent has a single responsibility:
- `ship-brainstormer` — intensive questioning → CONTEXT.md
- `ship-planner` — codebase exploration → PLAN.md
- `ship-verifier` — acceptance criteria checking → VERIFY.md

## Flow

```
/ship:start "idea" → brainstorm (5-10+ questions) → CONTEXT.md
/ship:plan         → explore code, design tasks    → PLAN.md
/ship:build        → implement, verify, commit     → tasks marked done
/ship:verify       → check acceptance criteria      → VERIFY.md
/ship:go           → auto-run remaining steps
```

## Feature Directory Structure

```
.planning/features/{feature-name}/
  CONTEXT.md    — brainstorm output (problem, decisions, acceptance criteria, scope)
  PLAN.md       — implementation plan with tasks (status tracked inline)
  VERIFY.md     — verification report
```

Status tracked in CONTEXT.md frontmatter: `brainstormed` → `planned` → `building` → `built` → `done`

## Supporting Files

```
hooks/                 3 Node.js hooks (stdin->stdout, zero dependencies)
  ship-statusline.cjs     StatusLine event — displays model, task, dir, context %
  ship-context-monitor.cjs PostToolUse event — injects warnings when context is high
  ship-check-update.cjs   SessionStart event — checks GitHub for newer version

ship/templates/*.md    3 planning file templates (CONTEXT, PLAN, VERIFY)
ship/references/*.md   Git commit conventions and deviation rules
install.js             Copies everything to .claude/ in the current project and registers hooks
```

## Key Concepts

- **Feature-centric:** Each feature/fix gets its own directory — no phases, no milestones, no FEAT-XX IDs
- **Intensive brainstorming:** The brainstormer asks 5-10+ questions before writing CONTEXT.md
- **Atomic commits:** One commit per task, specific files staged (never `git add .`), format: `feat(feature-name): description`
- **Deviation rules:** 3 escalation levels when reality diverges from the plan (see `ship/references/deviation-rules.md`)
- **Context bridge:** The statusline hook writes context metrics to `/tmp/claude-ctx-{session}.json`, which the context-monitor hook reads to inject warnings

## Development Guidelines

### No Dependencies

Ship uses zero npm packages. All hooks are pure Node.js built-ins (`fs`, `path`, `os`, `https`, `child_process`). Keep it that way.

### Hooks

Hooks are stdin->stdout Node.js scripts. They receive JSON on stdin and (optionally) write JSON to stdout. They must never throw or block — always wrap in try/catch and exit silently on error. The context-monitor uses `hookSpecificOutput.additionalContext` to inject messages into the agent's conversation.

### Installation

`install.js` copies the full directory tree to `.claude/` in the current working directory and registers hooks in `.claude/settings.json`. It is idempotent — running it again updates files without duplicating hook registrations.

### Commands

Commands live in `commands/ship/`. Each file is a Markdown document with frontmatter (`description`, `allowed-tools`). The body tells Claude what to do, usually delegating to a workflow or agent. `$ARGUMENTS` is replaced with user-provided arguments.

### Agents

Agents live in `agents/`. Frontmatter: `name`, `description`, `tools`. The body contains detailed instructions for the agent's role. Agents are invoked by commands, not directly by users.

### Templates

Templates in `ship/templates/` define the structure of planning files. When creating a new planning file, read the corresponding template and fill it in.

### Testing

Use `node --test` (Node.js built-in test runner). Test files go in the `tests/` directory.

### Commit Conventions

```
<type>(<feature-name>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Feature name is the kebab-case slug from the feature directory. Description is imperative, lowercase, no period, under 60 chars. For changes to Ship itself (not a user project), omit the feature name:

```
feat: rewrite to feature-centric architecture
refactor: simplify deviation rules to 3 levels
```
