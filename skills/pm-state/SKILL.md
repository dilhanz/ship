---
name: ship:pm-state
description: Use when reading or writing .project-manager/ state files — defines the ROADMAP.md, STATUS.md, DECISIONS.md, CONVENTIONS.md, LEDGER.md, and dashboard.html formats shared by /ship:pm, /ship:pm-sync, and the ship-pm agent
effort: medium
user-invocable: false
---

# Project Manager State Conventions

All PM state lives in `.project-manager/` at the repo root. Six files:

- `ROADMAP.md` — milestones + backlog
- `STATUS.md` — narrative snapshot of right now
- `DECISIONS.md` — short dated entries
- `CONVENTIONS.md` — project conventions + learning
- `LEDGER.md` — generated, append-only, never hand-edited
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
- **Lane** — `{branch} @ {worktree-path}` (forward slashes) while the item's feature is in flight in a worktree, `—` otherwise. Derived data written only by the PM layer from sweep results — never hand-maintained. Populated from sweep **ownership**: the lane the sweep bound the slug to. A feature the sweep reports as `unowned` stays `—`; never guess an owner.

The table header must be exactly:

```
| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |
```

Those eight are the **mandatory core** — every reader locates columns by header *name*, so a table may
carry further columns beyond them, in any order, and still parse. Three optional columns are defined:

- **Blast radius** ∈ `users | contributors | internal | —` — who feels it if this stays undone. Authored.
- **Confidence** ∈ `proven | suspected | —` — whether the problem is demonstrated or suspected. Authored; never inferred from the `Source` shape.
- **First seen** — `YYYY-MM-DD`, stamped by `ship/pm-update.cjs` the first time it sees the row and never rewritten. Derived data like `Lane` — never hand-maintained. It records when the script first saw the row, not a claim about when the item was filed.

An absent column and a `—` cell are the same thing: **`unknown`**, which produces no priority promotion
(see PM:PRIORITY below). `pm-update.cjs` never widens a table on its own — a table grows into the
enriched shape only through a confirmed `/ship:pm-sync` reconcile.

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

| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |
|------|--------|----------|------|------------|--------|--------------|------|
| User model | done | P1 | M | — | 2026-07-02 — Auth owns identity | user-model | — |
| Session tokens | in-progress | P1 | L | User model | session-tokens VERIFY.md L14 | session-tokens | feature/session-tokens @ C:/lanes/session-tokens |
| Password reset | pending | P2 | — | Session tokens | src/auth/reset.ts:41 | — | — |

#### Session tokens

Opaque tokens with a server-side store, rotated on privilege change. ~~Originally scoped as JWTs~~ —
superseded by the 2026-08-10 decision after the revocation requirement landed. The remaining work is
the rotation path; the issue/verify path shipped.

### M2 — Billing (status: pending)

Goal: Paid plans with usage-based invoicing.

| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |
|------|--------|----------|------|------------|--------|--------------|------|
| Stripe integration | pending | P1 | L | Session tokens | 2026-08-01 — Billing waits for auth | — | — |
| Usage metering | blocked | P2 | M | — | docs/billing-brief.md:12 | — | — |
```

## STATUS.md

The narrative snapshot: what is true right now, including the work that lands outside git and is therefore invisible to `git log` (a deploy, a manual drill, a support escalation, an unverified release). ROADMAP.md changes slowly; STATUS.md changes every session.

A `# {project} — Status` title, frontmatter with `updated: "{YYYY-MM-DD}"`, then these sections in order:

- `## In flight` — work started but not shipped. One entry per item, each naming its Ship feature and current stage.
- `## Live status` — production / runtime issues, or "None recorded".
- `## Blocked` — each blocker with its reasoning: what is blocked, on what, and what would unblock it.
- `## Recently shipped` — with any missing verify gate called out explicitly.
- `## Repo hygiene` — branches, worktrees, divergence from origin.
- `## Lanes` — one line per worktree from the fleet sweep: branch, path, the features that lane **owns** and their stage; "single lane" when only the main worktree exists. When the sweep's `unowned` list is non-empty, add one **Unowned** line naming those slugs and the lanes holding a copy. Written by the PM from sweep results. An absent section is legacy, not damage — degrade silently.

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

## Lanes

- `main` @ C:/src/acme-api — no active feature.
- `feature/session-tokens` @ C:/lanes/session-tokens — session-tokens (built), 8/10 tasks.
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

## LEDGER.md

