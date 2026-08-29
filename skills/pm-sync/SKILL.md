---
name: pm-sync
description: Use when setting up or updating the project manager — bootstraps the five .project-manager/ state files (ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, dashboard.html) on first run, thereafter reconciles them with repo reality and grows a legacy directory into the enriched shape
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[what to capture (optional)]"
---

Set up or update the project-manager state in `.project-manager/`.

## Setup

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` first — it defines the state-file formats (ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, dashboard.html, plus the mechanically-harvested LEDGER.md), the `decisions/` spill-file convention, the status mapping table, and the hard rules. Everything below assumes those formats. **`LEDGER.md` is never authored here** — `ship/pm-update.cjs` creates and appends it, and this skill's only relationship to it is running that script.

2. **Resolve the state root:** `.project-manager/` may live at the main worktree root rather than the cwd. Resolve it with:

   ```bash
   node -e "console.log(JSON.stringify(require(process.argv[1]).resolveStateRoot(process.cwd())))" "${CLAUDE_PLUGIN_ROOT}/ship/resolve-state-root.cjs"
   ```

   (equivalently: `git rev-parse --path-format=absolute --git-common-dir` → its dirname is the main worktree root). When `.project-manager/` is **gitignored**, bootstrap and reconcile target the resolver's `root` — the **main worktree** root, one canonical copy shared by every lane. When it is **tracked**, operate on the cwd exactly as today (per-worktree state) and include one explicit line in the wrap-up noting the fleet view is unavailable while `.project-manager/` is tracked.

3. Check for `{root}/.project-manager/ROADMAP.md` at the resolved state root:
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
   - For each item, ask **blast radius** (who feels it if this stays undone: users / contributors / internal) and **confidence** (is the problem `proven` — demonstrated by evidence you can point at — or `suspected`). Both are optional; `—` is a legitimate answer and is what you record when the user is unsure. Never infer confidence from the shape of the `Source` cell: a precise `file:line` is not proof the problem is real.
   - Ask about work currently **in flight** — what is started but not shipped, and at what stage (for STATUS.md).
   - Ask about current blockers **with their reasoning** — what is blocked, on what, and what would unblock it (items to mark `blocked`, plus STATUS.md's `## Blocked` section).
   - Ask whether any decisions are worth recording (what was decided and why).
   - Ask whether any project conventions are worth writing down — rules a fresh session should follow (for CONVENTIONS.md).

4. **Write state** (all inside `.project-manager/` at the resolved state root) — five files:
   - `ROADMAP.md` per the pm-state format, with `project`, today's date as `updated`, and the fully enriched 12-column backlog table (`| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen | Kind |`). A fresh directory has no legacy shape to preserve, so it starts enriched. Initialize `Lane` and `First seen` to `—` — both are **derived**, populated by `ship/pm-update.cjs` and the sweep, never by the user or by you. `Blast radius` (`users | contributors | internal | —`), `Confidence` (`proven | suspected | —`), and `Kind` (`work | debt`) are **authored**: fill them only from what the interview actually established, and leave `—` otherwise. Every item the interview produces is `work` — a `debt` row is raised only by accepting a `node ship/pm-update.cjs --debt` proposal, never invented here. An absent value reads as `unknown` and produces no priority promotion, which is the safe direction — never guess one to make a row look complete.
   - `STATUS.md` — all five sections, populated from the scan and the interview.
   - `DECISIONS.md` — seed with any decisions captured in the interview; otherwise just the `# Decisions` title.
   - `CONVENTIONS.md` — seed with the confirmed conventions; otherwise the `# Conventions` title plus a starter rule noting that conventions are appended here as they are discovered.
   - `dashboard.html` — regenerate by running `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` from the repo root; the manual pm-state procedure is the fallback only when the script is unreadable.

   Create the `decisions/` subdirectory only when a spill file is actually written.

## Reconcile flow (ROADMAP.md exists)

1. **Re-read reality:** `.planning/features/*/CONTEXT.md` statuses, `.planning/archive/` directory names and whether each archived feature's `VERIFY.md` records a result, recent `git log --oneline -30`, and `git status` plus the current branch versus its upstream.

2. **Auto-update statuses:** run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` from the repo root — it applies the pm-state status mapping table to every backlog item that has a Ship feature slug and bumps the frontmatter `updated` when a Status cell actually changed. Only the Status cell changes automatically — never touch names, priorities, sizes, sources, or dependencies without asking. New rows, priorities, and structural edits stay with the interview and judgment steps below.

   STATUS.md's `## In flight`, `## Recently shipped`, and `## Repo hygiene` sections are also refreshed from reality — they are a snapshot, not user-authored judgment. Refresh `## Lanes` the same way, from `node "${CLAUDE_PLUGIN_ROOT}/ship/lane-sweep.cjs"` output (one line per worktree: branch, path, active feature + stage; "single lane" when only the main worktree exists) — snapshot data, same class as In flight / Repo hygiene. `## Blocked` and its reasoning are **never** auto-written: blockers are a PM judgment, confirmed in the interview.

