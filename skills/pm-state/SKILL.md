---
name: pm-state
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
- Item **Status** ∈ `pending | in-progress | awaiting-merge | blocked | done`. `awaiting-merge` sits between `in-progress` and `done` and means git can **positively prove** the work has not landed: the feature is archived, its VERIFY.md `**Head:**` commit is not an ancestor of the base branch, **and** a live remote branch still contains that commit. It is written only by `pm-update.cjs`, never by hand. It self-heals wherever the stamped commit survives the merge — merge commits, fast-forwards, and rebases that keep it reachable all flip the row to `done` on the next reconcile. A **squash merge replaces the commit**, so the stamped head never becomes an ancestor; that case reads as *unchanged*, not as `awaiting-merge`, because a non-ancestor result alone is not evidence the work is unmerged.
- **Priority** ∈ `P0 | P1 | P2 | P3`. The key: **P0** live / customer-facing risk · **P1** blocks confidence in shipped work · **P2** strategic feature work · **P3** nice to have.
- **Size** ∈ `S | M | L | XL` by plan effort, or `—` when unsized. Never omit the cell — a row whose cell count differs from the header is dropped by the nudge hook.
- **Depends on** — comma-separated item names from any milestone, or `—` when independent
- **Source** — where the item came from: a `VERIFY.md` line reference, a DECISIONS.md entry title, or a `file:line`. **Mandatory, never `—`. Do not add an item you cannot point at.** Soft cap **240 characters**: a citation that needs more room points at a DECISIONS.md entry or a `file:line` that holds the detail rather than inlining it — the cell is an index into the reasoning, not the reasoning. `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --lint` reports every over-cap cell and writes nothing; nothing truncates a cell automatically.
- **Ship feature** — the feature slug matching `.planning/features/{slug}` (or `.planning/archive/{slug}`), or `—` when no Ship feature exists yet
- **Lane** — `{branch} @ {worktree-path}` (forward slashes) while the item's feature is in flight in a worktree, `—` otherwise. Derived data — never hand-maintained. **Written by `ship/pm-update.cjs` on every reconcile** from sweep **ownership**: the lane the sweep bound the slug to, or `—` when the sweep reports the slug `unowned` or never saw it (a finished feature). Never guess an owner. When the sweep is unavailable — it failed, or it reported an error — the reconcile **leaves every `Lane` cell exactly as authored**: writing `—` off a failed sweep would be inventing "unowned", which is the one thing this column must never do.

The table header must be exactly:

```
| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |
```

Those eight are the **mandatory core** — every reader locates columns by header *name*, so a table may
carry further columns beyond them, in any order, and still parse. Four optional columns are defined:

- **Blast radius** ∈ `users | contributors | internal | —` — who feels it if this stays undone. Authored.
- **Confidence** ∈ `proven | suspected | —` — whether the problem is demonstrated or suspected. Authored; never inferred from the `Source` shape.
- **First seen** — `YYYY-MM-DD`, stamped by `ship/pm-update.cjs` the first time it sees the row and never rewritten. Derived data like `Lane` — never hand-maintained. It records when the script first saw the row, not a claim about when the item was filed.
- **Kind** ∈ `work | debt` — what the row *is*. `work` is a thing to build; `debt` is verification debt raised against something already shipped. A `debt` row keeps its `Ship feature` slug for traceability but is **skipped by reconciliation entirely**, so it can never auto-close off the archive of the very feature meant to discharge it; it closes only when a human sets the cell. An absent column, an empty cell, or `—` means `work`, so today's behaviour is preserved byte-for-byte. Debt rows are *proposed* by `pm-update.cjs --debt` and written only by the PM after the user accepts them.

An absent column and a `—` cell are the same thing: **`unknown`**, which produces no priority promotion
(see PM:PRIORITY below). `pm-update.cjs` never widens a table on its own — a table grows into the
enriched shape only through a confirmed `/ship:pm-sync` reconcile.

The fully enriched shape — the mandatory core, then `Blast radius`, `Confidence`, `First seen`, and `Kind` — is:

```
| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen | Kind |
```

This is the header `/ship:pm-sync` bootstraps and grows to. Every column is nonetheless located by **name**,
never by position or count, so a table that orders them differently reads correctly and a narrower table stays
fully supported.

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

A `# {project} — Status` title, frontmatter with `updated: "{YYYY-MM-DD}"`, then these sections in order.

The frontmatter declares **exactly one key, `updated`** — anything else is undeclared and reported by `--lint`. The six section headings below are the declared vocabulary, and **narrative belongs inside a section, never above the first one** (the `# {project} — Status` H1 is the sole exception; it is required by this spec and is never narrative). A section is **superseded in place**: rewrite it to what is true now rather than appending to it — STATUS.md is a snapshot of right now, and history belongs in DECISIONS.md.

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

