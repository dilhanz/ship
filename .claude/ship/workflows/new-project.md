# Workflow: new-project

This workflow guides Claude through setting up a new Ship project. It is invoked by the `/ship:new-project` command.

---

## Purpose

Capture what we're building (vision, constraints, requirements) and produce a validated roadmap before any code is written.

## Prerequisites

- A working directory (the project root) must be set
- The user must have a rough idea of what they want to build

## Steps

### Step 1 — Detect project mode

Before asking the user anything, determine whether this is a **greenfield** (new) or **brownfield** (existing) project.

Run the following checks:

1. Use Glob to look for common code file patterns: `**/*.ts`, `**/*.js`, `**/*.py`, `**/*.go`, `**/*.rb`, `**/*.rs`, `**/*.java`, `**/*.kt`, `**/*.swift`, `**/*.dart`, `**/*.cs`, `**/*.php`, `**/*.ex`, `**/*.exs`, `**/*.c`, `**/*.cpp`, `**/*.h`, `src/**/*`, `app/**/*`, `lib/**/*`
2. Check if any of these project manifest files exist: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `*.csproj`, `*.sln`, `composer.json`, `pubspec.yaml`, `mix.exs`, `Package.swift`, `CMakeLists.txt`, `Makefile`, `requirements.txt`, `setup.py`, `build.zig`
3. Check if `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` already exist
4. Count the number of non-hidden files and directories in the project root (exclude entries starting with `.`)

**Decision:**
- If source files or a project manifest exist → **brownfield mode**
- If `.planning/` files already exist → ask the user if they want to start fresh or continue from existing files
- If the directory contains more than 5 non-hidden files/directories but no recognized source or manifest files → likely brownfield; prompt the user to confirm: "I see [N] files/directories here but didn't detect a known project type. Is this an existing project?"
- If the directory is empty or only has config/dotfiles → **greenfield mode**

Announce the mode to the user before asking questions:
- Greenfield: "Starting a new project setup."
- Brownfield: "I can see an existing codebase. I'll ask a few extra questions to map what's already built."

### Step 2 — Create .planning directory

Check if `.planning/` exists in the current working directory. If not, create it:

```bash
mkdir -p .planning
```

### Step 3 — Gather project information

**For both modes**, ask (you can ask in one message — list all questions clearly):

1. **Project name and one-sentence description** — What are you building?
2. **Who is it for and what problem does it solve?** — Context for prioritization.
3. **Tech stack** — Languages, frameworks, runtime, database. *(For brownfield: confirm what you detected, don't ask from scratch.)*
4. **Any hard constraints** — Things we must use, must avoid, or must not break.
5. **Features list** — What should the finished project do? (Can be rough — you'll clean it up.)
6. **Out of scope** — What are we explicitly NOT building?

**Brownfield only — add these questions:**

7. **What's already built?** — Which features are complete, partially done, or not started?
8. **What's broken or known debt?** — Anything the plan should avoid touching or must work around?

Wait for the user to respond before proceeding.

### Step 4 — Write PROJECT.md

Based on the user's answers, write `.planning/PROJECT.md`. Use the PROJECT.md template structure:

- Vision: clean one-liner
- Problem Statement: 2-3 sentences
- Constraints: bullet list (stack, must-use, must-avoid)
- Key Decisions: leave blank initially (fill as decisions are made)
- Out of Scope: explicit list

### Step 5 — Write REQUIREMENTS.md

Transform the user's feature list into structured FEAT-XX requirements:

- Assign FEAT-01, FEAT-02, etc. IDs
- Write a clean title and description for each
- Assign priority: Must / Should / Could
  - Must = required for the project to be useful
  - Should = high value, do after Musts
  - Could = nice to have, do if time permits
- Add any NFR-XX non-functional requirements if mentioned

Leave the Coverage table empty — it will be filled by the roadmapper.

Show the user the requirements list and ask: "Does this capture everything? Any changes before we create the roadmap?"

Wait for confirmation or corrections. Update REQUIREMENTS.md if needed.

### Step 6 — Invoke ship-roadmapper

Once requirements are confirmed, invoke the `ship-roadmapper` agent with `model: "opus"`:

> "Requirements are confirmed. Invoking ship-roadmapper to create the project roadmap."

The roadmapper will:
- Group requirements into phases
- Write ROADMAP.md
- Write STATE.md
- Update the Requirements coverage table

### Step 7 — Present the Roadmap

After the roadmapper completes, read `.planning/ROADMAP.md` and present a summary to the user:

```
## Project Setup Complete

Project: [name]
Requirements: [N features captured]
Phases: [N phases]

[Phase list with goals]

Ready to start? Run /ship:plan-phase 1
```

Ask if the roadmap looks right or if they want to adjust phases before starting.

---

## Error Handling

**If the user's feature list is very long (>15 features):** Suggest splitting into a v1 (must-haves only) and a future backlog. Help them identify the core MVP.

**If the tech stack is unclear:** Ask before proceeding — the planner needs to know the stack to research libraries and write correct file paths.

**If the project directory already has code:** This is handled automatically by Step 1. The brownfield questions in Step 3 capture what's already built so the planner can check existing structure before creating tasks.