3. **Growth path (narrower → enriched):** every reader locates columns by header *name*, never by count, so a narrower table is **a legacy directory, not damage** — it stays fully supported indefinitely. Growth happens only here, and only on an explicit confirmation. Detect it when ROADMAP.md parses but carries fewer than the twelve enriched columns — the 5-column header (`| Item | Status | Priority | Depends on | Ship feature |`), the 7-column (`| Item | Status | Priority | Size | Depends on | Source | Ship feature |`), the 8-column (adding `Lane`), the 10-column (adding `Blast radius` and `Confidence` but not `First seen`), or the 11-column (everything but `Kind`) — or when `STATUS.md` / `CONVENTIONS.md` are absent. Report exactly what is missing, then ask once via AskUserQuestion whether to grow it.
   - **On confirmation:** rewrite each backlog table to the 12-column header (`| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen | Kind |`), preserving every existing cell value byte-for-byte. Fill the new cells by their kind:
     - **Derived — initialize to `—`, never author:** `Lane` (the PM populates it from sweep data) and `First seen` (`ship/pm-update.cjs` stamps it the first time it sees the row, and never rewrites it). Writing a date into `First seen` yourself would fabricate a history the script then refuses to correct.
     - **Authored — from the interview only:** `Size` (`—` for every existing row lacking one), `Source` per row, `Blast radius`, `Confidence`, and `Kind` — which is `work` for **every existing row**, without asking: that is the value an absent column already means, so the rewrite preserves today's reconciliation behaviour byte-for-byte. Never promote a row to `debt` while widening. Never fabricate any of them. Where the user cannot name a Source, mark the item for review in the wrap-up report rather than inventing provenance; where they are unsure of blast radius or confidence, record `—`, which reads as `unknown` and produces no priority promotion.
     Then create the missing files (`STATUS.md`, `CONVENTIONS.md`) per the Bootstrap write step.
   - **On decline:** leave the directory untouched and continue the reconcile against the legacy shape. A 5-, 7-, 8-, 10-, or 11-column table parses everywhere; the costs of declining are that `node ship/pm-update.cjs --evidence` reports `needsEvidence: true` and proposes no promotions, and that a table with no `Kind` column cannot hold a `debt` row — both correct rather than degraded.
   - **This is the only path that widens a table.** `pm-update.cjs` never adds a column on its own — it stamps `First seen` into a cell that already exists and does nothing when it does not.

4. **Interview only about genuine gaps** (AskUserQuestion, skip anything already settled):
   - New work visible in features/git that has no roadmap item — add it?
   - Items whose priority, size, or dependencies look stale against reality.
   - Items whose `Source` is missing or stale — what does this item point at?
   - Current blockers and their reasoning.
   - Decisions made since the last sync worth logging, and conventions worth recording in CONVENTIONS.md.
   - When `$ARGUMENTS` is provided, treat it as the user's hint about what to capture and start there.

5. **Persist:** apply confirmed roadmap edits, refresh STATUS.md, append any new decisions to `DECISIONS.md` (newest first, spilling to `decisions/{YYYY-MM-DD}-{slug}.md` when longer than three lines), append any new conventions to `CONVENTIONS.md`, and regenerate `dashboard.html` if anything changed by running `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` (manual pm-state procedure only as fallback when the script is unreadable). If nothing changed, say so and write nothing.

## Error handling

If `ROADMAP.md` exists but is malformed (missing frontmatter, broken milestone headings, unparseable backlog table): say so, show what was parseable, and offer to rebuild it via the Bootstrap flow. Never silently overwrite user content without confirmation.

A table narrower than the enriched twelve columns — 5, 7, 8, 10, or 11 — or a missing `STATUS.md` / `CONVENTIONS.md` / `decisions/`, is **not** malformed; that is the Growth path, not error handling. Nor is a missing `LEDGER.md`: it appears the first time `ship/pm-update.cjs` sees a feature reach `done`, and a project that has shipped nothing correctly has none.

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
Fleet: {omit when gitignored; when `.project-manager/` is tracked: "fleet view unavailable — .project-manager/ is tracked, so PM state is per-worktree"}
Top priority: {highest-priority actionable item}
Next: {suggested Ship command, e.g. /ship:start "{item}"}
```

$ARGUMENTS