The shipped-feature ledger: one row per feature that reached `done`, recording what its own artifacts say
about how it got there. **Mechanically harvested by `ship/pm-update.cjs`** on the `done` transition it
already runs on, and backfilled once from `.planning/archive/` the first time it runs. Never
agent-authored, never hand-edited — the counts are always true and cost zero tokens, and naming the
*pattern* in them stays the PM's job at read time.

- **Append-only, keyed on feature slug.** A slug already present is skipped before any artifact is read;
  an existing row is never re-read, re-rendered, or rewritten. Re-running the script any number of times
  adds nothing.
- **The table is the last content in the file.** Rows are appended after the last non-empty line, so
  nothing may be authored below it — a footer would silently push later rows past the table.
- **A row is written even when the artifacts are missing.** A feature that reached `done` with no
  VERIFY.md is the highest-signal row the ledger can hold; suppressing it would defeat the purpose.

Frontmatter carries `updated: "{YYYY-MM-DD}"`, bumped on every append. The table header is exactly:

```
| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |
```

Cell vocabulary:

- **Feature** — the feature slug. Unique: the ledger holds one row per slug, forever.
- **Shipped** — VERIFY.md's `**Verified:**` date, falling back to the harvest date when there is no
  VERIFY.md. The Artifacts cell discloses which, so the provenance stays unambiguous.
- **Profile** — the CONTEXT.md frontmatter `profile:` value (`quick | standard | thorough`), or `unknown`.
- **Verify** ∈ `PASS | FAIL | INCONCLUSIVE | DEFERRED | in-progress | unknown | none`. **`none` means the
  feature reached `done` with no VERIFY.md on disk** — deliberately recorded rather than suppressed, and
  read as verification debt. `unknown` means the file exists but states no verdict.
- **Unresolved carried** — REVIEW.md findings marked `unresolved` at `critical` or `high` severity: exactly
  the set the go workflow hands the verifier as mandatory Stage 2b targets.
- **Plan rounds** — PLAN.md's `**Rounds:** {n}`, else the count of `### Round {n}` subsections, else `unknown`.
- **Fix rounds** — REVIEW.md phase headings at round 2 or higher.
- **Findings (C/H/M/L)** — one cell, rendered `{critical}/{high}/{medium}/{low}`.
- **Phases** — distinct phase ids in REVIEW.md.
- **Artifacts** — the provenance contract, below.

**The Artifacts cell is never `—` and never a bare filename list.** It is exactly four `; `-joined tokens
in fixed `CONTEXT.md`, `PLAN.md`, `REVIEW.md`, `VERIFY.md` order. Each token is either the filename (read
cleanly), the filename plus a parenthesised missing-field qualifier (`CONTEXT.md (no profile)`,
`PLAN.md (no rounds)`, `REVIEW.md (no evidence lines)`, `VERIFY.md (no head)`), or `no {filename}` when the
file was absent. That is what makes a cell structurally unable to be ambiguous between "clean run" and
"no record" — the same ambiguity the VERIFY.md three-state rule exists to prevent.

Every cell is sanitized on the way in (newline → space, `|` → `/`, empty → `unknown`), so a value
harvested from a file on disk can never break the table or invent a column.

### Complete example

