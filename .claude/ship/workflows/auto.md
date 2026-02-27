# Workflow: auto

This workflow runs the full Ship lifecycle end-to-end. It is invoked by the `/ship:auto` command.

---

## Purpose

Capture requirements interactively, confirm a roadmap once, then automatically plan → execute → verify every phase without further prompts. Stops and writes a report if a hard blocker occurs.

## Prerequisites

- A working directory (the project root) must be set
- The user must have a rough idea of what they want to build

---

## Phase A — Project Setup (Interactive)

This phase is identical to the `new-project` workflow Steps 1–6.

### Step A1 — Detect project mode

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

### Step A2 — Create .planning directory

Check if `.planning/` exists in the current working directory. If not, create it:

```bash
mkdir -p .planning
```

### Step A3 — Gather project information

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

### Step A4 — Write PROJECT.md and REQUIREMENTS.md

Based on the user's answers, write `.planning/PROJECT.md`:

- Vision: clean one-liner
- Problem Statement: 2-3 sentences
- Constraints: bullet list (stack, must-use, must-avoid)
- Key Decisions: leave blank initially
- Out of Scope: explicit list

Then write `.planning/REQUIREMENTS.md`:

- Assign FEAT-01, FEAT-02, etc. IDs
- Write a clean title and description for each
- Assign priority: Must / Should / Could
- Add any NFR-XX non-functional requirements if mentioned
- Leave the Coverage table empty (roadmapper fills it)

Show the user the requirements list and ask: "Does this capture everything? Any changes before we create the roadmap?"

Wait for confirmation or corrections. Update REQUIREMENTS.md if needed.

### Step A5 — Invoke ship-roadmapper

Once requirements are confirmed, invoke the `ship-roadmapper` agent with `model: "opus"`:

> "Requirements confirmed. Invoking ship-roadmapper to create the project roadmap."

The roadmapper will:
- Group requirements into phases
- Write ROADMAP.md
- Write STATE.md
- Update the Requirements coverage table

After the roadmapper completes, read `.planning/ROADMAP.md` and count all `## Phase` headings. Store this count as **TOTAL_PHASES** for use in Phase C.

---

## Phase B — Confirmation Gate (one-time)

Read `.planning/ROADMAP.md` and present a roadmap summary:

```
## Auto-Mode: Ready to Execute

Project: [name]
Requirements: [N features]
Phases: [TOTAL_PHASES phases]

[Phase list — one line per phase: "Phase N: [name] — [goal]"]

Ship will automatically plan, execute, and verify each phase in sequence.
It will stop and report if a hard blocker or verification failure occurs.
```

Ask: **"Proceed with automated execution? (yes/no)"**

- If **no**: output "Exiting auto mode. Run `/ship:plan-phase 1` to begin manually." and stop.
- If **yes**: proceed to Phase C. Do not ask for confirmation again at any point.

---

## Phase C — Automated Loop

Set CURRENT_PHASE = 1.

Repeat the following steps until CURRENT_PHASE > TOTAL_PHASES:

### Step C1 — Plan

Announce: "**[Phase CURRENT_PHASE / TOTAL_PHASES] Planning...**"

Check if `.planning/NN-PLAN.md` already exists (where NN is the zero-padded phase number). If it exists, discard it — always replan from scratch in auto mode.

Invoke the `ship-planner` agent with the phase number, using `model: "opus"`.

After the planner returns `## PLAN READY`, invoke the `ship-plan-checker` agent with the phase number, using `model: "opus"`.

- If **PLAN VERIFIED** → proceed immediately to Step C2.
- If **PLAN HAS ISSUES** with warnings only → briefly output the warnings and proceed to Step C2. Warnings do not block auto mode.
- If **PLAN HAS ISSUES** with blockers → invoke `ship-planner` once more (with `model: "opus"`), passing the checker's blocker list as context to fix. Then run `ship-plan-checker` (with `model: "opus"`) again.
  - If the revised plan is **PLAN VERIFIED** or has warnings only → proceed to Step C2.
  - If the revised plan still has blockers → go to **Phase D** with stop reason `PLAN_QUALITY`.

Do not show the plan to the user or wait for confirmation.

### Step C2 — Execute

Announce: "**[Phase CURRENT_PHASE / TOTAL_PHASES] Executing...**"

Validate that git is initialized in the project root (`git status`). If not, silently initialize it:

```bash
git init && git commit --allow-empty -m "chore: initial commit"
```

Invoke the `ship-executor` agent with the phase number, using `model: "sonnet"`.

- If executor returns `## PHASE COMPLETE` → proceed immediately to Step C3.
- If executor returns `## CHECKPOINT REACHED` → go to **Phase D** with stop reason `CHECKPOINT`.

### Step C3 — Verify

Announce: "**[Phase CURRENT_PHASE / TOTAL_PHASES] Verifying...**"

Invoke the `ship-verifier` agent with the phase number, using `model: "sonnet"`.

After the verifier returns `## VERIFICATION COMPLETE`, read `.planning/NN-VERIFY.md`:

- **PASS** and CURRENT_PHASE < TOTAL_PHASES → output "Phase CURRENT_PHASE: PASS" → CURRENT_PHASE++ → back to Step C1
- **PASS** and CURRENT_PHASE == TOTAL_PHASES → go to **Phase E** (auto-complete)
- **PARTIAL** or **FAIL** → go to **Phase D** with stop reason `VERIFY_FAILURE`

### Context warning handling

If the context-monitor injects a high-context warning via `additionalContext`, treat it as a soft blocker. Output:

```
Context is running low. Progress is saved in STATE.md.
Run /ship:resume to continue from the current phase.
```

Then stop — do not attempt to continue the loop.

---

## Phase D — Auto-Stop Report

Write `.planning/AUTO-STOP.md` with the following structure:

```markdown
# Auto-Stop Report

## Stop Reason

[CHECKPOINT | VERIFY_FAILURE | PLAN_QUALITY]

## Phase

Phase [N]: [Phase Name]

## Details

[For CHECKPOINT: copy the full conflict description and recommendation from the executor's checkpoint output]
[For VERIFY_FAILURE: copy the gap list and details from NN-VERIFY.md]
[For PLAN_QUALITY: list the blocker findings from the plan checker's two attempts]

## Phases Completed Before Stop

[List of phases that completed with PASS — "Phase N: [name]" per line, or "None" if first phase failed]

## How to Continue Manually

### Option 1 — Fix and resume
1. [Specific fix instruction based on the stop reason]
2. Run `/ship:execute-phase [N]` to resume from the checkpoint, or `/ship:verify-phase [N]` to re-verify
3. Once Phase [N] passes, run `/ship:auto` again from Phase [N+1] — or continue manually with `/ship:plan-phase [N+1]`

### Option 2 — Replan and re-execute
1. [Describe the architectural or scope change needed]
2. Run `/ship:plan-phase [N]` to create a revised plan
3. Run `/ship:execute-phase [N]`
4. Run `/ship:verify-phase [N]`

### Option 3 — Check current state
Run `/ship:status` to see the current phase and last action.
```

Update `.planning/STATE.md`:
- `Last Action`: "auto-stop — [stop reason] in Phase [N]"
- `Next Action`: "see .planning/AUTO-STOP.md for continuation steps"

Output a concise stop report to the user:

```
## Auto-Stop — Phase [N]: [Phase Name]

Reason: [CHECKPOINT | VERIFY_FAILURE | PLAN_QUALITY]
Phases completed: [list or "none"]

[1-2 sentence summary of what blocked progress]

Full details and continuation steps: .planning/AUTO-STOP.md
```

Stop. Do not attempt to continue.

---

## Phase E — Auto-Complete

Update `.planning/STATE.md` status to `complete`.

Output a completion summary:

```
## Auto-Complete

All [TOTAL_PHASES] phases delivered.

[Phase list with PASS status — "Phase N: [name] — PASS"]

Requirements met:
[List of FEAT-XX IDs and titles from REQUIREMENTS.md with Must/Should priority]

Project is complete. See .planning/ for full execution records.
```

---

## Error Handling

**If the user's feature list is very long (>15 features):** Suggest splitting into a v1 (must-haves only) and a future backlog before proceeding.

**If the tech stack is unclear:** Ask before proceeding — the planner needs the stack to research libraries and write correct file paths.

**If git is not present and auto-init fails:** Report the error and stop. Ask the user to initialize git manually, then re-run `/ship:auto`.

**If ROADMAP.md has no `## Phase` headings after roadmapper completes:** Something went wrong with the roadmapper. Show the roadmapper output and ask the user to run `/ship:new-project` to diagnose.
