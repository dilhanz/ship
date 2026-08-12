---
name: ship:pm-state
description: Use when reading or writing .project-manager/ state files — defines the ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, and dashboard.html formats shared by /ship:pm, /ship:pm-sync, and the ship-pm agent
effort: medium
user-invocable: false
---

# Project Manager State Conventions

All PM state lives in `.project-manager/` at the repo root. Five files:

- `ROADMAP.md` — milestones + backlog
- `STATUS.md` — narrative snapshot of right now
- `DECISIONS.md` — short dated entries
- `CONVENTIONS.md` — project conventions + learning
- `dashboard.html` — generated, never hand-edited

Plus a `decisions/` subdirectory holding spill files for decisions too long for a DECISIONS.md entry.

This document is the single source of truth for their formats. `/ship:pm`, `/ship:pm-sync`, and the `ship-pm` agent all read it before touching state.

---

## ROADMAP.md

YAML frontmatter with exactly two fields (`project`, `updated`), then a `## Milestones` section. Each milestone is a `### M{n} — {Name} (status: ...)` heading followed by a one-line `Goal:` and a backlog table.

- Milestone status ∈ `active | pending | done`
- Item **Status** ∈ `pending | in-progress | blocked | done`
- **Priority** ∈ `P0 | P1 | P2 | P3`. The key: **P0** live / customer-facing risk · **P1** blocks confidence in shipped work · **P2** strategic feature work · **P3** nice to have.
- **Size** ∈ `S | M | L | XL` by plan effort, or `—` when unsized. Never omit the cell — a row whose cell count differs from the header is dropped by the nudge hook.
- **Depends on** — comma-separated item names from any milestone, or `—` when independent
- **Source** — where the item came from: a `VERIFY.md` line reference, a DECISIONS.md entry title, or a `file:line`. **Mandatory, never `—`. Do not add an item you cannot point at.**
- **Ship feature** — the feature slug matching `.planning/features/{slug}` (or `.planning/archive/{slug}`), or `—` when no Ship feature exists yet

The table header must be exactly:

```
| Item | Status | Priority | Size | Depends on | Source | Ship feature |
```

### Detail sections

An item that needs more room than a row gets a `#### {Item}` heading beneath its milestone, placed after all of that milestone's tables. The section carries prose, history, and strikethroughs for superseded reasoning — the table row stays the index into it.

A detail section never duplicates `.planning/features/` detail. Feature-level acceptance criteria, task lists, and plans live in the feature directory; the detail section records the project-level reasoning that has nowhere else to go.

### Complete example

```markdown
---
project: "acme-api"
updated: "2026-08-10"
---

## Milestones

### M1 — Core auth (status: active)

Goal: Users can sign up, log in, and stay logged in across sessions.

| Item | Status | Priority | Size | Depends on | Source | Ship feature |
|------|--------|----------|------|------------|--------|--------------|
| User model | done | P1 | M | — | 2026-07-02 — Auth owns identity | user-model |
| Session tokens | in-progress | P1 | L | User model | session-tokens VERIFY.md L14 | session-tokens |
| Password reset | pending | P2 | — | Session tokens | src/auth/reset.ts:41 | — |

#### Session tokens

Opaque tokens with a server-side store, rotated on privilege change. ~~Originally scoped as JWTs~~ —
superseded by the 2026-08-10 decision after the revocation requirement landed. The remaining work is
the rotation path; the issue/verify path shipped.

### M2 — Billing (status: pending)

Goal: Paid plans with usage-based invoicing.

| Item | Status | Priority | Size | Depends on | Source | Ship feature |
|------|--------|----------|------|------------|--------|--------------|
| Stripe integration | pending | P1 | L | Session tokens | 2026-08-01 — Billing waits for auth | — |
| Usage metering | blocked | P2 | M | — | docs/billing-brief.md:12 | — |
```

## STATUS.md

The narrative snapshot: what is true right now, including the work that lands outside git and is therefore invisible to `git log` (a deploy, a manual drill, a support escalation, an unverified release). ROADMAP.md changes slowly; STATUS.md changes every session.

A `# {project} — Status` title, frontmatter with `updated: "{YYYY-MM-DD}"`, then these sections in order:

- `## In flight` — work started but not shipped. One entry per item, each naming its Ship feature and current stage.
- `## Live status` — production / runtime issues, or "None recorded".
- `## Blocked` — each blocker with its reasoning: what is blocked, on what, and what would unblock it.
- `## Recently shipped` — with any missing verify gate called out explicitly.
- `## Repo hygiene` — branches, worktrees, divergence from origin.

### Complete example

```markdown
---
updated: "2026-08-10"
---

# acme-api — Status

## In flight

- **Session tokens** (`session-tokens`) — built, verify gate not yet run.

## Live status

None recorded.

## Blocked

- **Usage metering** — blocked on the metering schema, which depends on whether plans are
  per-seat or per-request. A decision on plan shape would unblock it.

## Recently shipped

- **User model** (`user-model`) — shipped 2026-07-28, VERIFY.md records all criteria proven.

## Repo hygiene

- `main` clean, in sync with origin. No stale worktrees.
```

## DECISIONS.md

A `# Decisions` title, entries newest first. Each entry is `## {YYYY-MM-DD} — {title}` with a **1–3 line body** stating what was decided and why. Entry dates are timestamps of when the decision was made, never deadlines.

- A decision needing more room than three lines gets its own file at `.project-manager/decisions/{YYYY-MM-DD}-{slug}.md`, and the short entry ends with `See decisions/{YYYY-MM-DD}-{slug}.md`.
- Append at the top, never rewrite. Superseding a decision means writing a new one that names what it supersedes and why — the old entry stays.
- Same-day entries get distinct topical titles, never "(latest)".

### Complete example