```markdown
---
updated: "2026-08-25"
---

# Ledger

Mechanically harvested by `ship/pm-update.cjs` when a feature reaches `done` — one row per feature, keyed on slug.
Append-only: a recorded row is never rewritten, and this file is never hand-edited.

| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |
|---|---|---|---|---|---|---|---|---|---|
| go-path-reliability | 2026-08-22 | thorough | PASS | 0 | 2 | 0 | 0/1/5/9 | 4 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |
| lane-ownership | 2026-08-23 | thorough | PASS | 0 | 1 | 0 | 0/0/1/2 | 3 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |
| pm-capability-uplift | 2026-08-11 | unknown | INCONCLUSIVE | 0 | 2 | 0 | 0/0/4/10 | 3 | CONTEXT.md (no profile); PLAN.md; REVIEW.md (no evidence lines); VERIFY.md (no head) |
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

## PM:PRIORITY (derived priority proposal)

`node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --evidence` prints, as JSON, one entry per backlog item
carrying `item`, `milestone`, `status`, `recorded`, `derived`, `unblocks`, `firstSeen`, `blastRadius`,
`confidence`, `needsEvidence`, and `reasons`. It is a **query mode**: like `--next`, it writes nothing —
no roadmap edit, no stamp, no dashboard, no ledger.

`ship/pm-update.cjs` is the single home of this rule; it is never re-derived in prose, exactly as PM:NEXT
is not. The shape of it:

- **Promotion-only.** A proposal is never a *lower* priority than the recorded value. Demotion is where a
  wrong rule quietly buries real work, so the rule cannot express it.
- **Gated on `Confidence`.** `unknown` confidence means no promotion at all and `needsEvidence: true` —
  without evidence there is nothing to promote on. `unknown` blast radius also sets `needsEvidence`, but
  only gates the blast-radius clauses.
- **Blast-radius clauses.** `users` + `proven` → P0; `users` + `suspected` → P1; `contributors` + `proven` → P1.
- **Unblocks clause.** Two or more non-done items depend on this one, or one such dependent is
  `in-progress` → promote one level, floored at P1. `Unblocks` is computed at read time by inverting the
  `Depends on` graph (exact-name, case-sensitive — the same convention PM:NEXT uses) and is stored nowhere.
- **`derived` is the best (lowest-numbered) clause that fired**, and the recorded priority is always a
  candidate, which is what makes demotion arithmetically impossible.

**`groom` proposes and argues; it never writes the Priority cell.** The user decides. An item with
`needsEvidence: true` is reported as a request for the missing `Blast radius` / `Confidence` value, never
promoted on a guess.

## Hard rules

1. **No time concepts:** no deadlines, no time estimates, no day/week/sprint sizing, no velocity. Sizing by plan effort (`S | M | L | XL`) **is** permitted — it is complexity, not duration. Timestamps are permitted in STATUS.md (`updated`, when something shipped) and in DECISIONS.md entry dates; they record when something happened and are never deadlines.
2. **No duplication of `.planning/features/`:** PM state links to Ship features by slug; it never copies acceptance criteria, task lists, or feature-level detail that `.planning/features/{slug}/` already records.
3. **Git-neutral:** whether `.project-manager/` is committed or gitignored is the repo owner's choice — never impose it, never suggest one over the other.
4. **Write boundary:** the PM layer writes `.project-manager/**`, `.planning/**`, `.claude/**`, and root `*.md`, and runs git (`add`, `commit`, `push`, `status`, `log`, `diff`, `worktree prune`) for the files it owns. It never edits application source and never rewrites published history (`reset --hard`, `push --force`, `rebase`). Claude Code cannot scope a subagent's writes by path, so this is discipline, not machinery — being about to edit source is the signal to hand off.
5. **Never invent status:** any claim not verifiable from a file, a command, or git is reported as `unverified` with a named next step that would settle it.
6. **Writer ownership:** lanes (builder sessions) write only their own worktree's `.planning/features/{slug}/`; only the PM layer writes the shared `.project-manager/` files. `pm-update.cjs` writes them via temp-then-rename, so a crashed write never leaves a partial file.
7. **Fleet view requires gitignored state:** the cross-worktree view exists only when `.project-manager/` is gitignored — shared, untracked, one canonical copy at the main worktree root. When it is tracked, PM state is per-worktree and the PM must say it cannot aggregate rather than fake a fleet view. Rule 3 still holds: the resolver adapts to the owner's choice, never changes it.
8. **Deferral, not failure:** when a lane's work requires an authored `.project-manager/` edit, it records a `PM-HANDOFF.md` (below) and the verifier marks that acceptance criterion `DEFERRED`. It is never a `FAIL` and never produces a Fix Task — no builder can clear it, so a fix round would re-run into the same wall and change nothing. `pm-update.cjs` is the exception that proves the rule: mechanical status and dashboard reconciliation runs from any lane through Node, so a criterion satisfied by running it verifies normally.

## CONTEXT.md lane stamp

`.planning/features/{slug}/CONTEXT.md` frontmatter may carry `lane: {branch} @ {worktree-path}` (forward slashes) — the same shape as the PM-HANDOFF.md `lane:` field and the ROADMAP `Lane` column.

- **Written best-effort by `ship/pm-update.cjs`** in whichever lane it runs, naming that lane's own branch and worktree path. It runs after every CONTEXT.md status transition, so one writer covers every stage. A failed stamp is silent: the `.project-manager/` sync still completes and the CLI still exits 0.
- **Read by the fleet sweep as the last ownership layer**, and only when the stamp is *self-consistent* — the path it names is the path of the lane holding that copy.
- **Self-testimony only. A branch match outranks it**, because `/worktree` copies the feature directory and `pm-update.cjs` re-stamps in whichever lane it runs, so two lanes can both hold a self-consistent stamp for the same slug while only one can be on `feature/{slug}`.
- **Additive frontmatter.** An unstamped CONTEXT.md stays valid indefinitely and no existing feature needs migrating — it simply falls through to the layer above.

## PM-HANDOFF.md

`.planning/features/{slug}/PM-HANDOFF.md` — a lane's record of shared `.project-manager/` edits it may not make. It lives inside the lane's own worktree, which is the point: that path is always writable, whereas the main root's `.project-manager/` is not reachable from a worktree-isolated session.

Written by the lane (verifier, or builder when it hits the wall mid-task). Applied by `/ship:pm apply` at the main worktree root — never by the lane, never by `/ship:finish`.

```markdown
---
feature: {slug}
lane: {branch} @ {worktree-path}
head: {git rev-parse HEAD when raised}
raised: {YYYY-MM-DD}
applied: no
---

# PM Handoff — {slug}

## Requested Edits

### 1. {one-line summary}

- **File:** .project-manager/ROADMAP.md
- **Criterion:** {the acceptance criterion this satisfies, verbatim from CONTEXT.md}
- **Intent:** {what must change and why}
- **Proposed content:** {the exact row, entry, or prose where the lane can state it}
```

Rules:

- **`applied` is the idempotence key.** Only the literal value `yes` counts as applied; anything else — including a missing key — is pending, so a malformed stamp never hides unapplied work.
- **One file per feature**, appending numbered blocks. A second deferral adds `### 2.`; it never overwrites the first.
- **Proposed content is a proposal, not a patch.** The PM applies its judgment — priority, wording, whether the row belongs in this milestone. A lane that could decide those things would not need to hand them over.
- **The record travels with the feature directory**, so `/ship:finish`'s archive move carries it to the main root at no extra cost. An unfinished lane keeps its handoff, which is why the fleet sweep reports `pendingHandoffs` across every lane.

## Backwards compatibility

A v5.3.0 directory — three files (`ROADMAP.md`, `DECISIONS.md`, `dashboard.html`), a 5-column backlog table, priorities P1–P3 — stays valid and readable.

- Readers key off the **table header**, never a fixed column count, so the 5-column, 7-column (`| Item | Status | Priority | Size | Depends on | Source | Ship feature |`), 8-column, 10-column (adding `Blast radius` and `Confidence`), and 11-column (adding `First seen`) shapes all parse — including two tables of different widths in the same file.
- The `Lane` column arrives only via a confirmed `/ship:pm-sync` reconcile — the same growth pattern that took v5.3.0 tables from 5 to 7 columns. A 7-column table without it stays valid indefinitely. `Blast radius`, `Confidence`, and `First seen` arrive the same way: `pm-update.cjs` never widens a table itself, so a narrower table simply reads those columns as `unknown` and receives no promotion.
- Missing `STATUS.md`, `CONVENTIONS.md`, `LEDGER.md`, and `decisions/` mean absent, not broken. Degrade gracefully; never report a legacy directory as damaged. `LEDGER.md` is generated rather than migrated: a directory that has never had one gets it on the next `pm-update.cjs` run, backfilled from `.planning/archive/`.
- `/ship:pm-sync` reconcile is the only path that grows an old directory into the new shape, and it does so with the user's confirmation. Nothing auto-migrates.

## Status mapping table (reconciliation)

How Ship reality maps onto a backlog item's recorded Status. `ship/pm-update.cjs` is the mechanical implementation of this table — skills invoke it (`node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" [slug ...]`) rather than re-deriving the mapping. When `.project-manager/` is gitignored, `pm-update.cjs` resolves it to the **main worktree root** (via `ship/resolve-state-root.cjs`) while reading feature status from the invoking worktree's `.planning/` — so a lane updates the canonical roadmap from its own local feature state.

| Ship reality | Item status becomes |
|--------------|---------------------|
| Feature in `.planning/archive/{slug}/`, or CONTEXT.md status `done` | `done` |
| Feature exists with any other status (`brainstormed` … `built`) | `in-progress` |
| Recorded status is `blocked` and feature is active | unchanged — `blocked` is a PM judgment, never auto-overridden |
| Slug found nowhere (neither features/ nor archive/) | unchanged — `.planning/` may be gitignored or pruned |
