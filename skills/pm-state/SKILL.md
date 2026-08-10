---
name: ship:pm-state
description: Use when reading or writing .project-manager/ state files — defines the ROADMAP.md, DECISIONS.md, and dashboard.html formats shared by /ship:pm and /ship:pm-sync
effort: medium
user-invocable: false
---

# Project Manager State Conventions

All PM state lives in `.project-manager/` at the repo root. Three files: `ROADMAP.md` (milestones + backlog), `DECISIONS.md` (dated decision log), `dashboard.html` (generated, never hand-edited). This document is the single source of truth for their formats — `/ship:pm` and `/ship:pm-sync` both read it before touching state.

---

## ROADMAP.md

YAML frontmatter with exactly two fields, then a `## Milestones` section. Each milestone is a `### M{n} — {Name} (status: ...)` heading followed by a one-line `Goal:` and a backlog table.

- Milestone status ∈ `active | pending | done`
- Item **Status** ∈ `pending | in-progress | blocked | done`
- **Priority** ∈ `P1 | P2 | P3` (P1 highest)
- **Depends on** — comma-separated item names from any milestone, or `—` when independent
- **Ship feature** — the feature slug matching `.planning/features/{slug}` (or `.planning/archive/{slug}`), or `—` when no Ship feature exists yet

The table header must be exactly:

```
| Item | Status | Priority | Depends on | Ship feature |
```

### Complete example

```markdown
---
project: "acme-api"
updated: "2026-08-10"
---

## Milestones

### M1 — Core auth (status: active)

Goal: Users can sign up, log in, and stay logged in across sessions.

| Item | Status | Priority | Depends on | Ship feature |
|------|--------|----------|------------|--------------|
| User model | done | P1 | — | user-model |
| Session tokens | in-progress | P1 | User model | session-tokens |
| Password reset | pending | P2 | Session tokens | — |

### M2 — Billing (status: pending)

Goal: Paid plans with usage-based invoicing.

| Item | Status | Priority | Depends on | Ship feature |
|------|--------|----------|------------|--------------|
| Stripe integration | pending | P1 | Session tokens | — |
| Usage metering | blocked | P2 | — | — |
```

## DECISIONS.md

A `# Decisions` title, entries newest first. Each entry is `## {YYYY-MM-DD} — {title}` with a 1–3 line body stating what was decided and why. Entry dates are timestamps of when the decision was made — they are the only dates allowed anywhere in PM state.

### Complete example

```markdown
# Decisions

## 2026-08-10 — Sessions use opaque tokens, not JWTs

Opaque tokens with a server-side store; revocation must be immediate
and the team has been burned by JWT invalidation before.

## 2026-08-01 — Billing waits for auth

Stripe integration depends on stable session identity, so M2 stays
pending until Session tokens is done.
```

## dashboard.html regeneration procedure

1. Read the template at `${CLAUDE_PLUGIN_ROOT}/ship/templates/dashboard.html`.
2. Replace each placeholder comment — `<!-- PM:PROJECT -->`, `<!-- PM:UPDATED -->`, `<!-- PM:NEXT -->`, `<!-- PM:MILESTONES -->`, `<!-- PM:BLOCKERS -->`, `<!-- PM:DECISIONS -->` — with HTML generated **only** from ROADMAP.md and DECISIONS.md:
   - **PM:PROJECT** — the `project` frontmatter value.
   - **PM:UPDATED** — "Last synced {updated}".
   - **PM:NEXT** — the recommended next item: highest-priority non-done, non-blocked item whose Depends-on items are all done; include its milestone and priority.
   - **PM:MILESTONES** — one card per milestone: name, status badge, goal, done/total item count with a progress bar (inline styles or template CSS classes only), and the item rows.
   - **PM:BLOCKERS** — every item with Status `blocked` (item name, milestone), or "No blockers".
   - **PM:DECISIONS** — the 5 most recent DECISIONS.md entries (date, title, body).
3. Write the result to `.project-manager/dashboard.html`.
4. If the template cannot be read (legacy install), generate a minimal self-contained page with the same six sections from scratch.

The output must stay a single file: inline CSS only, no JavaScript required, no external references of any kind (no `http://`/`https://` URLs, scripts, stylesheets, fonts, or images). It must render via `file://` with zero network requests.

## Hard rules

1. **No time concepts:** no dates-as-deadlines, no estimates, no sizing anywhere in state files. Only priority order, status, and dependencies. DECISIONS.md entry dates are the sole exception (they are timestamps, not deadlines).
2. **No duplication of `.planning/features/`:** PM state links to Ship features by slug; it never copies acceptance criteria, task lists, or feature-level detail that `.planning/features/{slug}/` already records.
3. **Git-neutral:** whether `.project-manager/` is committed or gitignored is the repo owner's choice — never impose it, never suggest one over the other.
4. **Write boundary:** PM skills write only inside `.project-manager/`.

## Status mapping table (reconciliation)

How Ship reality maps onto a backlog item's recorded Status:

| Ship reality | Item status becomes |
|--------------|---------------------|
| Feature in `.planning/archive/{slug}/`, or CONTEXT.md status `done` | `done` |
| Feature exists with any other status (`brainstormed` … `built`) | `in-progress` |
| Recorded status is `blocked` and feature is active | unchanged — `blocked` is a PM judgment, never auto-overridden |
| Slug found nowhere (neither features/ nor archive/) | unchanged — `.planning/` may be gitignored or pruned |