- **Keyed on feature slug, and append-only with exactly one relaxation.** A slug already present is
  skipped before any artifact is read — with one exception: a row whose `Verify` cell reads `unknown` or
  `in-progress` is **re-harvested and rewritten in place** on the next run. That contract exists to protect
  history, not a parse failure or a verdict that had not been reached yet. Every other recorded row is
  untouchable, the file keeps one row per slug forever, and a re-read that still finds no verdict changes
  nothing at all — no rewritten line, no `updated:` bump, no mtime churn. Re-running the script any number
  of times therefore adds nothing and settles down.
- **Rows render to the file's own header.** `pm-update.cjs` reads the header the file already carries and
  emits one cell per column in that order, so a ledger written before a column existed keeps receiving rows
  of its own width — a column the file lacks is simply not rendered, and a column the code does not know
  renders `unknown` rather than shifting its neighbours. Only a **rebuilt or brand-new** ledger gets the
  widened shape below. No recorded row is ever rewritten to widen it.
- **The header row is the key.** Slugs are located by the header, so a file carrying none holds no rows
  the script can key on. A body with no parseable header row is therefore **rebuilt** from scratch, not
  appended to — the one path that is not append-only. Nothing recoverable is lost: without a header the
  column order is unknowable, so the bytes below it are not ledger data.
- **The table is the last content in the file.** Rows are appended after the last non-empty line, so
  nothing may be authored below it — a footer would silently push later rows past the table.
- **A row is written even when the artifacts are missing.** A feature that reached `done` with no
  VERIFY.md is the highest-signal row the ledger can hold; suppressing it would defeat the purpose.

Frontmatter carries `updated: "{YYYY-MM-DD}"`, bumped on every append and on every in-place re-harvest that
actually changed a line. The table header of a rebuilt or brand-new ledger is exactly these twelve columns:

```
| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |
```

Cell vocabulary:

- **Feature** — the feature slug. Unique: the ledger holds one row per slug, forever.
- **Shipped** — VERIFY.md's `**Verified:**` date, falling back to the harvest date when there is no
  VERIFY.md. The Artifacts cell discloses which, so the provenance stays unambiguous.
- **Profile** — the CONTEXT.md frontmatter `profile:` value (`quick | standard | thorough`), or `unknown`.
- **Outcome** ∈ `shipped | abandoned | superseded | umbrella | unknown` — harvested from the archived
  CONTEXT.md frontmatter `outcome:` stamp `/ship:finish` writes. An absent stamp, an empty value, or a value
  outside the vocabulary records `unknown`, **and the row is still written** — an archived directory is never
  silently counted as shipped, and never dropped. The ~60 archives that predate the stamp read `unknown`,
  which is the honest answer rather than a retroactive claim. `--debt` excludes `abandoned`, `superseded`,
  and `umbrella` rows: work that was never meant to ship is not verification debt.
- **Verify** ∈ `PASS | FAIL | INCONCLUSIVE | DEFERRED | in-progress | unknown | none`. **`none` means the
  feature reached `done` with no VERIFY.md on disk** — deliberately recorded rather than suppressed, and
  read as verification debt. `unknown` means the file exists but states no verdict. `in-progress` comes
  from the verifier's Stage-1 flush line, matched on the `**Status:** IN PROGRESS` prefix — the line Ship
  actually writes carries a trailing `— Stage 1 only`, so the match must not be end-anchored. The harvest
  reads the **four verdict shapes Ship's agents actually emit**, in this precedence order:
  `**Overall Status:** X` → the Stage-1 `**Status:** IN PROGRESS` marker → a bare `**Status:** X` →
  `**Verdict: X` (both `**Verdict:** X` and `**Verdict: X**`) → the first line of a `## Verdict` section.
  The `IN PROGRESS` marker deliberately outranks a bare `**Status:**` match, and an `**Overall Status:**`
  line outranks both — a flushed Stage-1 report that later gained a real verdict reads as the verdict.
  The cell records the **leading token only**, normalised to this enum; anything unrecognised is `unknown`.
- **Verify note** — the qualifier that used to be smuggled into the Verify cell: everything after the
  leading verdict token (`all 11 criteria proven`, `2 criteria unproven`, `Stage 1 only`), or `none` when the
  verdict carried no qualifier — `none` because there was nothing to say, which is not the same claim as
  `unknown`. When the verdict itself is unrecognised the whole raw text lands here, so the string that
  was on disk is preserved rather than discarded. The qualifiers are genuinely valuable — they just cannot
  live in the column that gets counted.
