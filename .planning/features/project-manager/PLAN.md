---
feature: "project-manager"
goal: "Add a lightweight PM layer to Ship — /ship:pm question router + /ship:pm-sync interactive sync, markdown state in .project-manager/, a static dashboard.html, and a hook nudge when Ship feature statuses drift"
---

## Exploration Summary

**Similar patterns:**
- `skills/status/SKILL.md` — closest user-invocable skill shape: frontmatter (`name: ship:status`, `description`, `effort`, `allowed-tools`), numbered inline instructions, `$ARGUMENTS` at the end.
- `skills/start/SKILL.md:39` — inline skills read plugin files via `${CLAUDE_PLUGIN_ROOT}/...` paths (the plugin system substitutes the root).
- `skills/deviation-rules/SKILL.md`, `skills/git-commits/SKILL.md` — reference-skill pattern: shared conventions in a non-lifecycle SKILL.md that other components read.
- `hooks/guide.cjs` — stdin→stdout hook emitting `hookSpecificOutput.additionalContext`; silent-fail try/catch wrapper; reuses `hooks/scan-features.cjs` (`scanFeatures(cwd)` returns `{name, status, ...}` for non-done features).
- `hooks/scan-features.cjs:40` — frontmatter status regex `/^status:\s*(.+)$/m`; archive detection is NOT covered there (done features are simply skipped), so archive checks are the hook's own job.
- `tests/post-compact.test.js` — hook test pattern: spawn hook with `process.execPath`, tmpdir cwd via `fs.mkdtempSync`, JSON on stdin, parse stdout, assert on `additionalContext`.
- `ship/templates/VERIFY.md` — runtime-read template precedent; dashboard template goes beside it.

**Architecture:** skills auto-discovered from `skills/*/SKILL.md`, auto-namespaced `ship:{dir}`; hooks registered declaratively in `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` command paths (PostToolUse already has one entry with matcher `Write|Edit|Bash|Agent`); feature reality lives in `.planning/features/{slug}/CONTEXT.md` frontmatter and `.planning/archive/{slug}/` for completed work.

**Conventions:** zero npm dependencies (Node built-ins only); hooks never throw or block; `node --test` with files in `tests/` (Windows/Node 22: `node --test "tests/pm-nudge.test.js"` file-glob form, never the directory form); skill descriptions in "Use when…" trigger format; commits `feat(project-manager): …`.

## Research Notes

Domain familiar — no research needed.

## Decisions

- **ROADMAP.md format (settles CONTEXT open question):** YAML frontmatter (`project`, `updated`), a `## Milestones` section where each milestone is `### M{n} — {Name} (status: active|pending|done)` with a one-line `Goal:` and a backlog table `| Item | Status | Priority | Depends on | Ship feature |`. Item statuses: `pending | in-progress | blocked | done`. Priorities: `P1 | P2 | P3`. `Depends on`: comma-separated item names or `—`. `Ship feature`: the `.planning/features/{slug}` slug or `—`. Rationale: human-readable, git-diffable, and table rows are trivially regex-parseable by the nudge hook.
- **PM↔Ship status mapping (for drift detection):** a Ship feature found in `.planning/archive/{slug}/` or with CONTEXT status `done` maps to item status `done`; any other existing Ship status maps to `in-progress`. Recorded `blocked` is a PM judgment and never counts as drift against an active feature. A slug found nowhere (features/ nor archive/) is ignored — never flagged, since `.planning/` may be gitignored or pruned. Rationale: no false nudges.
- **Shared conventions live in a reference skill** (`skills/pm-state/SKILL.md`), read at runtime by both PM skills via `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` — same pattern as deviation-rules/git-commits. Rationale: one source of truth for the state format; no drift between pm and pm-sync.
- **Nudge hook event:** new PostToolUse entry with matcher `Write|Edit` running `hooks/pm-sync-nudge.cjs`. Fast-exit when `.project-manager/ROADMAP.md` is absent. Debounced via a divergence-set hash persisted to `.project-manager/.nudge-state.json` so the same drift nudges once, and new drift nudges again. Rationale: status changes happen through Write/Edit of CONTEXT.md; debounce prevents spam on every file write.
- **Dashboard generation is template-fill by Claude, no build step:** the skill reads `ship/templates/dashboard.html`, replaces `<!-- PM:* -->` placeholder blocks, writes `.project-manager/dashboard.html`. If the template is unreadable (legacy install), the skill generates an equivalent minimal page from the structure documented in pm-state. Rationale: zero dependencies, graceful degradation per CONTEXT NFR.
- **Docs touched: CLAUDE.md and `skills/help/SKILL.md` command list.** CONTEXT rules out modifying lifecycle skills; help is pure reference documentation and omitting the PM commands there would make them undiscoverable. Flagged as a deliberate, narrow exception.
- **`/ship:pm` is read-only over state files** (answers from ROADMAP/DECISIONS plus live `.planning` reads for freshness, flags drift, recommends `/ship:pm-sync`); its only write is regenerating `dashboard.html` when missing or older than the state files. All mutation of ROADMAP/DECISIONS happens in `/ship:pm-sync`. Rationale: matches the "question router" decision and keeps the mutation surface in one command.

