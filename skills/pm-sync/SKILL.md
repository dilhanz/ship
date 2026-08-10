---
name: ship:pm-sync
description: Use when setting up or updating the project manager — bootstraps .project-manager/ on first run, thereafter reconciles PM state with repo reality and captures missing milestones, decisions, and priorities
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[what to capture (optional)]"
---

Set up or update the project-manager state in `.project-manager/`.

## Setup

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` first — it defines the ROADMAP.md, DECISIONS.md, and dashboard.html formats, the status mapping table, and the hard rules. Everything below assumes those formats.

2. Check for `.project-manager/ROADMAP.md`:
   - Missing → run the **Bootstrap flow**.
   - Present and parseable → run the **Reconcile flow**.
   - Present but malformed → see **Error handling**.

## Bootstrap flow (first run)

1. **Scan reality:**
   - README (project name, purpose)
   - `git log --oneline -30` (recent direction of work)
   - `.planning/features/*/CONTEXT.md` (active Ship features and their frontmatter statuses)
   - `.planning/archive/` (completed Ship features)

2. **Draft a proposal:** milestones grouping the work you found, plus backlog items per milestone. Where an item corresponds to a Ship feature, record its slug in the Ship feature column and derive its Status from the pm-state mapping table. Leave Priority and Depends on as your best guess — the interview confirms them.

3. **Interview via AskUserQuestion** (multiple rounds allowed — do not write anything until the user has confirmed):
   - Present the draft milestones and backlog; confirm, rename, add, or drop.
   - Confirm priorities (P1/P2/P3) for each item.
   - Capture dependencies between items (Depends on column).
   - Ask about current blockers (items to mark `blocked`).
   - Ask whether any decisions are worth recording (what was decided and why).

4. **Write state** (all inside `.project-manager/`):
   - `ROADMAP.md` per the pm-state format, with `project` and today's date as `updated`.
   - `DECISIONS.md` — seed with any decisions captured in the interview; otherwise just the `# Decisions` title.
   - `dashboard.html` — regenerate per the pm-state procedure.

## Reconcile flow (ROADMAP.md exists)

1. **Re-read reality:** `.planning/features/*/CONTEXT.md` statuses, `.planning/archive/` directory names, and recent `git log --oneline -30`.

2. **Auto-update statuses:** apply the pm-state status mapping table to every backlog item that has a Ship feature slug. Only the Status cell changes automatically — never touch names, priorities, or dependencies without asking. Bump `updated` in the frontmatter to today's date.

3. **Interview only about genuine gaps** (AskUserQuestion, skip anything already settled):
   - New work visible in features/git that has no roadmap item — add it?
   - Items whose priority or dependencies look stale against reality.
   - Decisions made since the last sync worth logging.
   - When `$ARGUMENTS` is provided, treat it as the user's hint about what to capture and start there.

4. **Persist:** apply confirmed roadmap edits, append any new decisions to `DECISIONS.md` (newest first), and regenerate `dashboard.html` per the pm-state procedure if anything changed. If nothing changed, say so and write nothing.

## Error handling

If `ROADMAP.md` exists but is malformed (missing frontmatter, broken milestone headings, unparseable backlog table): say so, show what was parseable, and offer to rebuild it via the Bootstrap flow. Never silently overwrite user content without confirmation.

## Hard rules

- Write only inside .project-manager/ — never modify `.planning/`, source files, or anything else.
- Never start implementation work. This command captures and reconciles state; it always ends by pointing at what to do next (e.g. `/ship:start "{item}"` for the top-priority unstarted item, or `/ship:resume` for one already in flight).
- Never impose a commit-vs-gitignore policy for `.project-manager/` — that is the repo owner's choice.
- No time concepts in state files per pm-state: no deadlines, estimates, or sizing (DECISIONS.md entry dates are the only exception).

## Wrap up

End with a short summary block:

```
## PM Sync

Changed: {what changed, or "nothing — state already in sync"}
Top priority: {highest-priority actionable item}
Next: {suggested Ship command, e.g. /ship:start "{item}"}
```

$ARGUMENTS