- **Unresolved carried** — REVIEW.md findings at `critical` or `high` severity whose line ends `— unresolved`
  **or** `— new (round {n})`: exactly the set the go workflow hands the verifier as mandatory Stage 2b
  targets. The second marker is the label a fix round gets when it *introduced* the finding, and
  `go.workflow.js` treats `introducedByFix` as a subset of `unresolved` — so counting only the first
  undercounts whenever a fix round created a new critical or high issue.
- **Plan rounds** — PLAN.md's `**Rounds:** {n}`, else the count of `### Round {n}` subsections, else `unknown`.
- **Fix rounds** — REVIEW.md phase headings at round 2 or higher.
- **Findings (C/H/M/L)** — one cell, rendered `{critical}/{high}/{medium}/{low}`.
- **Phases** — distinct phase ids in REVIEW.md.
- **Artifacts** — the provenance contract, below.

**The Artifacts cell is never `—` and never a bare filename list.** It is exactly four `; `-joined tokens
in fixed `CONTEXT.md`, `PLAN.md`, `REVIEW.md`, `VERIFY.md` order. Each token is either the filename (read
cleanly), the filename plus a parenthesised missing-field qualifier (`CONTEXT.md (no profile)`,
`PLAN.md (no rounds)`, `REVIEW.md (no evidence lines)`, `VERIFY.md (no head)`), `no {filename}` when the
file was absent, or `unreadable {filename}` when it exists but could not be read. That is what makes a cell
structurally unable to be ambiguous between "clean run" and "no record" — the same ambiguity the VERIFY.md
three-state rule exists to prevent. `unreadable` is a distinct token on purpose: a permission problem is an
access failure, not verification debt, and collapsing the two would report a feature as unverified when its
evidence is sitting right there.

Every cell is sanitized on the way in (newline → space, `|` → `/`, empty → `unknown`), so a value
harvested from a file on disk can never break the table or invent a column.

### Complete example

```markdown
---
updated: "2026-08-25"
---

# Ledger

Mechanically harvested by `ship/pm-update.cjs` when a feature reaches `done` — one row per feature, keyed on slug.
Append-only apart from one case: a row recorded `unknown` or `in-progress` may be re-harvested in place.
Never hand-edited.

| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-path-reliability | 2026-08-22 | thorough | shipped | PASS | all 9 criteria proven | 0 | 2 | 0 | 0/1/5/9 | 4 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |
| lane-ownership | 2026-08-23 | thorough | shipped | PASS | unknown | 0 | 1 | 0 | 0/0/1/2 | 3 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |
| pm-capability-uplift | 2026-08-11 | unknown | unknown | INCONCLUSIVE | 2 criteria unproven | 0 | 2 | 0 | 0/0/4/10 | 3 | CONTEXT.md (no profile); PLAN.md; REVIEW.md (no evidence lines); VERIFY.md (no head) |
```

## dashboard.html regeneration procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs"` from the repo root. With no slugs it regenerates `.project-manager/dashboard.html` from the state files and template, and reconciles every slugged row's Status per the status mapping table below, in one pass.

**Manual fallback** — only when the script is unreadable (legacy install), fill the template by hand:

1. Read the template at `${CLAUDE_PLUGIN_ROOT}/ship/templates/dashboard.html`.
2. Replace each placeholder comment — `<!-- PM:PROJECT -->`, `<!-- PM:UPDATED -->`, `<!-- PM:NEXT -->`, `<!-- PM:INFLIGHT -->`, `<!-- PM:MILESTONES -->`, `<!-- PM:BLOCKERS -->`, `<!-- PM:DECISIONS -->` — with HTML generated **only** from the state files:
   - **PM:PROJECT** — the `project` frontmatter value.
   - **PM:UPDATED** — "Last synced {updated}".
   - **PM:NEXT** — the recommended next item: highest-priority non-done, non-blocked, non-`awaiting-merge` item whose Depends-on items are all finished (`done` or `awaiting-merge`); include its milestone and priority. `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" --next` prints the same selection as JSON and is the single home of this rule.
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
- **Unblocks clause.** Two or more unfinished items depend on this one, or one such dependent is
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
- **The sweep detects a handoff by filename, and parses afterwards.** A file named `PM-HANDOFF.md` *is* a handoff, full stop. One that is unreadable, carries no frontmatter block, or whose frontmatter omits `feature:` is reported as an entry with `unparseable: true`, its path, and a `reason` — never as an absent handoff, and never as an applied one. A malformed file on disk cannot be fixed by any writer-side change, so reporting it through the same code path as "no handoff at all" was the blind spot this closes. Consequence worth knowing: the handover prune guard refuses to prune a lane holding a pending handoff, so a stray or half-written `PM-HANDOFF.md` will block a prune — the remedy is to fix or delete the file, not to override the guard.

## Backwards compatibility