## Must Deliver

- `/ship:pm-sync` bootstraps `.project-manager/` via guided interview (scan → propose → confirm) and creates ROADMAP.md, DECISIONS.md, dashboard.html
- `/ship:pm <question>` answers with a specific recommendation, rationale from priorities/dependencies, and a Ship command handoff; no args → high-level brief
- `/ship:pm` identifies parallel-safe items from recorded dependencies
- `dashboard.html` is single-file, self-contained, `file://`-openable, no network requests, regenerated by PM commands that changed state
- Hook injects a sync nudge when Ship feature statuses drift from ROADMAP.md; `/ship:pm-sync` reconciles
- PM never writes outside `.project-manager/`, never implements — recommendations hand off to Ship commands
- No dates-as-deadlines, estimates, or sizing in PM state (decision-log timestamps allowed)

## Acceptance Coverage Map

```
Criterion 1 (pm-sync bootstrap creates 3 files)        → Task 1 (formats) + Task 2 (template) + Task 3 (pm-sync skill)
Criterion 2 (pm answers next + no-arg brief)           → Task 4 (pm skill)
Criterion 3 (parallel-safe identification)             → Task 1 (Depends-on column) + Task 4 (parallel question flow)
Criterion 4 (self-contained dashboard, regen on change)→ Task 2 (template) + Tasks 3,4 (regen procedure) + Task 8 (self-containment test)
Criterion 5 (hook nudge; sync reflects new status)     → Task 5 (hook) + Task 6 (registration) + Task 3 (reconcile flow) + Task 7 (hook tests)
Criterion 6 (no writes outside .project-manager, handoff) → Tasks 3,4 (explicit rules in both skill bodies)
Criterion 7 (no time concepts)                         → Task 1 (format spec forbids them) + Task 8 (wiring test greps skills for the rule)
```

---

<phase id="1" name="State conventions and dashboard template" status="done">

<task id="1" status="done" commit="5c6031a">
  <name>Create pm-state reference skill defining the .project-manager state format</name>
  <files>skills/pm-state/SKILL.md</files>
  <reference>skills/git-commits/SKILL.md — reference-skill shape (conventions doc, not a user command)</reference>
  <action>Create `skills/pm-state/SKILL.md` with frontmatter `name: ship:pm-state` and description "Use when reading or writing .project-manager/ state files — defines the ROADMAP.md, DECISIONS.md, and dashboard.html formats shared by /ship:pm and /ship:pm-sync". Body documents, with a complete example of each file:
  1. **ROADMAP.md**: YAML frontmatter `project: "{name}"` and `updated: "{YYYY-MM-DD}"`; `## Milestones` section; each milestone as heading `### M{n} — {Name} (status: active|pending|done)` followed by `Goal: {one line}` and a table with exact header `| Item | Status | Priority | Depends on | Ship feature |`. Item Status ∈ pending|in-progress|blocked|done. Priority ∈ P1|P2|P3. Depends on = comma-separated item names or `—`. Ship feature = feature slug matching `.planning/features/{slug}` (or archive) or `—`.
  2. **DECISIONS.md**: `# Decisions` title, newest first, entries as `## {YYYY-MM-DD} — {title}` with a 1–3 line body stating what was decided and why.
  3. **dashboard.html regeneration procedure**: read `${CLAUDE_PLUGIN_ROOT}/ship/templates/dashboard.html`, replace each `<!-- PM:NAME -->` placeholder (PROJECT, UPDATED, MILESTONES, NEXT, BLOCKERS, DECISIONS) with generated HTML derived only from ROADMAP.md and DECISIONS.md, write to `.project-manager/dashboard.html`. If the template cannot be read, generate a minimal self-contained page with the same sections. The output must stay single-file with no external requests.
  4. **Hard rules**: no dates-as-deadlines, no estimates, no sizing anywhere in state files (DECISIONS.md entry dates are allowed); PM state duplicates nothing that `.planning/features/` already records (link by slug instead); the folder's git policy (commit vs ignore) belongs to the repo owner — never impose it.
  5. **Status mapping table** for reconciliation: Ship `done`/archived → item `done`; any other existing Ship status → item `in-progress`; recorded `blocked` never auto-overridden; slug found nowhere → leave item untouched.</action>
  <verify>grep -q "ship:pm-state" skills/pm-state/SKILL.md && grep -q "| Item | Status | Priority | Depends on | Ship feature |" skills/pm-state/SKILL.md && grep -q "no estimates" skills/pm-state/SKILL.md</verify>