```markdown
# Decisions

## 2026-08-10 — Sessions use opaque tokens, not JWTs

Opaque tokens with a server-side store; revocation must be immediate
and the team has been burned by JWT invalidation before.
See decisions/2026-08-10-opaque-tokens.md

## 2026-08-01 — Billing waits for auth

Stripe integration depends on stable session identity, so M2 stays
pending until Session tokens is done.
```

## CONVENTIONS.md

A `# Conventions` title and a flat bulleted list of project conventions. Each bullet is a rule a fresh session could follow without further context.

PM-maintained with a learning loop: when a recurring failure mode or an unwritten convention surfaces, append a rule here rather than leaving it in the conversation. The test is whether a fresh session tomorrow would know it.

Deliberately named `CONVENTIONS.md` rather than `README.md` so it can never be confused with a repo README.

### Complete example

```markdown
# Conventions

- Migrations run in a transaction; a migration that cannot is split into two.
- Every background job is idempotent — retries are assumed, not exceptional.
- Integration tests hit a real database; mocks masked a broken migration once already.
- Release notes are written from the CHANGELOG, never from the commit log.
```

## dashboard.html regeneration procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` from the repo root. With no slugs it regenerates `.project-manager/dashboard.html` from the state files and template, and reconciles every slugged row's Status per the status mapping table below, in one pass.

**Manual fallback** — only when the script is unreadable (legacy install), fill the template by hand:

1. Read the template at `${CLAUDE_PLUGIN_ROOT}/ship/templates/dashboard.html`.
2. Replace each placeholder comment — `<!-- PM:PROJECT -->`, `<!-- PM:UPDATED -->`, `<!-- PM:NEXT -->`, `<!-- PM:INFLIGHT -->`, `<!-- PM:MILESTONES -->`, `<!-- PM:BLOCKERS -->`, `<!-- PM:DECISIONS -->` — with HTML generated **only** from the state files:
   - **PM:PROJECT** — the `project` frontmatter value.
   - **PM:UPDATED** — "Last synced {updated}".
   - **PM:NEXT** — the recommended next item: highest-priority non-done, non-blocked item whose Depends-on items are all done; include its milestone and priority. `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --next` prints the same selection as JSON and is the single home of this rule.
   - **PM:INFLIGHT** — STATUS.md's `## In flight` entries. "No in-flight work recorded" when STATUS.md is absent or the section is empty.
   - **PM:MILESTONES** — one card per milestone: name, status badge, goal, done/total item count with a progress bar (inline styles or template CSS classes only), and the item rows, which now render Size and Source cells too.
   - **PM:BLOCKERS** — every item with Status `blocked` (item name, milestone), plus its reasoning from STATUS.md's `## Blocked` section when a matching entry exists. "No blockers" when none.
   - **PM:DECISIONS** — the 5 most recent DECISIONS.md entries (date, title, body).
3. Write the result to `.project-manager/dashboard.html`.
4. If the template cannot be read (legacy install), generate a minimal self-contained page with the same sections from scratch.

The output must stay a single file: inline CSS only, no JavaScript required, no external references of any kind (no `http://`/`https://` URLs, scripts, stylesheets, fonts, or images). It must render via `file://` with zero network requests.

## Hard rules

1. **No time concepts:** no deadlines, no time estimates, no day/week/sprint sizing, no velocity. Sizing by plan effort (`S | M | L | XL`) **is** permitted — it is complexity, not duration. Timestamps are permitted in STATUS.md (`updated`, when something shipped) and in DECISIONS.md entry dates; they record when something happened and are never deadlines.
2. **No duplication of `.planning/features/`:** PM state links to Ship features by slug; it never copies acceptance criteria, task lists, or feature-level detail that `.planning/features/{slug}/` already records.
3. **Git-neutral:** whether `.project-manager/` is committed or gitignored is the repo owner's choice — never impose it, never suggest one over the other.
4. **Write boundary:** the PM layer writes `.project-manager/**`, `.planning/**`, `.claude/**`, and root `*.md`, and runs git (`add`, `commit`, `push`, `status`, `log`, `diff`, `worktree prune`) for the files it owns. It never edits application source and never rewrites published history (`reset --hard`, `push --force`, `rebase`). Claude Code cannot scope a subagent's writes by path, so this is discipline, not machinery — being about to edit source is the signal to hand off.
5. **Never invent status:** any claim not verifiable from a file, a command, or git is reported as `unverified` with a named next step that would settle it.

## Backwards compatibility

A v5.3.0 directory — three files (`ROADMAP.md`, `DECISIONS.md`, `dashboard.html`), a 5-column backlog table, priorities P1–P3 — stays valid and readable.

- Readers key off the **table header**, never a fixed column count, so both the 5-column and 7-column shapes parse.
- Missing `STATUS.md`, `CONVENTIONS.md`, and `decisions/` mean absent, not broken. Degrade gracefully; never report a legacy directory as damaged.
- `/ship:pm-sync` reconcile is the only path that grows an old directory into the new shape, and it does so with the user's confirmation. Nothing auto-migrates.

## Status mapping table (reconciliation)

How Ship reality maps onto a backlog item's recorded Status. `ship/pm-update.cjs` is the mechanical implementation of this table — skills invoke it (`node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" [slug ...]`) rather than re-deriving the mapping.

| Ship reality | Item status becomes |
|--------------|---------------------|
| Feature in `.planning/archive/{slug}/`, or CONTEXT.md status `done` | `done` |
| Feature exists with any other status (`brainstormed` … `built`) | `in-progress` |
| Recorded status is `blocked` and feature is active | unchanged — `blocked` is a PM judgment, never auto-overridden |
| Slug found nowhere (neither features/ nor archive/) | unchanged — `.planning/` may be gitignored or pruned |
