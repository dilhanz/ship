---
name: ship:pm
description: Use when asking project-level questions — what to work on next, what can run in parallel, milestone status, blockers, or why something was decided
effort: medium
allowed-tools: Read, Write, Glob, Grep
argument-hint: "[question]"
---

Answer a project-level question from the project-manager state.

## Setup

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` for the ROADMAP.md, DECISIONS.md, and dashboard.html formats and the status mapping table.

2. If `.project-manager/ROADMAP.md` is missing or unparseable, say the project manager isn't set up (or its state is damaged) and point to `/ship:pm-sync` to bootstrap or repair it. Do not error out, and do not create any file other than the dashboard.

## Load state and reality

3. Load `.project-manager/ROADMAP.md` and `.project-manager/DECISIONS.md`.

4. Read live reality so answers reflect the repo as it is now:
   - `.planning/features/*/CONTEXT.md` frontmatter statuses
   - `.planning/archive/` directory names

5. For each backlog item with a Ship feature slug, compare its recorded Status against reality using the pm-state mapping table. If any item has drifted, note the drift inline in your answer ("{item}: roadmap says {recorded}, actually {actual}") and recommend `/ship:pm-sync` — but do NOT edit ROADMAP.md. All roadmap mutation belongs to `/ship:pm-sync`.

## Route on $ARGUMENTS

6. **No arguments — high-level brief:**
   - Each milestone with progress (done/total items) and status
   - Current blockers (items with Status `blocked`)
   - Top 1–3 priorities
   - A single "work on next" recommendation with its Ship command

7. **Next-style questions** ("what should I work on next?", "what's next?"):
   - Recommend exactly one item: highest-priority non-done, non-blocked item whose dependencies are satisfied (every item in its Depends on column is `done`)
   - Ground the rationale in recorded Priority, Depends on, and item status — never in time estimates
   - End with the concrete Ship command: `/ship:start "{item}"`, or `/ship:resume` when its Ship feature is already in progress

8. **Parallel-style questions** ("what can run in parallel?", "what's safe to work on at the same time?"):
   - List items whose dependencies are all satisfied and that do not depend on each other
   - Group them as independent lanes, each ending with its Ship command

9. **Decision/history questions** ("why did we…", "when was X decided?"):
   - Answer from DECISIONS.md entries (date, title, rationale)

10. **Anything else:** answer from state plus live reality, staying at project altitude — milestones, priorities, dependencies, blockers. Point at feature-level commands (`/ship:status`, `/ship:resume`) for feature internals.

## Dashboard freshness

11. If `.project-manager/dashboard.html` is missing, or state is newer than the dashboard (regenerate when it is missing or when a drift note was shown in step 5), regenerate it per the pm-state procedure. This is this skill's only write, always inside `.project-manager/`.

## Hard rules

- Never write outside .project-manager/ — and inside it, only `dashboard.html`. ROADMAP.md and DECISIONS.md change only through `/ship:pm-sync`.
- Never begin implementation work — every recommendation ends with a Ship command handoff (`/ship:start "{item}"`, `/ship:resume`, `/ship:pm-sync`).
- No time estimates in answers — reason only from priority order, status, and dependencies.

$ARGUMENTS