</task>

<task id="2" status="done" commit="9d6d9cc">
  <name>Create the self-contained dashboard HTML template</name>
  <files>ship/templates/dashboard.html</files>
  <reference>ship/templates/VERIFY.md — runtime-read template precedent (location and role only; content is new)</reference>
  <action>Create `ship/templates/dashboard.html`: a complete, single-file, static HTML page with inline CSS only (no JavaScript needed — the page is read-only), designed to open via `file://`. Structure: header with project name (`<!-- PM:PROJECT -->`) and last-updated line (`<!-- PM:UPDATED -->`); a "Work on next" callout section (`<!-- PM:NEXT -->`); a milestones section with per-milestone cards showing name, status badge, goal, and a CSS-only progress bar of done/total items (`<!-- PM:MILESTONES -->`); a blockers section (`<!-- PM:BLOCKERS -->`); a recent-decisions section (`<!-- PM:DECISIONS -->`). Each placeholder is an HTML comment on its own line that the PM skills replace with generated markup. Visual design: minimal, readable, system font stack, works in light and dark via `prefers-color-scheme`. HARD CONSTRAINTS: zero external references — no `<script src`, no `<link` to stylesheets, no `url(http...)`, no fetch/XHR, no `http://` or `https://` substrings anywhere in the file (use no SVG namespaces; use unicode glyphs for any icons).</action>
  <verify>grep -q "PM:MILESTONES" ship/templates/dashboard.html && ! grep -qE "https?://" ship/templates/dashboard.html && ! grep -qi "<script src\|<link" ship/templates/dashboard.html</verify>
</task>

</phase>

<phase id="2" name="PM skills" status="done">

