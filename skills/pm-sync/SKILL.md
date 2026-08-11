---
name: ship:pm-sync
description: Use when setting up or updating the project manager — bootstraps the five .project-manager/ state files (ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, dashboard.html) on first run, thereafter reconciles them with repo reality and grows a legacy directory into the enriched shape
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[what to capture (optional)]"
---

Set up or update the project-manager state in `.project-manager/`.

## Setup

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` first — it defines the five state-file formats (ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, dashboard.html), the `decisions/` spill-file convention, the status mapping table, and the hard rules. Everything below assumes those formats.

2. Check for `.project-manager/ROADMAP.md`:
   - Missing → run the **Bootstrap flow**.
   - Present and parseable → run the **Reconcile flow**.
   - Present but malformed → see **Error handling**.

## Bootstrap flow (first run)

1. **Scan reality:**
   - README (project name, purpose)
   - `git log --oneline -30` (recent direction of work)
   - `.planning/features/*/CONTEXT.md` (active Ship features and their frontmatter statuses)
   - `.planning/archive/` (completed Ship features) **and** whether each archived feature has a `VERIFY.md` recording an actual result — a shipped feature whose verify gate never ran is verification debt and becomes a backlog item
   - `git status` and the current branch versus its upstream (feeds STATUS.md repo hygiene)

2. **Draft a proposal:** milestones grouping the work you found, plus backlog items per milestone. Where an item corresponds to a Ship feature, record its slug in the Ship feature column and derive its Status from the pm-state mapping table. Every item carries a **Source** — the scan evidence it came from (a `VERIFY.md` line reference, a CHANGELOG section, a `file:line`); an item you cannot point at does not go in the draft. Give each item an optional **Size** (`S | M | L | XL`, `—` when unsized). Leave Priority (**P0–P3**) and Depends on as your best guess — the interview confirms them.

3. **Interview via AskUserQuestion** (multiple rounds allowed — do not write anything until the user has confirmed):
   - Present the draft milestones and backlog; confirm, rename, add, or drop.
   - Confirm priorities (P0/P1/P2/P3) for each item.
   - Capture dependencies between items (Depends on column).
   - Ask about work currently **in flight** — what is started but not shipped, and at what stage (for STATUS.md).
   - Ask about current blockers **with their reasoning** — what is blocked, on what, and what would unblock it (items to mark `blocked`, plus STATUS.md's `## Blocked` section).
   - Ask whether any decisions are worth recording (what was decided and why).
   - Ask whether any project conventions are worth writing down — rules a fresh session should follow (for CONVENTIONS.md).

4. **Write state** (all inside `.project-manager/`) — five files:
   - `ROADMAP.md` per the pm-state format, with `project`, today's date as `updated`, and the 7-column backlog table.
   - `STATUS.md` — all five sections, populated from the scan and the interview.
   - `DECISIONS.md` — seed with any decisions captured in the interview; otherwise just the `# Decisions` title.
   - `CONVENTIONS.md` — seed with the confirmed conventions; otherwise the `# Conventions` title plus a starter rule noting that conventions are appended here as they are discovered.
   - `dashboard.html` — regenerate per the pm-state procedure.

   Create the `decisions/` subdirectory only when a spill file is actually written.

## Reconcile flow (ROADMAP.md exists)

1. **Re-read reality:** `.planning/features/*/CONTEXT.md` statuses, `.planning/archive/` directory names and whether each archived feature's `VERIFY.md` records a result, recent `git log --oneline -30`, and `git status` plus the current branch versus its upstream.

2. **Auto-update statuses:** apply the pm-state status mapping table to every backlog item that has a Ship feature slug. Only the Status cell changes automatically — never touch names, priorities, sizes, sources, or dependencies without asking. Bump `updated` in the frontmatter to today's date.

   STATUS.md's `## In flight`, `## Recently shipped`, and `## Repo hygiene` sections are also refreshed from reality — they are a snapshot, not user-authored judgment. `## Blocked` and its reasoning are **never** auto-written: blockers are a PM judgment, confirmed in the interview.

3. **Growth path (v5.3.0 → enriched):** if ROADMAP.md parses but carries the legacy 5-column header (`| Item | Status | Priority | Depends on | Ship feature |`), or `STATUS.md` / `CONVENTIONS.md` are absent, this is a **legacy directory, not damage**. Report exactly what is missing, then ask once via AskUserQuestion whether to grow it.
   - **On confirmation:** rewrite each backlog table to the 7-column header, preserving every existing cell value; set `Size` to `—` for every existing row; and fill `Source` per row from the interview. Never fabricate a Source — where the user cannot name one, mark the item for review in the wrap-up report rather than inventing provenance. Then create the missing files (`STATUS.md`, `CONVENTIONS.md`) per the Bootstrap write step.
   - **On decline:** leave the directory untouched and continue the reconcile against the legacy shape, which stays fully supported.

4. **Interview only about genuine gaps** (AskUserQuestion, skip anything already settled):
   - New work visible in features/git that has no roadmap item — add it?
   - Items whose priority, size, or dependencies look stale against reality.
   - Items whose `Source` is missing or stale — what does this item point at?
   - Current blockers and their reasoning.
   - Decisions made since the last sync worth logging, and conventions worth recording in CONVENTIONS.md.
   - When `$ARGUMENTS` is provided, treat it as the user's hint about what to capture and start there.

5. **Persist:** apply confirmed roadmap edits, refresh STATUS.md, append any new decisions to `DECISIONS.md` (newest first, spilling to `decisions/{YYYY-MM-DD}-{slug}.md` when longer than three lines), append any new conventions to `CONVENTIONS.md`, and regenerate `dashboard.html` per the pm-state procedure if anything changed. If nothing changed, say so and write nothing.

## Error handling

If `ROADMAP.md` exists but is malformed (missing frontmatter, broken milestone headings, unparseable backlog table): say so, show what was parseable, and offer to rebuild it via the Bootstrap flow. Never silently overwrite user content without confirmation.

A legacy 5-column table, or a missing `STATUS.md` / `CONVENTIONS.md` / `decisions/`, is **not** malformed — that is the Growth path, not error handling.

## Hard rules

- Write only inside .project-manager/ — never modify `.planning/`, source files, or anything else. (The wider PM write boundary belongs to the `ship-pm` agent behind `/ship:pm`; this command stays narrow.)
- Never start implementation work. This command captures and reconciles state; it always ends by pointing at what to do next (e.g. `/ship:start "{item}"` for the top-priority unstarted item, or `/ship:resume` for one already in flight).
- Never impose a commit-vs-gitignore policy for `.project-manager/` — that is the repo owner's choice.
- No time concepts in state files per pm-state: no deadlines, no time estimates, no day/week/sprint sizing, no velocity. Sizing by plan effort (`S | M | L | XL`) **is** permitted — it is complexity, not duration. Timestamps are permitted in STATUS.md (`updated`, when something shipped) and in DECISIONS.md entry dates.

## Wrap up

End with a short summary block:

```
## PM Sync

Changed: {what changed, or "nothing — state already in sync"}
Grown: {what the growth path added, omit this line when it did not run}
Top priority: {highest-priority actionable item}
Next: {suggested Ship command, e.g. /ship:start "{item}"}
```

$ARGUMENTS
