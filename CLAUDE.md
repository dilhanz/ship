# Ship

Ship is a lightweight structured development framework for Claude Code. It provides slash commands, agents, and workflows that guide projects through a plan-execute-verify loop.

## Architecture

Three-layer design, all Markdown with YAML frontmatter:

```
commands/ship/*.md   11 slash commands (thin entry points, invoked as /ship:command-name)
ship/workflows/*.md   4 orchestration workflows (multi-step processes)
agents/*.md           5 specialized agents (planner, executor, verifier, roadmapper, brainstormer)
```

**Commands** define `description` and `allowed-tools` in frontmatter, then delegate to a workflow or agent.

**Workflows** define multi-step processes: `new-project`, `plan-phase`, `execute-phase`, `verify-phase`.

**Agents** define `name`, `description`, and `tools` in frontmatter. Each agent has a single responsibility (e.g., ship-planner reads the roadmap and writes a concrete task plan).

## Supporting Files

```
hooks/                 3 Node.js hooks (stdin->stdout, zero dependencies)
  ship-statusline.js     StatusLine event — displays model, task, dir, context %
  ship-context-monitor.js PostToolUse event — injects warnings when context is high
  ship-check-update.js   SessionStart event — checks GitHub for newer version

ship/templates/*.md    7 planning file templates (PROJECT, REQUIREMENTS, ROADMAP, STATE, PLAN, SUMMARY, VERIFY)
ship/references/*.md   Git commit conventions and deviation rules
install.js             Copies everything to ~/.claude/ and registers hooks in settings.json
```

## Key Concepts

- **State machine:** planning -> executing -> verifying -> complete (tracked in `.planning/STATE.md`)
- **Planning directory:** `.planning/` at the project root holds all state files (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, NN-PLAN.md, NN-SUMMARY.md, NN-VERIFY.md)
- **Atomic commits:** One commit per task, specific files staged (never `git add .`)
- **Deviation rules:** 4 escalation levels when reality diverges from the plan (see `ship/references/deviation-rules.md`)
- **Context bridge:** The statusline hook writes context metrics to `/tmp/claude-ctx-{session}.json`, which the context-monitor hook reads to inject agent-facing warnings

## Development Guidelines

### No Dependencies

Ship uses zero npm packages. All hooks are pure Node.js built-ins (`fs`, `path`, `os`, `https`, `child_process`). There is no `package.json`. Keep it that way.

### Hooks

Hooks are stdin->stdout Node.js scripts. They receive JSON on stdin and (optionally) write JSON to stdout. They must never throw or block — always wrap in try/catch and exit silently on error. The context-monitor uses `hookSpecificOutput.additionalContext` to inject messages into the agent's conversation.

### Installation

`install.js` copies the full directory tree to `~/.claude/` and registers hooks in `~/.claude/settings.json`. It is idempotent — running it again updates files without duplicating hook registrations.

### Commands

Commands live in `commands/ship/`. Each file is a Markdown document with frontmatter (`description`, `allowed-tools`). The body tells Claude what to do, usually delegating to a workflow file at `~/.claude/ship/workflows/`. `$ARGUMENTS` is replaced with user-provided arguments.

### Agents

Agents live in `agents/`. Frontmatter: `name`, `description`, `tools`. The body contains detailed instructions for the agent's role. Agents are invoked by workflows, not directly by users.

### Templates

Templates in `ship/templates/` define the structure of planning files. When creating a new planning file, read the corresponding template and fill it in.

### Testing

Use `node --test` (Node.js built-in test runner). Test files go in the `tests/` directory.

### Commit Conventions

```
<type>(<phase>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Phase is a two-digit number (e.g., `01`). Description is imperative, lowercase, no period, under 60 chars. For changes to Ship itself (not a user project), omit the phase number:

```
feat: add ship-brainstormer agent for feature idea exploration
refactor: streamline command flow and add brownfield detection
```