<task id="3" status="done" commit="365aae1" depends="1,2">
  <name>Create the /ship:pm-sync interactive bootstrap and reconcile skill</name>
  <files>skills/pm-sync/SKILL.md</files>
  <reference>skills/start/SKILL.md — inline interactive skill shape (AskUserQuestion in main conversation, ${CLAUDE_PLUGIN_ROOT} file reads)</reference>
  <action>Create `skills/pm-sync/SKILL.md` with frontmatter: `name: ship:pm-sync`, description "Use when setting up or updating the project manager — bootstraps .project-manager/ on first run, thereafter reconciles PM state with repo reality and captures missing milestones, decisions, and priorities", `effort: high`, `allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion`, `argument-hint: "[what to capture (optional)]"`. Body instructions:
  1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` first for the state formats.
  2. **Bootstrap flow** (no `.project-manager/ROADMAP.md`): scan README, `git log --oneline -30`, `.planning/features/*/CONTEXT.md`, and `.planning/archive/`; draft proposed milestones + backlog items (with Ship-feature slugs where they map); present the draft and interview via AskUserQuestion (multiple rounds allowed: confirm milestones, priorities, dependencies, blockers, and any decisions worth recording); write ROADMAP.md, DECISIONS.md (seed with any decisions captured, else just the title), and regenerate dashboard.html per pm-state procedure.
  3. **Reconcile flow** (ROADMAP.md exists): re-read reality (`.planning/features`, `.planning/archive`, recent git log); apply the pm-state status-mapping table to update item statuses; bump `updated` in frontmatter; then interview only about genuine gaps — new work not in the roadmap, items whose priority/dependencies look stale, decisions made since last sync ($ARGUMENTS, when provided, is the user's hint about what to capture); append any new decisions to DECISIONS.md; regenerate dashboard.html if anything changed.
  4. **Error handling**: if ROADMAP.md exists but is malformed, say so, show what was parseable, and offer to rebuild it via the bootstrap flow (never silently overwrite user content without confirmation).
  5. **Hard rules stated in the body**: write only inside `.project-manager/`; never start implementation work — end with what to do next (e.g. `/ship:start "{item}"` for the top-priority unstarted item); never impose commit-vs-gitignore; no time concepts per pm-state.
  6. End by displaying a short summary block: what changed, current top priority, and suggested next command.</action>
  <verify>grep -q "ship:pm-sync" skills/pm-sync/SKILL.md && grep -q "pm-state/SKILL.md" skills/pm-sync/SKILL.md && grep -q "AskUserQuestion" skills/pm-sync/SKILL.md && grep -qi "only inside .project-manager" skills/pm-sync/SKILL.md</verify>
</task>

<task id="4" status="done" commit="2256b23" depends="1,2">
  <name>Create the /ship:pm question-router skill</name>
  <files>skills/pm/SKILL.md</files>
  <reference>skills/status/SKILL.md — read-mostly inline skill shape with $ARGUMENTS routing</reference>
  <action>Create `skills/pm/SKILL.md` with frontmatter: `name: ship:pm`, description "Use when asking project-level questions — what to work on next, what can run in parallel, milestone status, blockers, or why something was decided", `effort: medium`, `allowed-tools: Read, Write, Glob, Grep`, `argument-hint: "[question]"`. Body instructions:
  1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pm-state/SKILL.md` for formats. If `.project-manager/ROADMAP.md` is missing or unparseable, say the PM isn't set up (or is damaged) and point to `/ship:pm-sync` — do not error out, do not create files other than the dashboard.
  2. Load `.project-manager/ROADMAP.md` + `DECISIONS.md`, and read live reality (`.planning/features/*/CONTEXT.md` statuses, `.planning/archive/` names) so answers reflect the repo as it is now. If recorded statuses drift from reality per the pm-state mapping table, note the drift inline and recommend `/ship:pm-sync` — but do NOT edit ROADMAP.md.
  3. **Route on $ARGUMENTS**: (a) empty → high-level brief: each milestone with progress (done/total items), current blockers, top 1–3 priorities, and a single "work on next" recommendation; (b) next-style questions → one specific recommended item with rationale grounded in recorded Priority, Depends on, and item status (dependencies satisfied = all its Depends-on items done), ending with the concrete Ship command (`/ship:start "{item}"`, or `/ship:resume` when its Ship feature is already in progress); (c) parallel-style questions → list items whose dependencies are all satisfied and that don't depend on each other, grouped as independent lanes; (d) decision/history questions → answer from DECISIONS.md; (e) anything else → answer from state + reality, staying at project altitude.
  4. **Dashboard freshness**: if `dashboard.html` is missing or older than ROADMAP.md/DECISIONS.md (compare file modification order via Read failures or Bash-free heuristics — simply regenerate when missing or when a drift note was shown), regenerate it per the pm-state procedure. This is the skill's only write, always inside `.project-manager/`.
  5. **Hard rules stated in the body**: never write outside `.project-manager/`; never begin implementation — every recommendation ends with a Ship command handoff; no time estimates in answers (priority/dependency reasoning only).</action>
  <verify>grep -q "ship:pm" skills/pm/SKILL.md && grep -q "pm-state/SKILL.md" skills/pm/SKILL.md && grep -qi "never write outside" skills/pm/SKILL.md && grep -q "ship:pm-sync" skills/pm/SKILL.md</verify>
</task>

</phase>

<phase id="3" name="Sync nudge hook, tests, and docs" status="done">

<task id="5" status="done" commit="5617830" depends="1">
  <name>Create the pm-sync-nudge PostToolUse hook</name>
  <files>hooks/pm-sync-nudge.cjs</files>
  <reference>hooks/guide.cjs — stdin→stdout hook with additionalContext injection and silent-fail wrapper; hooks/scan-features.cjs — scanFeatures(cwd)</reference>
  <action>Create `hooks/pm-sync-nudge.cjs`, a zero-dependency Node script (fs, path only, plus require of `./scan-features.cjs`). Flow inside the standard stdin-consume + try/catch-silent pattern:
  1. Fast exits (in order): `.project-manager/ROADMAP.md` missing in cwd → exit 0 with no output.
  2. Parse ROADMAP.md backlog rows with a line regex over table rows `| item | status | priority | depends | slug |` (5 pipe-delimited cells; skip the header row, the `---` separator row, and rows whose slug cell is `—` or empty). Collect `{slug, recorded}` pairs where recorded is the trimmed Status cell.
  3. Determine actual coarse status per slug: if `.planning/archive/{slug}/` exists OR `.planning/features/{slug}/CONTEXT.md` has frontmatter status `done` → `done`; else if the slug appears in `scanFeatures(cwd)` → `in-progress`; else → `unknown`.
  4. Drift rules: actual `done` and recorded ≠ `done` → drift; actual `in-progress` and recorded ∈ {`pending`, `done`} → drift; recorded `blocked` never drifts against `in-progress`; actual `unknown` → never drift.
  5. Debounce: build a stable string of `slug:actual` pairs sorted by slug; if `.project-manager/.nudge-state.json` exists and its `lastDrift` equals this string → exit silently. Otherwise write `{ lastDrift }` (best-effort, try/catch around the write) and emit `{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }` where the message lists each drifted item ("{slug}: roadmap says {recorded}, actually {actual}") and ends with "Run /ship:pm-sync to update the project manager state." Empty drift set → write nothing, but if `.nudge-state.json` has a non-empty lastDrift, clear it (so the same drift re-nudges if it reappears later).
  6. The hook must never throw, never block, and never write outside `.project-manager/.nudge-state.json`.</action>
  <verify>node -e "const s=require('fs').readFileSync('hooks/pm-sync-nudge.cjs','utf8');if(!/scan-features/.test(s)||!/nudge-state/.test(s)||!/additionalContext/.test(s))process.exit(1)"</verify>
</task>

<task id="6" status="done" commit="0af79b6" depends="5">
  <name>Register the nudge hook in hooks.json</name>
  <files>hooks/hooks.json</files>
  <reference>hooks/hooks.json — existing PostToolUse entry with matcher and ${CLAUDE_PLUGIN_ROOT} command path</reference>
  <action>Add a second object to the existing `hooks.PostToolUse` array: `{ "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/pm-sync-nudge.cjs" }] }`. Do not modify the existing entries. The file must remain valid JSON.</action>
  <verify>node -e "const h=require('./hooks/hooks.json');const e=h.hooks.PostToolUse.find(x=>x.hooks.some(k=>k.command.includes('pm-sync-nudge')));if(!e||e.matcher!=='Write|Edit')process.exit(1)"</verify>
</task>

<task id="7" status="done" commit="44dac7c" depends="5,6">
  <name>Add behavior tests for the nudge hook</name>
  <files>tests/pm-nudge.test.js</files>
  <reference>tests/post-compact.test.js — spawn-hook-in-tmpdir test pattern with createFeature helper</reference>
  <action>Create `tests/pm-nudge.test.js` using node:test + node:assert/strict, spawning `hooks/pm-sync-nudge.cjs` with tmpdir cwd (reuse the runHook/createFeature helper shapes from tests/post-compact.test.js, adding a `createRoadmap(tmpDir, rows)` helper that writes `.project-manager/ROADMAP.md` with a milestone heading and a backlog table). Cases:
  1. No `.project-manager/` → exit 0, no output.
  2. Roadmap in sync with reality (item `in-progress`, feature exists with status `building`) → no output.
  3. Drift: item recorded `pending`, feature exists with status `building` → output contains the slug and "/ship:pm-sync".
  4. Drift: item recorded `in-progress`, feature dir at `.planning/archive/{slug}/` with a done CONTEXT.md → output flags it as actually done.
  5. Debounce: run the hook twice on the same drifted fixture → first run emits, second run silent; and `.project-manager/.nudge-state.json` exists after the first run.
  6. Recorded `blocked` with active feature → no output.
  7. Slug that exists nowhere → no output.
  8. Malformed ROADMAP.md (garbage content, no table) → exit 0, no output, no crash.</action>
  <verify>node --test "tests/pm-nudge.test.js"</verify>
</task>

<task id="8" status="done" commit="bdd2b60" depends="1,2,3,4,6">
  <name>Add wiring tests for skills, template, and hook registration</name>
  <files>tests/pm-wiring.test.js</files>
  <reference>tests/doctrine-v5-wiring.test.js — static wiring assertions over skill files and registration</reference>
  <action>Create `tests/pm-wiring.test.js` (node:test, plain fs reads, no spawning) asserting:
  1. `skills/pm/SKILL.md`, `skills/pm-sync/SKILL.md`, `skills/pm-state/SKILL.md` all exist; pm and pm-sync have `name:`, `description:` containing "Use when", and `allowed-tools:` lines; both pm and pm-sync bodies reference `pm-state/SKILL.md`.
  2. pm's allowed-tools does NOT include Edit or Bash (read-mostly surface); pm-sync's includes AskUserQuestion.
  3. Both skill bodies contain the no-implementation rule (regex /never (begin|start) implementation/i) and the `.project-manager` write boundary.
  4. `ship/templates/dashboard.html` exists, contains all six `PM:` placeholders (PROJECT, UPDATED, NEXT, MILESTONES, BLOCKERS, DECISIONS), and contains no `http://`, `https://`, `<script src`, or `<link` substrings.
  5. `hooks/hooks.json` parses as JSON and has a PostToolUse entry with matcher `Write|Edit` whose command references `pm-sync-nudge.cjs`.
  6. `skills/pm-state/SKILL.md` contains the exact backlog table header and the no-estimates rule.</action>
  <verify>node --test "tests/pm-wiring.test.js"</verify>