A v5.3.0 directory — three files (`ROADMAP.md`, `DECISIONS.md`, `dashboard.html`), a 5-column backlog table, priorities P1–P3 — stays valid and readable.

- Readers key off the **table header**, never a fixed column count, so the 5-column, 7-column (`| Item | Status | Priority | Size | Depends on | Source | Ship feature |`), 8-column, 10-column (adding `Blast radius` and `Confidence`), 11-column (adding `First seen`), and 12-column (adding `Kind`) shapes all parse — including two tables of different widths in the same file.
- The `Lane` column arrives only via a confirmed `/ship:pm-sync` reconcile — the same growth pattern that took v5.3.0 tables from 5 to 7 columns. A 7-column table without it stays valid indefinitely. `Blast radius`, `Confidence`, `First seen`, and `Kind` arrive the same way — `/ship:pm-sync` bootstraps the full 12-column shape and grows an 11-column table into it, filling `Kind` with `work` for every existing row: `pm-update.cjs` never widens a table itself, so a narrower table simply reads those columns as `unknown` and receives no promotion — and a table with no `Kind` column reconciles every row as `work`, exactly as it always did. Because of that, a `Kind: debt` row must never be appended to a table lacking the column: grow the table through `/ship:pm-sync` first.
- The LEDGER.md `Verify note` and `Outcome` columns arrive the same way — a recorded ten-column ledger keeps receiving ten-column rows rendered to its own header, and only a rebuilt or brand-new file gets the twelve-column shape. The CONTEXT.md frontmatter `outcome:` stamp is additive too: an unstamped archive harvests as `unknown` and is still recorded.
- Missing `STATUS.md`, `CONVENTIONS.md`, `LEDGER.md`, and `decisions/` mean absent, not broken. Degrade gracefully; never report a legacy directory as damaged. `LEDGER.md` is generated rather than migrated: a directory that has never had one gets it on the next `pm-update.cjs` run, backfilled from `.planning/archive/`.
- `/ship:pm-sync` reconcile is the only path that grows an old directory into the new shape, and it does so with the user's confirmation. Nothing auto-migrates.

## Status mapping table (reconciliation)

How Ship reality maps onto a backlog item's recorded Status. `ship/pm-update.cjs` is the mechanical implementation of this table — skills invoke it (`node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" [slug ...]`) rather than re-deriving the mapping. When `.project-manager/` is gitignored, `pm-update.cjs` resolves it to the **main worktree root** (via `ship/resolve-state-root.cjs`) while reading feature status from the invoking worktree's `.planning/` — so a lane updates the canonical roadmap from its own local feature state.

| Ship reality | Item status becomes |
|--------------|---------------------|
| Feature in `.planning/archive/{slug}/` with **no** VERIFY.md `**Head:**` stamp, or CONTEXT.md status `done` | `done` |
| Feature archived and its VERIFY.md `**Head:**` commit **is** an ancestor of the base branch | `done` |
| Row is recorded `done` and its feature is archived | unchanged — the merge test never moves a `done` backwards |
| Feature archived, `**Head:**` **not** an ancestor, and a live remote branch still contains that commit | `awaiting-merge` |
| Feature archived, `**Head:**` **not** an ancestor, and no remote branch corroborates it | unchanged — never invented |
| Feature archived, stamp present, but the base ref is unresolvable or git is unavailable | unchanged — never invented |
| Feature exists with any other status (`brainstormed` … `built`) | `in-progress` |
| Recorded status is `blocked` and feature is active | unchanged — `blocked` is a PM judgment, never auto-overridden |
| Row's `Kind` cell is `debt` | unchanged — a debt row is never reconciled off anyone's archive |
| Slug found nowhere (neither features/ nor archive/) | unchanged — `.planning/` may be gitignored or pruned |

An archived feature carrying **no** `**Head:**` stamp still maps to `done`, so every archive that predates
the stamp reconciles exactly as it did before: a stamp-less archive is not evidence *against* merge, and the
merge test is gated on the stamp. The base branch is resolved the way `/ship:finish` resolves it — `main` if
it exists, else `master`, preferring `origin/{base}` when that ref resolves — so a stale local base can only
produce `awaiting-merge`, never a false `done`.

The merge test can only ever **withhold** a `done` — it never invents one, and it never revokes one. A row already
recorded `done` is left alone whatever git answers, because a downgrade would need positive evidence the work was
*un*-shipped, which nothing here produces. The non-merge probe is local (`git branch -r --contains {head}`, filtered
to remote branches that are not the base branch under any remote — a fork's `upstream/main` holding the merged
commit is the base, not unlanded work): no network call, no fetch. A clone that has never fetched, a repo
with no remotes, or a missing git binary simply answers "unchanged".