</task>

<task id="9" status="done" commit="c85f932" depends="3,4,6">
  <name>Document the PM layer in CLAUDE.md and the help skill</name>
  <files>CLAUDE.md, skills/help/SKILL.md</files>
  <reference>skills/help/SKILL.md:26 — existing command-reference list format</reference>
  <action>1. `skills/help/SKILL.md`: add two lines to the command reference list — `/ship:pm "question"` (ask the project manager: next item, parallel work, status, decisions) and `/ship:pm-sync` (set up or update project-manager state) — matching the existing alignment/format.
  2. `CLAUDE.md`: update the architecture counts (skills line: 14 → 17, i.e. 13 user-invocable + 4 reference; hooks: 5 → 6 with a `pm-sync-nudge.cjs` line in the hooks block; templates line mentions dashboard.html), and add a short "Project manager" bullet under Key Concepts: two skills, state in `.project-manager/` (ROADMAP.md, DECISIONS.md, dashboard.html), hook-driven sync nudge, no time concepts, PM directs but never implements. Keep it to ~4 lines — CLAUDE.md stays terse.</action>
  <verify>grep -q "ship:pm" skills/help/SKILL.md && grep -q "pm-sync-nudge" CLAUDE.md && grep -q ".project-manager" CLAUDE.md</verify>
</task>

</phase>

## Risk Notes

- **Task 5 — false or missed nudges:** the drift rules deliberately ignore unknown slugs and `blocked` items; if users hand-edit ROADMAP.md into shapes the row regex can't parse, the hook silently does nothing (acceptable — pm-sync reconciles on demand). The debounce file lives inside `.project-manager/`, so repo owners who gitignore the folder never see churn.
- **Task 2 — self-containment regressions:** any later "improvement" adding a CDN font or icon set breaks the file:// / no-network criterion; the wiring test (Task 8, case 4) guards it.
- **Task 3 — overwriting user edits:** the reconcile flow only auto-updates item Status cells per the mapping table; everything else changes only through the interview. Malformed state triggers an offer to rebuild, never a silent overwrite.
- **Task 9 — CLAUDE.md counts:** counts appear in prose in multiple spots; grep for "14 skills" and "5 Node.js hooks" to catch all occurrences, but change only factual counts — don't restructure the doc.
- **Windows verify commands:** all `<verify>` commands use grep/node forms that run under Git Bash (the builder's Bash tool); avoid PowerShell-specific syntax.

## Plan Review

### Outcome — APPROVED

**Rounds:** 1
- Round 1: APPROVED, 0 critical

**Examined:** PLAN.md, CONTEXT.md, hooks/hooks.json, hooks/scan-features.cjs, hooks/guide.cjs, hooks/context-monitor.cjs, skills/status/SKILL.md, skills/start/SKILL.md, skills/help/SKILL.md, tests/post-compact.test.js, tests/doctrine-v5.test.js, tests/doctrine-v5-wiring.test.js, CLAUDE.md skill/hook counts, ship/templates/* glob, skills/*/SKILL.md glob (14 dirs)

**Findings (non-critical):**
- [SUGGESTION] Task 5, hooks/pm-sync-nudge.cjs: debounce spec ambiguous — "stable string of slug:actual pairs sorted by slug" doesn't say whether it covers only drifted items or all mapped items; affects whether resolving one drift while another persists re-nudges. Recommendation: hash only the drifted pairs so any change in the drift set triggers a fresh nudge.
- [SUGGESTION] Task 5, hooks/pm-sync-nudge.cjs: plan checks ".project-manager/ROADMAP.md missing in cwd" via process.cwd() precedent; prefer the PostToolUse stdin cwd field when present, falling back to process.cwd() — one-line hardening consistent with the silent-fail contract.
