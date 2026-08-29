# Changelog

## 5.18.1

Patch release — the three follow-ups 5.18.0 shipped with, a test that had been reporting the developer's own working tree as a failure, and the squash-merge defect that made 5.18.0's new merge test downgrade correct `done` rows.

### Added

- **`awaiting-merge` now requires positive proof of non-merge.** The status is written only when the stamped head is not an ancestor of the base **and** `git branch -r --contains {head}` names a remote branch that is not the base — a local, network-free probe whose every failure mode (no remotes, non-zero exit, missing binary) collapses to "unchanged". The probe can only ever *withhold* a `done`; it can never invent one. That is why the positive squash-detection tiers stay out: branch-gone inference cannot be told apart from an unfetched clone, a slug appearing in base history is as likely a later mention as the squash commit, and a `gh` lookup would put a network call on the reconcile hot path — each can produce a false `done`, the one status this layer must never invent.
- **`/ship:finish` records the PR it opens.** Option 1 captures the URL `gh pr create` prints (falling back to `gh pr view --json url -q .url` when that output is empty or unparseable) and stamps it into the feature's CONTEXT.md frontmatter as `pr:`, **before** the archive move and with the same best-effort contract as the `outcome:` stamp — a failed or impossible stamp is reported and the archive proceeds with the field simply absent. Nothing consumes `pr:` yet; the point is that merge provenance for every future feature becomes a lookup on disk instead of archaeology over git history. Options 2 and 3 open no PR and stamp nothing.

### Fixed

- **The merge test no longer downgrades correct `done` rows in a squash-merge repo.** A squash merge replaces a branch's commits with a new one, so VERIFY.md's `**Head:**` commit never becomes an ancestor of the base and 5.18.0's ancestry test could never flip — the self-healing property it was designed around does not exist there. Measured in Ship's own repository: all six stamped archives read `awaiting-merge`, every one of them shipped and released, and a reconcile against the real ROADMAP.md rewrote five correct `done` rows to a wrong status. Two things fix it. A recorded `done` is **never moved backwards** by the merge test, scoped to the archive branch of `mappedStatus` alone — a downgrade would need positive evidence the work was un-shipped, which nothing here produces. And a non-ancestor result that no remote branch corroborates now reads as **unchanged** rather than `awaiting-merge`, because under squash that is the expected shape of merged work. A stamp-less archive still reconciles to `done`, byte-for-byte as in 5.18.0.
- **`skills/pm-state/SKILL.md` prints the 12-column enriched shape.** 5.18.0 grew `/ship:pm-sync` to bootstrap and widen to a header including `Kind`, but pm-state — the reference the bootstrap reads — still printed 11 columns and stated that `Kind` "is not part of that fixed shape". The two documents contradicted each other about the canonical header, so an agent following pm-state would lay down a table that could not hold the `debt` row `--debt` proposes. The shape now carries `Kind`, and the sentence beside it says the thing that is actually true and load-bearing: every column is located by **name**, never by position or count.
- **`skills/pm/SKILL.md` no longer re-derives the old PM:NEXT rule.** The sentence corrected in pm-state for 5.18.0 survived verbatim in a second file: "highest-priority non-done, non-blocked item whose Depends-on items are all `done`" — missing both the `awaiting-merge` eligibility exclusion and the `done | awaiting-merge` satisfaction rule that `selectNext` implements. `--next` remains the single home of the rule.
- **An absent `Verify note` records `none`, not `unknown`.** A clean PASS carrying no qualifier had nothing to say, and saying "we don't know" about it is precisely the confusion between a clean run and no record that this ledger exists to prevent. `unknown` still means a genuine gap — an unstamped `Outcome`, an unreadable verdict — and a note whose text really is "unknown" is unaffected. Rows already recorded with `unknown` for an absent note are **not** rewritten: the two spellings are the same claim, so re-harvesting one into the other would be churn rather than repair, and would have re-dated every eligible legacy row on the first run after the rename.

### Changed

- **`tests/legacy-install-tree-adversarial.test.js` measures fossils against what `install.js` actually writes**, rather than an allowlist of directories permitted to exist under `.claude/`. The allowlist had to be edited every time a working tree grew a legitimate directory — a `.claude/worktrees/` lane or an agent-memory sibling — and had been reported as an environmental failure in two consecutive verification rounds, which is how a guard stops being read. The new form is stricter where it matters (a fifth install destination is caught the moment the installer grows one) and silent about entries the installer never writes.

## 5.18.0

Minor release — nine seams in Ship's PM layer stop giving confidently wrong answers and start admitting what they do not know. A 2026-08-28 audit against nine months of real project state (101 ledger rows, 234 backlog rows, 60 archived features) found the mechanical arm *exact* — every slugged backlog row agreed with the filesystem — while the seams around it read as a clean bill of health rather than an unknown. Every new column and frontmatter field here is optional and additive, arriving only through a confirmed `/ship:pm-sync` reconcile, so an absent column reads as today's behaviour byte-for-byte.

### Added

- **`awaiting-merge`, a status between `in-progress` and `done`.** `done` used to be resolved from a directory move, so a feature whose PR was still open read as shipped. `mappedStatus` now tests git ancestry against the `**Head:**` commit the verifier already writes into VERIFY.md: an ancestor of the base branch is `done`, a non-ancestor is `awaiting-merge`, and it self-heals — the next reconcile after the merge flips the row. The merge test is **gated on the stamp**: an archive carrying no `**Head:**` line still maps to `done` exactly as before, so the ~60 archives that predate the stamp reconcile unchanged. A stamp present with an unresolvable base ref, or any git failure, leaves the row **unchanged** rather than guessing. Base resolution mirrors `/ship:finish` (`main`, else `master`, preferring `origin/{base}`), so a stale local base can only produce `awaiting-merge`, never a false `done`. `selectNext` skips the new status and the dashboard styles it.
- **The `Outcome` ledger column and the `/ship:finish` outcome stamp.** Every archived directory used to be counted as shipped. `/ship:finish` now asks which outcome the archive records — `shipped | abandoned | superseded | umbrella` — and stamps it into CONTEXT.md frontmatter **before** the move; `harvestFeature` reads it from the frontmatter block only. An absent or unrecognised stamp records `unknown` **and the row is still written** — never silently reclassified as shipped, never dropped — and a failed stamp never blocks the archive.
- **The optional `Kind ∈ work | debt` backlog column.** A debt row keeps its `Ship feature` slug for traceability but is skipped by reconciliation entirely, so it can no longer auto-close off the archive of the very feature meant to discharge it; it closes only when a human sets the cell. An absent column means every row is `work`.
- **`pm-update.cjs --debt`** — one proposed backlog row per ledger row whose `Verify` is `none`, `unknown`, `FAIL`, or `INCONCLUSIVE`, each with a `Source` naming that ledger row, in the ledger's own order. Rows whose `Outcome` is `abandoned`, `superseded`, or `umbrella` are excluded: work that was never meant to ship is not verification debt. Like `--next` and `--evidence` it is a **query mode** — it writes nothing at all, and the `ship-pm` agent writes only the rows the user accepts.
- **`pm-update.cjs --lint`** — state-file decay: backlog `Source` cells over the 240-character cap, STATUS.md frontmatter keys other than the declared `updated`, and narrative stranded between the frontmatter and the first `## ` section (the `# {project} — Status` H1 excepted). Writes nothing; an absent file degrades to an empty array for its axis and still exits 0. Both new modes are handled before the ROADMAP.md early-exit, since neither reads it.
- **The `Lane` column is now written, not just documented.** `pm-update.cjs` derives every backlog row's `Lane` cell from fleet-sweep **ownership** on each reconcile — the owning lane's `{branch} @ {path}`, `—` when the sweep reports the slug unowned or never saw it — making the spec's "derived, never hand-maintained" sentence true and removing the class of hand-correction commits the audit found three of. When the sweep is unavailable the pass is **skipped entirely**: writing `—` off a failed sweep would be inventing "unowned", which is the exact failure class this release exists to close. A table with no `Lane` column is never widened.
- **`tests/pm-legacy-regression.test.js`** — the guard for the audit's "mechanical status reconciliation is exact" property. Every historical width (5, 7, 8, 10, 11 columns) reconciles to byte-identical output through both `applyStatusUpdates` and a full CLI run: only Status cells move, `updated:` bumps only when one did, and no `Lane`, `Kind`, or `First seen` cell is ever widened in.

### Changed

- **The ledger reads the four verdict shapes Ship's agents actually emit**, not the one the template prescribes: `**Overall Status:** X`, the Stage-1 `**Status:** IN PROGRESS` marker, a bare `**Status:** X`, `**Verdict: X` (both punctuations), and a `## Verdict` section body — in that precedence order, with `IN PROGRESS` deliberately outranking a bare `**Status:**` and `**Overall Status:**` outranking both. `unknown` is now recorded only when none of them is present.
- **`Verify` normalises to the documented enum and the qualifier moves to a new `Verify note` column.** The cell that gets counted holds the leading token only; `all 11 criteria proven` and `Stage 1 only` are preserved beside it rather than smuggled into the verdict. An unrecognised verdict records `unknown` with the whole raw text as the note, so the string that was on disk survives.
- **Ledger rows render to the file's own header.** `appendLedger` reads the header the file already carries and emits one cell per column in that order, so a recorded ten-column ledger keeps receiving ten-column rows; only a rebuilt or brand-new file gets the widened twelve-column shape, and no recorded row is ever rewritten to widen it. A column the code does not know renders `unknown` rather than shifting its neighbours.
- **Append-only is relaxed for exactly one case.** A row whose `Verify` cell reads `unknown` or `in-progress` is re-harvested and rewritten **in place** on the next run — the contract exists to protect history, not a parse failure or a verdict that had not been reached yet. Every other recorded row stays untouchable and is still skipped before any artifact is read, the file keeps one row per slug forever, and a re-harvest that still finds no verdict writes nothing at all: no rewritten line, no `updated:` bump, no mtime churn.
- **The fleet sweep detects a handoff by filename and parses afterwards.** A file named `PM-HANDOFF.md` *is* a handoff, full stop. One that is unreadable, carries no frontmatter block, or omits `feature:` now reaches `pendingHandoffs` as an entry with `unparseable: true`, its path, and a `reason` — never through the same code path as "no handoff at all", and never counted as applied. This reaches the malformed files already on disk, which no writer-side fix could. Consequence worth knowing: the handover prune guard will refuse to prune a lane holding one, and the remedy is to fix or delete the file.
- **`/ship:pm status` and `groom` run both new modes** and surface every finding as a **proposal the user accepts or declines** — the same propose-never-write discipline that already governs Priority. The brief reports `awaiting-merge` rows on their own line (archived, not merged — not the same as in flight) and reports unparseable handoffs by path and reason.
- **`skills/pm-state/SKILL.md`** documents all of it: the new status and its never-invent fallbacks, `Kind`, `Outcome`, `Verify note`, the 240-character `Source` cap and its spill rule, STATUS.md's declared frontmatter key and supersede-in-place rule, the four verdict shapes, header-aware rendering, and the widened status mapping table.

### Fixed

- **`stampLane` no longer claims features whose status is terminal.** A finished feature kept accumulating lane claims on every reconcile from every lane. It now reads the CONTEXT.md frontmatter `status:` and skips `done`, `superseded`, `abandoned`, and `cancelled` — importing the tombstone set from `hooks/scan-features.cjs` rather than re-declaring it. An existing stamp is left byte-identical rather than stripped, and every non-terminal feature stamps exactly as before.
- **The pm-sync nudge no longer reports `awaiting-merge` as drift.** The hook reads any existing archive directory as `done`, so an `awaiting-merge` row would have nudged on every Write and Edit — with a remedy line telling the user to run the very script that wrote the value. It now treats the pair as agreement: `awaiting-merge` is the reconciler's finer reading of the same archived-on-disk fact the hook reads coarsely, and only `pm-update.cjs` (which shells out to git) can tell them apart. The hook stays fs-only — no `spawnSync` in a hook that runs on every edit — so a genuinely stale row is not nudged about and self-heals on the next reconcile instead.

## 5.17.1

Patch release — fixes doubly-prefixed slash commands.

### Fixed

- **Skill names no longer carry the `ship:` prefix.** The plugin loader namespaces a skill by plugin name plus its `name:` field, so `name: ship:go` was prefixed twice and surfaced in the slash menu as `/ship:ship-go` instead of `/ship:go` (every one of the 17 skills was affected, from v5.16.0's `7881b94`). Each `name:` is now the bare directory name, matching the convention every other plugin follows. A new `tests/skill-namespacing.test.js` asserts the invariant three ways — name present, no namespace separator in it, and name equal to its directory — so the prefix cannot come back silently.

## 5.17.0

Minor release — Ship's PM layer stops recording only conclusions and starts keeping evidence. Two mechanical sources arrive, both owned by `ship/pm-update.cjs` and both harvested from artifacts already on disk: a shipped-feature **ledger**, and a **derived priority** proposal the PM must argue for rather than apply. Neither is agent-authored, so both cost zero tokens and cannot drift from what the artifacts say.

### Added

- **`.project-manager/LEDGER.md`** — append-only, keyed on feature slug, one row per feature that reaches `done`. Ten columns: verify verdict, unresolved carries, plan and fix rounds, findings by severity, phases, profile, and an explicit **artifact provenance** cell. Backfilled once from `.planning/archive/`, appended forward thereafter. A slug already present is skipped before any artifact is read, so re-running the script any number of times adds nothing. A feature that reached `done` with **no VERIFY.md records `Verify: none`** rather than being skipped — the highest-signal row the ledger can hold, and suppressing it would defeat the point.
- **The Artifacts provenance contract.** Exactly four `; `-joined tokens in fixed CONTEXT/PLAN/REVIEW/VERIFY order — the filename, the filename plus a missing-field qualifier (`CONTEXT.md (no profile)`, `VERIFY.md (no head)`), `no {filename}`, or `unreadable {filename}`. Never `—`, never short. That is what makes a row structurally unable to be ambiguous between "clean run" and "no record", which is the same ambiguity VERIFY.md's three-state rule exists to prevent.
- **Derived priority (`PM:PRIORITY`), exposed as `node ship/pm-update.cjs --evidence`.** Two optional authored columns (`Blast radius` ∈ `users | contributors | internal`, `Confidence` ∈ `proven | suspected`) plus two computed facts — `Unblocks`, from inverting the Depends-on graph, and a script-stamped `First seen` — feed a documented **promotion-only** rule. It never demotes, and a floor is a floor: a 400-case cross-product over blast radius × confidence × recorded priority × dependent count confirms `derived` never ranks below `recorded`. Absent evidence reads as `unknown` and produces no promotion. `/ship:pm groom` relays and argues the proposal; **it never writes the Priority cell**.
- **`First seen` is stamped once and never rewritten** — proven against a year-2099 clock rather than by waiting a day, which is what the codebase's inject-`today`-never-call-`new Date()` convention buys.
- **Column parity across every table shape.** `parseRoadmap` and `hooks/pm-sync-nudge.cjs` locate columns by header *name*, so the 5-, 7-, 8-, 10-, and 11-column shapes all parse — including two tables of different widths in the same file. `pm-update.cjs` never widens a table itself.
- **`/ship:pm-sync` now grows a table to the enriched eleven columns.** It previously knew only the 8-column shape, so the three new columns had no path that could write them and `--evidence` reported `needsEvidence` on every row with no way to answer it. Bootstrap writes eleven columns outright; the growth path detects the 5-, 7-, 8-, and 10-column shapes and rewrites to eleven on a confirmed reconcile, preserving every existing cell. The new cells are split by kind: `Lane` and `First seen` are **derived** and initialize to `—` — authoring a date into `First seen` would fabricate a history the script then refuses to correct — while `Blast radius` and `Confidence` are **authored**, come from the interview only, and are never inferred from the `Source` cell's shape. Declining still leaves a legacy table fully supported.

### Fixed

Five defects `VERIFY.md` recorded as Open when the feature was verified. None changed a criterion's verdict, so all five would have shipped as-is.

- **A headerless `LEDGER.md` re-appended forever.** Slugs are located by the header row, so a truncated or emptied file yielded an empty slug set, every recorded feature re-harvested, and the rows were appended again on every invocation with no header ever restored. A body with no parseable header is now **rebuilt** — the one path that is not append-only. Nothing recoverable is lost: without a header the column order is unknowable, so the bytes below it are not ledger data.
- **The only Stage-1 flush line Ship writes harvested as `unknown`.** The match was anchored `/^\*\*Status:\*\*\s*IN PROGRESS\s*$/m`, but `agents/ship-verifier.md` and both VERIFY.md templates write `**Status:** IN PROGRESS — Stage 1 only`, which an end-anchor rejects — so the documented `in-progress` verdict was unreachable and `skills/pm-state/SKILL.md` described a state the code could not produce. Now anchored on `\b`. A guard asserts the verifier and the template still write a line the harvest can read, because this is an agreement between two files and fixing one side alone would regress silently.
- **`Unresolved carried` undercounted.** It counted only findings ending `— unresolved`, missing the `— new (round n)` label the go and build skills give a critical/high finding the fix round *introduced* — and `ship/workflows/go.workflow.js` treats `introducedByFix` as a subset of `unresolved`, so those findings *are* handed to the verifier as mandatory Stage 2b targets. The cell reported `0` where the truth was ≥1 whenever a fix round created a new critical or high issue. No shipped row was wrong: the five backfilled features carry no such marker.
- **An unreadable artifact was reported as a missing one.** A `chmod 000` VERIFY.md rendered as `no VERIFY.md`, identical to genuine absence — reporting a permission problem as verification debt. `readArtifact` now separates `ENOENT`/`ENOTDIR` from `EACCES`/`EISDIR`/`EIO`, and the fifth provenance token `unreadable {filename}` says which. The harvest stays silent and exits 0 either way.
- **`computeUnblocks` threw on a non-string `Depends on`**, contradicting its own "must not throw on a malformed row" contract. Unreachable through the CLI — `parseRoadmap` trims every cell to a string — so this only bit a direct module consumer building rows by hand.

### Notes

- **The ledger tests are sourced from a committed fixture, not this repo's real archive.** `.gitignore` excludes `.planning/`, so the first version of `tests/pm-ledger.test.js` staged fixtures by copying a directory CI does not have and 11 tests died on ENOENT — the same clean-checkout blindness `tests/fixtures/pm-state/` was introduced to end in v5.12.0, one directory over. `tests/fixtures/pm-ledger-archive/` keeps REVIEW.md and VERIFY.md **verbatim** (every byte the harvest structurally parses stays real) and reduces CONTEXT.md/PLAN.md to what `harvestFeature()` actually reads. A fidelity tripwire re-harvests the real archive wherever one is present and requires byte-identical records, so the reduction cannot drift from its source; it skips where the archive is absent, which is every CI run.
- **That fixture is a coverage set that will decay.** It captures five features as of 2026-08-25 and the tripwire guards only those five — a feature archived later is not in it, and nothing prompts anyone to extend it. Filed as a P2 backlog item rather than fixed here, with the three options written out.
- **`Verify: INCONCLUSIVE` in the backfill is not a defect.** Two of the six rows record it because those features genuinely verified that way; the ledger's job is to say so.

Suite: **1040 pass / 0 fail**, up from 932.

## 5.16.0

Minor release — this repo stops dogfooding a fossil. `.claude/` held 32 tracked files that were the committed output of a v3.0.1 `npx github:dilhanz/ship` run (`.claude/ship/VERSION` read `3.0.1`, last touched 2026-04-01, before the v4 rearchitecture), and the tree was not inert: tracked `.claude/settings.json` registered five legacy hooks by relative path plus a `statusLine`, while `.claude/skills/` and `.claude/agents/` loaded as project-level definitions alongside the installed plugin's. A session dogfooding Ship here could exercise v3.0.1 while believing it exercised v5.15.0 — precisely the confidence dogfooding exists to buy. Nothing consumers install changes; the plugin's own `hooks/`, `skills/`, and `agents/` trees are untouched.

### Removed

- **The v3.0.1 `.claude/` install tree.** `.claude/agents/` (3), `.claude/hooks/` (7, including a `subagent-stop.cjs` registering a `SubagentStop` event the plugin does not use and validating a `## BUILD RESULT` block that v5 replaced with `StructuredOutput`), `.claude/skills/` (13 `SKILL.md`), `.claude/ship/` (3), `.claude/settings.json`, and `.claude/settings.local.json` are gone from git and disk — 29 files, 3086 deletions. `.claude/settings.json` was the activation mechanism, so deleting it is what actually deactivates the tree; deleting the hook files alone would have left broken registrations. `.claude/` now holds exactly one entry: `agent-memory/`, which is plugin-era live state (its `ship-ship-*` directory names follow `ship:`-prefixed agent naming) and was preserved byte-for-byte.

### Added

- **`tests/legacy-install-tree.test.js`** — a regression guard, since `install.js` is still functional and could silently restore the tree. It asserts the four legacy directories and `.claude/settings.json` are absent from disk, that the tracked `.claude/agent-memory/ship-ship-verifier/` survives, and that `.claude-plugin/plugin.json` (a *different* directory, and the one a careless `.claude*` glob would take out) still parses with `name: ship`. It deliberately says nothing about `.claude/settings.local.json`: Claude Code recreates that file on any permission grant, so a disk-absence assertion would go permanently red on a working copy — a plan-review WARNING caught before the test was written.
- **`tests/legacy-install-tree-adversarial.test.js`** — proves the guard is not vacuous: it runs `install.js` into a temp checkout, confirms the restored tree turns the guard red, and walks a per-path mutation matrix reintroducing each legacy path individually and together.

### Fixed

- **A nested `node --test` passed vacuously.** A runner spawned from inside a test inherits `NODE_TEST_CONTEXT=child-v8` and exits 0 with empty stdout, so any "the nested run must be red" assertion succeeded without testing anything. Measured back to back on the same file: inherited env → status 0, empty stdout; env with `NODE_TEST_CONTEXT` deleted → status 1 with full TAP. The adversarial test strips the variable and asserts a `TAP version` sentinel. No other test in `tests/` spawns a nested runner, so nothing pre-existing was affected.

Suite: **932 pass / 0 fail**, up from 921.

## 5.15.0

Minor release — the fleet sweep binds every feature slug to exactly one owning lane. A feature directory copied into several worktrees was reported under every lane holding a copy, and every copy fed `findOverlaps()`, so one in-flight feature surfaced as a fleet-wide file collision. Reproduced at the reported scale — 23 feature dirs across two checkouts — the sweep now yields one owned row and `overlaps: []`.

### Fixed

- **A copied feature directory was reported as many features.** `ship/lane-sweep.cjs` listed each lane's feature dirs independently, so a slug present in three worktrees appeared under three lanes with no way to tell which one was actually working on it. Ownership now resolves through a four-layer chain, first match wins: **sole holder** (only one lane has it) → **branch match** (a lane on `feature/{slug}`) → **self-consistent CONTEXT.md `lane:` stamp** (the stamp names the lane it is sitting in) → **unowned**. The deciding layer is recorded on each owned feature as `ownedBy`, so a brief can say *why* a lane owns a slug rather than asserting it. A stamp naming a different lane never wins — branch match outranks it, and a stamp inconsistent with its own location is ignored rather than trusted.
- **One feature read as a fleet-wide collision.** `findOverlaps()` was fed every lane's claims including duplicates, so two copies of the same plan naming the same file were reported as two lanes colliding. It now receives owned claims only: an unowned copy is a leftover, not a claim.
- **An unowned slug was reported once per holder.** A slug no layer could bind is now hoisted once into a fleet-level `unowned` array naming the lanes that hold a copy, instead of being repeated under each of them. `never guess an owner` is doctrine in `agents/ship-pm.md`: an unresolvable slug is reported unowned, never attributed.
- **`scanFeatures()` dropped only `done`.** `hooks/scan-features.cjs` now filters the full tombstone set — `done`, `superseded`, `abandoned`, `cancelled` — case- and whitespace-insensitively, while still surfacing a feature whose status is unrecognised or absent. A typo in a status field makes a feature visible, not invisible.

### Added

- **The `lane:` stamp.** `ship/pm-update.cjs` writes `lane: {branch} @ {worktree-path}` into its own lane's CONTEXT.md frontmatter on every slugged run; a later run from a different lane rewrites it, leaving exactly one `lane:` line. It is **best-effort by construction**: a stamp that cannot be written (read-only file, read-only directory, unresolvable worktree) is silent on stdout *and* stderr, exits 0, leaves CONTEXT.md byte-identical, and never blocks the `.project-manager/` sync or the dashboard regeneration that are the command's actual job. The stamp is the third ownership layer, not the first — a stale stamp cannot outrank a live branch match.
- **`unowned` on the degrade path.** `sweep()` never throws, and its error result now carries `unowned: []` alongside `lanes`, `overlaps`, and `pendingHandoffs`, so a consumer destructuring the result cannot crash on a non-repo directory, a missing path, or `undefined`.
- **Ownership doctrine in all four consumers** — `agents/ship-pm.md`, `skills/pm/SKILL.md`, `skills/pm-state/SKILL.md`, and `CLAUDE.md` describe the binding, the `unowned` array, and the stamp's precedence, asserted by six new cases in `tests/multi-worktree-doctrine.test.js`.
- **Coverage** — `tests/lane-ownership-adversarial.test.js` (the 23-dir two-checkout reproduction, tombstone variants, stamp self-consistency over symlinked tmp, silent-failure guarantees), `tests/lane-stamp.test.js` and `tests/lane-stamp-integration.test.js` (the stamp writer and cross-lane restamp over real worktrees), `tests/scan-features.test.js`, plus additions to `lane-sweep`, `multi-worktree-integration`, and `multi-worktree-doctrine`. Suite: **921 pass / 0 fail**, up from 896.

### Notes

- **`pendingHandoffs` is deliberately not routed through `scanFeatures()`** — that function drops `done` features, which is exactly the state a lane holding an unapplied handoff is in. A handoff from a lane that owns no features is still reported.
- **The dashboard's Lanes panel renders `lanes[].features` only.** An unowned slug that previously appeared under every lane now appears in the `unowned` array that the panel does not read — out of scope for this release, and the one place the fix trades noise for silence. `/ship:pm`'s brief does report it.
- **Every slugged `pm-update.cjs` run now writes to that feature's CONTEXT.md.** Intended, and wider than the test fixtures: a Ship build inside this repo stamps its own CONTEXT.md.
- Windows path semantics were exercised through normalization on macOS, not on Windows.

## 5.12.0

Minor release — the PM dashboard renders markdown code spans, and the suite now runs on every push and pull request instead of waiting for a version tag. Both halves come from the same defect: an assertion that had never passed on any machine holding real state, sitting behind a skip guard that made CI green regardless.

### Fixed

- **The dashboard rendered code spans as literal backticks.** `ship/pm-update.cjs`'s `esc()` escapes `& < > " '` and nothing else, so a backlog cell authored as ``Re-run `check` against a ship-owned archived feature`` reached `.project-manager/dashboard.html` with its backticks intact. `tests/pm-state-conformance.test.js` has asserted the opposite since v5.4.0, with a comment stating that the dashboard renders inline code spans as `<code>` elements — written aspirationally; `git log -S'<code>'` over both files is empty, so the rendering never existed. Authored-prose text nodes now render through a new `inline()` helper: backlog cells, milestone names and goals, STATUS bullets, blocker labels and reasons, decision dates/titles/bodies, the project name, the last-synced line, and the `--next` item and its meta. `esc()` stays exactly where it was — attribute values (`class="status-…"`), lane names, feature names, counts, table headers — because a backtick pair reaching an attribute would emit a tag inside quotes and corrupt the markup.
- **Three dogfood test blocks skipped on every clean checkout.** `.project-manager/` is gitignored per-repo working state, so roughly 17 assertions across `tests/pm-state-conformance.test.js` and `tests/pm-nudge-verify.test.js` gated on that directory existing and silently skipped in CI — which is why a red assertion could survive eight minor releases. All three blocks now run against a committed fixture and can no longer skip.
- **Nothing ran the suite until a version tag.** `.github/workflows/release.yml` was the only workflow in the repo, so a red suite was discovered on release day. It is now discovered on the PR.

### Added

- **`inline()` in `ship/pm-update.cjs`** — HTML-escape the whole value first, *then* convert backtick pairs to `<code>`. Escaping first means a value containing `<` or `&` cannot break out of the span and the emitted tags are not themselves escaped; converting first would require re-escaping and reopen the injection question. Code spans only: `**bold**`, `_em_`, and `[text](url)` pass through as literal text. Links in particular would mean deciding an href allowlist, which would reopen the dashboard's "no external reference of any kind" guarantee that `pm-state-conformance` asserts.
- **A `<code>` style rule in `ship/templates/dashboard.html`** — a local monospace stack on the template's track colour. The template's only font declaration was a `system-ui` stack, and an unstyled `<code>` is nearly indistinguishable from surrounding text on a glanceable Pi wall display, which defeats the point of emitting the tag.
- **`tests/fixtures/pm-state/`** — one shared, committed fixture (ROADMAP, STATUS, DECISIONS, CONVENTIONS, plus an active and an archived feature directory) serving all three previously-gated blocks. Committing the *real* `.project-manager/` would have churned on every sync and forced the dashboard to be regenerated in-commit — the same trap v5.4.1 closed one directory up for `.planning/`. The fixture's `dashboard.html` is generated at test time into a temp directory rather than committed, so it cannot go stale the first time rendering changes. Its ROADMAP carries an explicit code-span tripwire row: delete the rendering and that row fails.
- **`.github/workflows/test.yml`** — `node --test "tests/*.test.js"` on Node 22, on push and on pull_request. The command string and pinned Node version are byte-identical to `release.yml`'s `Run tests` step, so a green PR means a green release run, and `tests/ci-workflow-parity.test.js` asserts the two stay in step.
- **Coverage for the conversion itself** — `tests/dashboard-code-spans.test.js` (escape order, attribute safety, passthrough of other markdown), `tests/dashboard-inline-fidelity.test.js` (round-trip losslessness, pre-escaped entities), and `tests/dashboard-inline-adversarial.test.js` (`inline()` attacked across every call site, plus blocker keying and the `--next` contract). `'code'` joins the balanced-structural-tags assertion — a regex that opens a span it never closes is the most likely way this feature breaks the document, and the tag-stripped comparison would pass either way.

### Notes

- **No migration.** `.project-manager/dashboard.html` is regenerated on the next `/ship:pm-sync` or `pm-update.cjs` run; nothing on disk needs changing. State authored without backticks renders exactly as before.
- The verifier's `dogfood-suite-failure.md` agent memory is rewritten as a resolved note. It previously instructed the verifier never to record a FAIL for this assertion — left in place, it would have suppressed a genuine regression.

## 5.11.0

Minor release — the verify gate stops losing half its runs, and the go workflow stops blaming the plan for a dropped connection. A field report over 35 `GO COMPLETE` runs found **15 of 28 verify attempts returned no verdict**: every one of them had built and reviewed real code, then threw its verification away and parked the feature at `built`. The same data turned up two more defects on the go path.

### Fixed

- **The verifier had no durable record.** Its only output was VERIFY.md, written in Stage 3 — so a turn-capped death in Stage 1 or Stage 2, where all the work happens, left nothing behind, and the salvage retry re-did exactly the work that killed the first attempt. Ship had already diagnosed and fixed this same write-it-down-as-you-go bug twice (v5.5 phase reviewer, v5.9 plan reviewer); the verifier never got the patch, despite carrying the lowest turn cap (40 against the other three agents' 60) and the largest workload. It now runs at `maxTurns: 60`, rewrites an incremental record at `.review-scratch/verify.json` after each criterion, each carried-finding outcome, and each test file it commits, flushes the completed criteria table into VERIFY.md before Stage 2 begins, and routes salvage through the record *before* VERIFY.md. Stage 2b also gains budget discipline: carried review findings first and uncapped, then at most 3 discretionary adversarial test files — unbounded bug hunting was what starved Stage 3.
- **The record is stamped with a base head, not the reviewers' live HEAD.** The verifier commits its own test files in Stage 2b, so a live-HEAD fingerprint self-invalidates on its first commit — the retry would reject its own record and re-verify from scratch, reproducing the bug through the fix meant to close it (already observed: one surviving retry re-ran all five test files the dead attempt had committed). The head is captured before any verifier commit, and a salvaged run inherits it rather than re-capturing. `ship/verify-scratch.cjs` enforces the rule as code rather than prose: `base_head` must be an ancestor of HEAD, and every commit in `base_head..HEAD` must be one of the record's own `tests[].commit`. A foreign commit there means the code moved under the verifier.
- **A network outage was reported as turn-budget exhaustion.** On one feature, phase 3 reported `EXHAUSTED` after 8 rounds — but 13 of those agents had died on `API Error: ENOTFOUND` with zero tokens and zero tool calls, and the framework answered with advice to "split its remaining tasks into smaller ones" for a problem that did not exist. `safeAgent` now classifies transport failures (`ENOTFOUND`, `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `fetch failed`, `socket hang up`, overload, 5xx) apart from a spent round: such a death does not consume a `MAX_BUILD_ROUNDS` slot, three *consecutive* ones terminate the run as the new `INFRASTRUCTURE` status, and the counter resets on any successful agent so an outage spread across a healthy build cannot add up. The terminal `reason` and `recommendation` are derived from the actual cause; the recommendation is to re-run `/ship:go`, and `skills/go/SKILL.md` explicitly rules out suggesting a resize there.
- **Task `depends` was authored, validated at plan time, and never read on the build path** — a task was observed marked `done` while a task it declared a dependency on was still pending. The builder now checks every referenced task before writing code, refuses to mark a task done while a dependency is pending, and handles the conflict through the deviation rules (reorder under Rule 1, or `CHECKPOINT` when the dependency is out of scope) rather than skipping quietly. The read-only progress probe reports out-of-order done tasks it finds in PLAN.md, so a plan corrupted by a builder that is already gone stays visible.
- **`/ship:pm check` could not tell a gate that started and died from one that never ran** — which is the whole reason this defect needed a field report to surface. The audit now distinguishes three states of VERIFY.md: absent (gate never ran), `**Status:** IN PROGRESS — Stage 1 only` (gate started and died, its criteria table credited as real evidence and its scratch record named as resumable), and a recorded `**Overall Status:**` verdict.

### Added

- **`ship/verify-scratch.cjs`** — a zero-dependency module + CLI in the shape of `resolve-profile.cjs`, holding the base-head validity rule. It never throws and always exits 0, and its safe direction is **reject**: a wrongly rejected record costs a re-verification, a wrongly accepted one reports a verification that did not happen. Garbage input, a non-git directory, and a nonexistent path all degrade to a reject verdict.
- **Salvage-event reporting.** Every salvage retry now records `{ agent, record, outcome }` — `adopted`, `rejected`, `unknown`, or `no-result` — returned as a fifth field of the workflow result and rendered in the `GO COMPLETE` report. An `adopted` event is the machinery working: a lost result recovered for a few thousand tokens instead of a ~90k re-run. The next field audit should be a read of the report, not a reconstruction from session transcripts.

### Notes

- **`infrastructure` is a 12th headless outcome word** in `ship/docs/headless.md` §3 — a contract change for headless callers that switch on the vocabulary. It leaves CONTEXT.md at `building` and is fully resumable: unlike `exhausted`, nothing about the plan is wrong and no committed work was lost.
- **Migration:** records and reports predating this contract (no `stage` key, no `base_head`, no `**Head:**` line) are rejected rather than guessed at, matching how both existing reviewer contracts already treat an unstamped record. Nothing else changes for an existing feature directory.
- New coverage lands in `tests/verify-scratch.test.js` (the helper against a real fixture git repository, every rejection path exercised rather than asserted as prose) and `tests/go-path-reliability.test.js` (turn-cap parity across all four long-running agents, the transport predicate evaluated as written, `INFRASTRUCTURE` wiring, `depends` enforcement, salvage events), with `tests/structured-output-salvage.test.js` extended for the verifier's durability contract. Each assertion is mutation-checked: reverting the change it covers fails it.

## 5.10.1

Patch release — four defects in 5.10.0's profile support: three found by running `/ship:go` end to end on a throwaway `quick` feature rather than by asserting on file contents, and one that broke the release CI job itself. Each had passed the 5.10.0 doctrine tests.

### Fixed

- **`ship/resolve-profile.cjs` could truncate its own output.** The CLI called `process.exit(0)` immediately after `process.stdout.write()`. stdout to a pipe is asynchronous on Windows and the go skill reads this payload through one, so the exit could cut a pending write and fail the skill's `JSON.parse` — precisely the resolution hiccup the design promises cannot kill a go run. No path sets a non-zero code, so the call bought nothing.
- **A review skipped by profile was reported as an unsubstantiated review.** A `quick` phase returns empty `verifyRuns` and `filesReviewed` by design, which matched the GO COMPLETE warning for a verdict backed by nothing. Every deliberately skipped phase was therefore reported as "approved with no verify re-runs and no files reviewed" — wrong, since no reviewer approved it, and it collapsed the very distinction the observability guarantee exists to protect. The warning now excludes `SKIPPED_BY_PROFILE`, and the gate being off gets its own neutral line.
- **The narrowed-verification record was not greppable.** A verifier at criteria-only depth recorded the Stage 2 narrowing in its own words instead of the mandated line. The result read clearly to a human and returned zero hits for `grep "narrowed by profile"`, so a `/ship:pm check` audit could not tell the narrowed run from a full one. `agents/ship-verifier.md` and `ship/templates/VERIFY.md` now require the line copied character for character, with any added context in a following sentence.
- **The CLI adversarial tests depended on local, gitignored state.** Two tests in `tests/workflow-profiles-adversarial.test.js` read `.planning/features/workflow-policy-knobs/CONTEXT.md` directly, but `.planning/` is gitignored per-repo state — that feature directory never exists in a clean checkout. This sank the `v5.10.0` tag's release CI run outright (tests failed before the publish step, so no GitHub Release was ever created under that tag). Both tests now build their own throwaway fixture feature under a temp directory.

### Notes

- `tests/workflow-profiles.test.js` gains seven assertions covering all three, each mutation-checked: reverting any one fix fails its test. The lesson is recorded in the tests themselves — contract-level assertions could not catch a runtime paraphrase or a shape that only appears when the gate is off.

## 5.10.0

Minor release — workflow policy is now per-feature. Every feature used to pay the same ceremony: a one-line fix got the full per-phase review gate, fix round, re-review, and adversarial verify that a six-phase feature got, while a genuinely large feature was capped at the same 5 builder rounds a trivial one never used.

### Added

- **Workflow profiles (`quick` | `standard` | `thorough`).** A `profile:` field in CONTEXT.md frontmatter, proposed by `ship-brainstormer` as part of the summary the user confirms at `/ship:start`, and overridable for a single run with `/ship:go {name} --profile {p}` (any argument order, composable with `--auto`/`--headless`). The profile names a bundle of knobs — per-phase review gate on/off, verify depth full/criteria-only, builder continuation cap 2/5/8, plan-loop cap 2/5/5. There are no generated workflows and no new workflow scripts: the fixed, battle-tested `go.workflow.js` and `plan.workflow.js` stay the single engine, parameterized through `args`.
- **`ship/resolve-profile.cjs`** — a zero-dependency Node helper (module + thin CLI, in the shape of `pm-update.cjs`) holding the profile→knob table in exactly one place, since workflow scripts cannot `require()` anything. Precedence is **flag > CONTEXT.md frontmatter > standard**. Resolution degrades toward *more* ceremony, never less: an unrecognized value yields `standard` plus a warning, a missing CONTEXT.md yields `standard` plus a warning, and the CLI always exits 0 with valid JSON so a resolution hiccup cannot kill a go run.
- **A criteria-only verification depth contract in `agents/ship-verifier.md`.** The HARD-GATE now binds to "every stage in scope" and permits a narrowed Stage 2 *only* on an explicit "Verification depth: criteria-only" instruction in the prompt — never by the verifier's own judgment. Stage 1 (every acceptance criterion, real commands), Stage 3, and the verdict rules are untouched at any depth, and carried Unresolved Review Findings remain mandatory Stage 2b targets: narrowing never waives them.
- **Durable records of every trade.** A review skipped by profile is `reviewStatus: SKIPPED_BY_PROFILE` in the workflow result and `Status: SKIPPED (profile: quick)` in REVIEW.md — deliberately distinct from a bare `SKIPPED`, which continues to mean the review was supposed to run and failed. A narrowed verification opens VERIFY.md's Stage 2 section saying so, and a non-standard profile is named in the GO COMPLETE report. A cheaper run must never be indistinguishable from a full one after the fact, least of all to a `/ship:pm check` audit.

### Notes

- **Fully backward compatible.** An absent `profile:` field resolves to `standard`, and every knob a caller omits defaults inside the workflow to today's constant (`maxBuildRounds` 5, `maxPlanRounds` 5, review gate on, verify depth full). No existing feature directory needs migration and no existing invocation changes behavior. `tests/workflow-profiles.test.js` pins `standard` as the definition of "today" and locks the wiring — including that the review gate is disabled only by an explicit `false`.
- **Go path only.** The manual `/ship:build`, `/ship:verify`, and `/ship:plan-verify` ignore the profile: manual means full ceremony and hands-on control.

## 5.9.1

Patch release — the review agents' turn budget was low enough to kill a review before it produced anything, and a truncated reviewer left nothing behind to salvage.

### Fixed

- **`ship-plan-reviewer` and `ship-reviewer` raised from `maxTurns: 30` to `60`.** The cap is a hard harness cut: the agent stops mid-tool-call with no final message, so the orchestrator sees no result and Ship's invariant blocks the build on a plan that was never actually rejected. On a 16-task plan, three consecutive reviewers stopped at *exactly* 30 turns having produced zero findings between them; the review that landed once the cap was raised took 33 and returned three CRITICAL issues. The failure is silent by construction — no error record, no `stop_reason`, no partial verdict — and had already been misdiagnosed once as a transport error (`Connection lost mid-response`) and once as a token budget, neither of which it was. Neither context (peak ~120k) nor plan size (66KB, mid-pack) was ever near a limit. `ship-reviewer` carried the same 30 and the same symptom on `/ship:go` phase reviews, which returned `reviewStatus: SKIPPED` with no result after retry. `ship-replanner` keeps `maxTurns: 30` — no evidence it has ever reached it.
- **The plan reviewer's scratch record is now written incrementally, and a partial one is resumed from.** It was written *after* the review completed, which is precisely when a turn-capped run never gets to — so the salvage path could not absorb the failure it was built for. The record is now rewritten every few tasks, carries a `complete` flag, and a reviewer finding `complete: false` with a matching `plan_hash` adopts its findings and resumes from the first task it never reached instead of re-verifying from scratch. Records predating the flag are read as complete, so the loop's existing behavior is unchanged.
- **A one-off `/ship:plan-verify` writes a scratch record too.** It was excluded on the grounds that it has no loop to salvage, but it has the same turn cap, and the excluded path is the one where all three reviews were lost. It writes `plan-round-1.json`; `plan_hash` is what keeps a stale record from being trusted, and it guards the one-off path exactly as it guards a loop round.

## 5.9.2

Patch release — a headless `/ship:go` no longer ends its turn while the workflow it launched is still running.

### Fixed

- **`/ship:go --headless` returned before its workflow finished**: the Workflow tool does not return a workflow's result — it launches it in the background and returns a Task ID, and the result arrives later as a completion notification. The go skill treated "workflow launched" as "turn finished", so a headless run's final message was "the build→verify workflow is running, I'll report when it completes" and *none* of section 6 ever ran: phases went unmarked, REVIEW.md and OUTCOME.json went unwritten, and CONTEXT.md stayed at `building` even though the build had committed real work. Interactively this is harmless — the session outlives the turn and the notification lands back in it — but `claude -p` exits when the turn ends, so the caller saw a clean exit with no outcome and, depending on the harness build, agent processes still writing to the worktree. Under `--headless` only, go now blocks on the returned Task ID (`TaskOutput` with `block: true` at the tool's 600000 ms maximum, repeated up to 12 times for a 2-hour ceiling, since a build spine routinely outlasts one call) before reconciling. On reaching the ceiling it calls `TaskStop` *before* terminating as `error` — terminating without stopping recreates the orphan the rule exists to prevent. Both Workflow invocation sites are covered: section 2a's plan loop and section 5's build→verify spine. The interactive path is deliberately untouched, since blocking it for the length of a build would be the worse bug. `ship/docs/headless.md` gains section 2 as the contract of record; the outcome vocabulary, `OUTCOME.json` schema, and fenced block are unchanged, so no caller needs to change to benefit.

### Changed

- **The headless contract is single-sourced**: `skills/go/SKILL.md` and `ship/docs/headless.md` had drifted into restating each other — the QUESTIONS.md format, the answer round-trip, the OUTCOME.json field list, and (newly) the workflow wait rule were each written out in full in both places. They now split by kind: the **skill owns executable mechanism** (control flow, branch conditions, which tool blocks and how) and the **doc owns the contract** (file formats, schemas, and the caller-facing guarantee). Each side points at the other's sections rather than copying them. Two details the skill uniquely held — the `Q:`/`A:` transcript shape and how a resume is identified from the files alone — moved into the doc rather than being dropped. The doctrine tests were re-pointed to match, and now assert the *absence* of the duplicated strings, so a future copy-paste fails the suite instead of silently drifting. Behavior is unchanged; this is why a `--headless` divergence bug was possible in the first place.

## 5.9.0

Minor release — a lane can now finish work that requires shared project-manager edits it is structurally forbidden to make, instead of failing on it forever.

### Added

- **Deferred-to-PM outcome**: an acceptance criterion whose target is an authored `.project-manager/` file could not be satisfied by the lane that owned the feature, and nothing in Ship could say so. Two independent facts made the write impossible — writer ownership (pm-state rule 6) gives shared state to the PM layer, and a gitignored `.project-manager/` exists only at the main worktree root, outside a worktree-isolated session's Write/Edit scope — so the verifier's only available verdict was `FAIL`, which appended Fix Tasks and sent the feature back for a build round that re-ran a builder into the same wall. `ship-verifier` gains a fourth per-criterion verdict, **`DEFERRED`**, with a deliberately narrow trigger (the criterion's *target* is a `.project-manager/` file) and an explicit carve-out for `ship/pm-update.cjs`, whose mechanical status and dashboard reconciliation reaches the main root through Node from any lane. It never writes a Fix Task, leaves CONTEXT.md `status: done`, and ranks below `INCONCLUSIVE` in the overall precedence — an unprovable criterion is a hole in the evidence, a deferred one is understood work with a named owner, so the weaker guarantee reports first. The lane records the requested edits in `.planning/features/{slug}/PM-HANDOFF.md`, inside its own worktree and therefore always writable; a deferral without that record is a dropped criterion, and both the agent and the VERIFY.md template say so. `pm-state` gains hard rule 8 and the PM-HANDOFF.md format, with `applied: yes` as the idempotence key — only that literal value counts, so a malformed stamp never hides unapplied work.
- **`/ship:pm apply`**: a new verb on `/ship:pm` and the `ship-pm` agent that performs pending handoffs at the main worktree root — the one place the edits are both permitted and reachable. Proposed content is treated as a proposal, not a patch: the PM applies its own judgment on priority, wording, and milestone placement, and records a refusal with its reason rather than silently skipping. Each application stamps the handoff and writes a `DECISIONS.md` entry; the redundancy is deliberate, so an edit is still traceable if a stamp is lost with its worktree.
- **`pendingHandoffs` in the fleet sweep**: `ship/lane-sweep.cjs` now parses every lane's `PM-HANDOFF.md` from both `.planning/features/` and `.planning/archive/`, and hoists the unapplied ones to a top-level `pendingHandoffs` list. Discovery deliberately bypasses `scanFeatures`, which drops features with status `done` — and a deferred feature *is* `done`, so keying off the feature scan would have hidden precisely the case the list exists to surface. `/ship:pm status` and the bare brief report pending handoffs as part of the delta: the roadmap is not true while they are outstanding.
- **`deferred` headless outcome**: the headless vocabulary grows from 10 words to 11. A `DEFERRED` verdict terminates as `deferred`, never `done`, with an optional `handoff_file` field pointing at the record — a fleet runner that read `done` would archive the lane and let the handoff rot. `ship/docs/headless.md` documents both.

### Changed

- **`ship-builder` defers rather than fights**: a task whose `<files>` name `.project-manager/` state is no longer retried, routed around with a shell command, or debugged as a Rule 2 verify failure for three attempts. The builder appends the request to `PM-HANDOFF.md`, reports it as a concern, and moves on — the wall is structural, and three more attempts hit the same one.
- **`/ship:finish` carries the handoff without applying it**: the archive move already relocates the whole feature directory to the main worktree root, so the record arrives there at no extra cost. Finish surfaces an unapplied handoff in its report and names `/ship:pm apply`; it holds no Write or Edit tool, so it structurally cannot apply one itself. Option 3 (keep as-is) now warns that the handoff is still sitting in the lane.
- **The handover prune guard covers pending handoffs**: the guard checked whether a lane's feature was done — but a deferred feature is `done`, so a lane could be complete and still hold unapplied edits that exist nowhere else. `git worktree prune` now waits on the handoff as well as the feature.

### Fixed

- **A headless doctrine test asserted a count it never checked**: `doctrine-headless.test.js` iterated a hardcoded outcome list while its name claimed full coverage, so a newly documented outcome would pass unverified. The list is now the assertion's actual subject.

## 5.8.0

Minor release — the PM layer aggregates state across parallel worktree lanes, and `/ship:go` gains a headless mode for unattended runs.

### Added

- **Multi-worktree PM aggregation**: `.project-manager/` now anchors to the main worktree root via a shared resolver (`ship/resolve-state-root.cjs`, `git rev-parse --path-format=absolute --git-common-dir`), applied only when `.project-manager/` is gitignored so pm-state's git-neutrality rule stays intact — a tracked `.project-manager/` degrades per-worktree with an explicit cannot-aggregate message instead of faking a shared view. `.planning/` stays worktree-local; the `ship-pm` agent becomes the sole aggregator, sweeping `git worktree list --porcelain` (`ship/lane-sweep.cjs`) to report a Lanes section (branch, feature, stage, task progress) in the brief, STATUS.md, and a new `dashboard.html` Lanes panel. The ROADMAP backlog table gains a derived `Lane` column, and in-flight PLAN.md files across lanes are cross-read to warn when two lanes are about to touch the same file paths. `pm-update.cjs` writes ROADMAP.md via temp-then-rename so no partial file is ever observable. `/ship:finish` now archives to the main worktree's root so a feature's audit trail survives `git worktree remove`, and the PM's prune guard no longer removes a lane unconditionally during handover.
- **`--headless` flag for `/ship:go`**: implies `--auto`; under it every interactive point in the go workflow degrades deterministically instead of prompting. A plan-loop `NEEDS_INPUT` parks the replanner's structured questions to `.planning/features/{name}/QUESTIONS.md` (frontmatter + per-question sections + embedded JSON) rather than calling AskUserQuestion, leaves the feature at `planned`, and ends the run; a re-invocation with filled-in answers feeds them back through `args.answers` and the recorded `roundOffset`, then archives the file. Every terminal path — success or not — writes a machine-readable `.planning/features/{name}/OUTCOME.json` (deleted at run start, written last) and ends the final message with a matching fenced outcome block, covering a 10-outcome vocabulary (`done`, `needs-input`, `stuck`, `unresolved`, `blocked`, `verify-fail`, `needs-context`, `exhausted`, `checkpoint`, `error`). `/ship:finish` is never invoked headlessly — a `done` status routes straight to a `done` outcome instead. The contract is documented in `ship/docs/headless.md`. Interactive (non-`--headless`) behavior is byte-identical to before.

## 5.6.0

Minor release — the per-phase review gate stops reporting safety it does not have, and unresolved findings now reach the verifier instead of being dropped at the one-fix-round cap.

### Added

- **Review evidence is part of the review contract**: `REVIEW_SCHEMA` now *requires* `verify_runs` (one entry per re-run verify command — `task_id`, `command`, `exit_code`, and a `pass`/`fail`/`not_runnable` verdict) and `files_reviewed`. Before this, `{status: "APPROVED", findings: []}` was the whole contract, so a review that re-ran every verify command and read the whole diff was byte-identical to one that read nothing. Both fields flow into `completed`, into REVIEW.md as `Verify:` / `Reviewed:` lines under every phase heading, and into the run report; a review that re-ran nothing and read nothing raises an "unsubstantiated verdict" concern on both the workflow and the manual path. `ship-reviewer` gained the `## What NOT to Do` section its plan-review counterpart already carried, naming rubber-stamping first.
- **Unresolved review findings reach the verifier**: `/ship:go` marks a phase done even when critical/high findings survive its one fix round, on the stated grounds that the verifier is the backstop — but the verifier's inputs were CONTEXT.md and PLAN.md, and nothing ever read REVIEW.md, so the backstop was never told what to catch. `ship-verifier` now reads REVIEW.md and treats every `unresolved` critical/high finding as a mandatory Stage 2b target, recording `reproduced` / `not reproduced` / `not testable` for each with the command behind it in a new **Carried Review Findings** table in VERIFY.md. A reproduced finding is a critical/high bug and FAILs. Because the go skill persists REVIEW.md only *after* the build workflow returns, the workflow also passes the same findings in the verifier's prompt — the file and the prompt block are one deduplicated list — and the reconcile cross-checks that VERIFY.md accounted for each one.

### Changed

- **Re-reviews review the fix commits, not just a checklist**: the re-review prompt said "review ONLY whether each finding above is now resolved", so the fix commits — narrow edits at the end of a phase, a classic regression source — were never read as a diff in their own right. A re-review now has two jobs: confirm resolution, and report any new critical/high problem the fixes introduced, flagged `new_issue` so REVIEW.md records it as `new (round 2)` rather than mislabelling it as a leftover.
- **A phase where no verify command could run is escalated**: a `not_runnable` verify was silently treated as passed with a `low` note, which meant a phase whose every verify was waved through as an environment error read as a clean approval. Individual ones are now counted in a concern, and a phase where *every* verify came back `not_runnable` raises a single `high` finding — it has no executable proof at all.
- **The reviewer's scratch record is written in two stages**: `stage: "verify-only"` after the verify re-runs, `stage: "complete"` after the diff review. A reviewer that exhausted its turn budget mid-diff previously left nothing behind, so the salvage retry redid the whole review and could die the same way; now the next reviewer carries the finished `verify_runs` forward and does only the diff. Salvage routes on the stage, and a record carrying no `stage` at all (written before this contract) falls back to a full review instead of landing in a gap.
- **REVIEW.md records every phase, not only phases with findings**: the evidence lines only pay off if a clean phase writes them too — an APPROVED heading over `Verify: 0 re-run` is precisely the record worth keeping.

### Fixed

- **A fix round that commits nothing can no longer be recorded as a fix**: with no fix commits there is no diff range, so the re-reviewer inspected `git diff HEAD`, found a clean tree, and plausibly returned APPROVED — and the reconcile then wrote "fixed in fix round" against every finding, reporting a fix that never happened. Both orchestrators now skip the re-review when the fix builder lands no commits, leave the findings `unresolved`, and raise a concern naming it. `fixApplied` is false in that case, so REVIEW.md cannot claim otherwise.
- **A roadmap slug is validated before it is used as a path**: `mappedStatus` joined the raw `Ship feature` cell under `.planning/archive/` and `.planning/features/`, so a cell holding `..` or a separator resolved outside the feature tree and any directory that happened to exist there marked the row `done`. A slug must now be a single path segment (`[A-Za-z0-9][A-Za-z0-9._-]*`); anything else leaves the row unchanged. The `pm-sync-nudge` hook, which carries the same lookup, got the same guard.
- **Feature status is read from the CONTEXT.md frontmatter only**: the status regex ran over the whole document, so a `status:` line in the body could decide a roadmap row whenever the frontmatter carried no status of its own. Both the updater and the nudge hook now match the leading `---` block, CRLF or LF.
- **The frontmatter `updated` bump survives CRLF**: the block was located with `/^---\n…\n---/`, which never matches a CRLF ROADMAP.md — so on a repo checked out with `core.autocrlf=true` the Status cells updated while `updated:` silently stayed stale. The match is now CRLF-aware and the replacement preserves the line's `\r` rather than converting that one line to LF.
- **The dogfood suites no longer fail on a clean checkout**: `chore: gitignore .project-manager state` made the PM state local, per-repo working data, but three suites (`pm-state-conformance`'s two dogfood blocks and `pm-nudge-verify`'s real-ROADMAP block, 17 assertions) still read it out of the repo — so `node --test` failed anywhere the state was absent, which is every clean clone and the release job itself. They now skip with a stated reason where there is no state to conform, exactly as the v5.4.1 fix did one directory up for `.planning/`.

## 5.5.0

Minor release — a mechanical updater takes over PM state maintenance from prose instructions.

### Added

- **`ship/pm-update.cjs`**: a zero-dependency CLI that applies the pm-state status mapping table to `.project-manager/ROADMAP.md` rows and regenerates `dashboard.html` deterministically from the state files, replacing what used to be prose instructions telling an agent to do this by hand. `node pm-update.cjs [slug ...]` is a silent no-op when `.project-manager/` is absent. Columns are located by header name rather than position, so both the legacy 5-column table and the enriched 7-column one parse, including two differently-shaped tables in the same file.
- **`--next` selection**: `node pm-update.cjs --next` prints the recommended next backlog item as JSON (`{item, milestone, priority, shipFeature}`, or `null`) — the highest-priority non-done, non-blocked item whose Depends-on items are all `done`. `/ship:pm`'s next-style question routing now calls this instead of re-deriving the rule in prose.
- **Lifecycle skills call the updater directly**: `start`, `build`, `go`, `finish`, and `verify` each run `node "${CLAUDE_PLUGIN_ROOT}/ship/pm-update.cjs" {name}` right after they change a feature's CONTEXT.md status, so `.project-manager/` state and the dashboard stay current without a separate `/ship:pm-sync` pass.

### Changed

- **`pm-sync-nudge` points at the mechanical fix**: instead of telling the user to run `/ship:pm-sync`, the hook now prints the exact `node pm-update.cjs {slugs}` command for the drifted rows and reserves `/ship:pm-sync` for structural drift — work with no roadmap row, or rows needing judgment.
- **`/ship:pm` and `/ship:pm-sync` dashboard regeneration** now shells out to `pm-update.cjs` rather than following the pm-state procedure by hand; the manual procedure remains a fallback for when the script is unreadable.
- **`.project-manager/` is no longer tracked in git.** Like `.planning/`, it's generated per-repo local state — the checked-in files under `.project-manager/` were removed and the directory added to `.gitignore`. Existing clones keep their local files; `git pull` will show the removal.

## 5.4.2

Patch release — two token-waste fixes in the `/ship:go` workflows.

### Added

- **Salvage retries**: a lost structured result is a transport failure, not proof the work never happened, so `safeAgent` (in both `ship/workflows/go.workflow.js` and `plan.workflow.js`) gains an optional `retryPrompt` that points the retry at the durable record the previous agent left behind instead of redoing ~90k tokens of work. Four call sites use it — the phase reviewer and plan reviewer write scratch records under `.planning/features/{name}/.review-scratch/` (`phase-{id}[-rereview].json`, `plan-round-{n}.json` — their one permitted write; the read-only-on-source gate still holds), the verifier salvages its own VERIFY.md, and the replanner its own `### Round {n}` subsection in PLAN.md. Every record is fingerprinted — `head` (git HEAD) for phase reviews, `plan_hash` (`git hash-object PLAN.md`) for plan reviews, and a `**Head:**` line in VERIFY.md itself — so a record from a different build or a different plan is rejected rather than salvaged, and a report with no stamp is treated as stale rather than trusted. The builder keeps `retry: false`: PLAN.md plus the progress probe already cover it. Deleting `.review-scratch/` is hygiene, not the safety net.

### Changed

- **Precomputed diff range**: the builder now reports `commits` oldest-first (one atomic commit per task, in task order), so the go workflow derives `{oldest}~1..HEAD` and hands the reviewer a finished range instead of paying turns for it to re-derive one with `git log`. The reviewer falls back to deriving the range itself only when the range errors, the diff comes back empty, or the phase starts at the repo's root commit (where `~1` does not resolve and the empty-tree hash is used instead).
- **VERIFY.md carries a HEAD stamp**: the template gained the line, the verifier fills it from `git rev-parse HEAD`, and its stale-report check requires it to match. This matters on a designed-in path — a FAIL verdict reverts the feature to `plan-verified` and appends fix tasks, so re-verification after a fix round always finds a complete VERIFY.md from the previous round, and the `Verified:` date alone cannot separate the two.
- **Reviewer scratch contract names `all-rereview`**: the contract named `phase-{id}` and `phase-{id}-rereview` for phased reviews but only bare `all` for an unphased plan, leaving an unphased re-review with no defined filename while the workflow looked for `all-rereview`. Both are now named.

## 5.4.1

Patch release — fixes a release-blocking test failure in the 5.4.0 dogfood suite.

### Fixed

- **Dogfood conformance no longer depends on gitignored state**: `tests/pm-state-conformance.test.js` resolved every ROADMAP `Ship feature` slug against `.planning/`, but `.planning/` is gitignored, so the directory exists only on a machine that built the features. The check passed locally and failed on every clean checkout, which broke the v5.4.0 release run. `pm-state`'s status mapping table already treats a slug that resolves nowhere as expected ("`.planning/` may be gitignored or pruned"), so the assertion now runs only where the state exists and skips otherwise.

## 5.4.0

Minor release — the project-manager layer grows from a read-only roadmap view into a working PM.

### Added

- **`ship-pm` agent**: `/ship:pm` now delegates to a dedicated agent (`agents/ship-pm.md`) so project state stays out of the main conversation. It states its own write boundary — `.project-manager/**`, `.planning/**`, `.claude/**`, root `*.md`, and git (`add`, `commit`, `push`, `status`, `log`, `diff`, `worktree prune`) for the files it owns — and never edits application source, never rewrites published history (`reset --hard`, `push --force`, `rebase`), and never invents status: an unverifiable claim is reported as `unverified` with a named next step.
- **Four `/ship:pm` verbs**: `status` (reconstruct the true state from the repo, report the delta, fix the files), `groom` (re-check every item still applies, verify Sources, re-prioritise and re-size), `check <feature>` (audit whether a shipped feature was genuinely verified — one `[PROVEN|UNPROVEN]` line per acceptance criterion with named evidence, filing unproven ones as P0/P1 verification debt), and `handover` (update STATUS.md, record decisions, atomic tracking commits, push, prune worktrees, write a cold-start note). The bare brief and free-text project questions keep their existing routing.
- **Five state files**: `.project-manager/` grows from three to five — `ROADMAP.md`, the new `STATUS.md` (in flight, live status, blocked-with-reasoning, recently shipped, repo hygiene), `DECISIONS.md`, the new `CONVENTIONS.md` (project conventions with a learning loop), and generated `dashboard.html` — plus `decisions/{YYYY-MM-DD}-{slug}.md` spill files for decisions longer than DECISIONS.md's three-line cap, and `#### {Item}` detail sections for backlog items needing more room than a table row.
- **Traceable backlog**: every item carries a mandatory `Source` (a VERIFY.md line reference, a decision, a `file:line`) — do not add an item you cannot point at — and a new **P0** tier for live / customer-facing risk above the existing P1–P3.
- **Dashboard in-flight section**: a new `PM:INFLIGHT` placeholder renders STATUS.md's in-flight work; blockers now carry their reasoning and item rows render Size and Source. Still a single self-contained file with zero network requests.

### Changed

- **`/ship:pm` is no longer read-only** — its `allowed-tools` gain `Write`, `Edit`, `Bash`, and `Agent` for the verbs that maintain state.
- **Sizing is permitted, time is still banned**: backlog items take an optional `Size` of `S | M | L | XL` by plan effort — complexity, not duration. Deadlines, day/week/sprint sizing, and velocity remain banned, and timestamps stay confined to STATUS.md and DECISIONS.md entry dates.
- **`pm-sync-nudge` parses by header name**: the hook locates the `Item`, `Status`, and `Ship feature` columns from the table header rather than assuming a fixed 5-column layout, so tables of either shape — even two different shapes in one file, or columns in a different order — are drift-checked.
- **Back-compat**: a v5.3.0 `.project-manager/` directory (three files, 5-column table, P1–P3) stays fully valid and readable. Nothing auto-migrates; a legacy directory grows into the enriched shape only through a confirmed `/ship:pm-sync` reconcile, which never fabricates a `Source`.

## 5.3.0

Minor release — adds a project-level layer above individual features.

### Added

- **Project Manager layer**: two new skills sit above the feature layer for cross-feature planning. `/ship:pm` is a question router (what's next, what can run in parallel, status, decision history) that never implements — every recommendation ends with a concrete Ship command handoff. `/ship:pm-sync` bootstraps `.project-manager/` on first run (scan repo → propose milestones/backlog → interview → confirm) and reconciles state with reality on later runs.
- **`.project-manager/` state**: `ROADMAP.md` (milestones, backlog, status, priority, dependencies) and `DECISIONS.md` (dated decision log), with no time concepts (no deadlines, estimates, or sizing) and a generated self-contained `dashboard.html` (zero server, zero dependencies, safe to open via `file://`).
- **`pm-sync-nudge` hook**: registered on `Write|Edit` `PostToolUse`, detects drift between a Ship feature's recorded status in `ROADMAP.md` and its actual status, and nudges a `/ship:pm-sync` reconcile — debounced per drift set, without modifying any existing Ship skill.
- **`skills/pm-state`**: new reference skill defining the `.project-manager/` file formats, shared by the PM skills and the nudge hook.

### Changed

- **`.planning/` is no longer tracked in git.** Feature planning state (`CONTEXT.md`, `PLAN.md`, `REVIEW.md`, `VERIFY.md`) is local, per-repo working data — it's now git-ignored instead of committed. Existing clones keep their local files; `git pull` will show them as untracked.

## 5.2.0

Minor release — `/ship:go` now carries a feature from `planned` to `plan-verified` unattended.

### Added

- **Plan revision loop**: at status `planned`, `/ship:go` runs `ship/workflows/plan.workflow.js` instead of stopping on the first NEEDS-REVISION verdict. Each round reviews the plan, hands the surviving CRITICAL findings to a replanner that revises PLAN.md, and re-reviews — capped at 5 rounds, with a convergence guard that stops the moment a round's CRITICAL set repeats rather than burning the remaining rounds. Agent output stays inside the workflow, out of the main conversation context.
- **`ship-replanner` agent**: revises PLAN.md against plan-review CRITICAL findings. PLAN.md is its only writable artifact — a HARD-GATE forbids touching CONTEXT.md, which stays human-owned brainstorm output. It is biased against interrupting: `needs_input` is only for a decision that changes the plan's structure and cannot be settled from CONTEXT.md, the codebase, or existing conventions, and every escalation must carry 2-4 concrete options.
- **`ship-plan-reviewer` agent**: the plan-review contract, extracted so the loop and `/ship:plan-verify` share one prompt instead of duplicating it. From round 2 on, the review is scoped to whether the prior findings are resolved plus new findings that would actually break the build.
- **`/ship:go --auto`**: skips the "Ready to build?" approval gate for a fully hands-off run. Without the flag the gate still fires.

### Changed

- **`/ship:plan-verify` delegates to `ship-plan-reviewer`** rather than carrying an inline reviewer prompt, and stays single-shot — one review, one verdict, you decide. The revision loop is the `/ship:go` path only.
- **Only `NEEDS_INPUT` interrupts**: the loop asks the replanner's questions via AskUserQuestion and re-invokes with the answers. `STUCK` (the same CRITICALs recurred), `UNRESOLVED` (5 rounds spent), and `BLOCKED` (an agent returned nothing after retry) all leave the feature at `status: planned`, report the surviving findings, and never proceed to build — a plan is never approved without a completed review.

### Fixed

- **A review result missing its `findings` array blocks instead of crashing the run**: the field is schema-required, but the StructuredOutput wrapper has dropped required fields before. The loop read it unguarded, so a flaked result threw a TypeError out of the workflow. It now returns `BLOCKED` — an incomplete review is never an approval, and it must not fall through to `APPROVED` on an empty CRITICAL set either.
- **`roundOffset` is coerced to a number**: the `go` skill hand-builds the workflow args, so a string `"3"` made `round + roundOffset` concatenate and label the PLAN.md history subsection `### Round 13` instead of `### Round 4`.

## 5.1.0

Minor release — a builder running out of turn budget no longer aborts the build.

### Fixed

- **Turn-budget exhaustion continues the phase instead of stopping the run**: large tasks routinely spend a builder's whole turn budget after 2-3 tasks. The builder died without emitting `build_result`, `/ship:go` read that empty return as a dead phase, and stopped — even though the completed tasks were committed and marked done in PLAN.md, and one more builder would have finished the phase. The workflow now continues with a fresh builder while work keeps landing (up to 5 rounds per phase), and stops only when a round lands no new done tasks.
- **Empty builder returns are checked against PLAN.md**: when a builder returns nothing at all, a read-only progress probe reports the phase's real task status. A phase whose tasks are all done completes normally (carrying a concern about the silent exhaustion) instead of being reported as a failed build.
- **Partial progress is reported, not lost**: a phase that genuinely stalls now returns `EXHAUSTED` with the tasks completed and commits landed across every round, so `/ship:go` reports what was built and points at `/ship:build` (continue) or `/ship:plan` (split the remaining tasks).

### Changed

- **New builder status `PARTIAL`**: the builder now hands off deliberately when the remaining tasks won't fit its turn budget — everything it touched is verified, committed, and marked done — rather than dying mid-task. Continuation builders are told PLAN.md is the source of truth and to finish any interrupted task left in the working tree.
- **Builder `maxTurns` raised from 40 to 60**, reducing how often a phase needs a context-losing handoff.
- **Manual `/ship:build` continuation is progress-based**: it continues while the PLAN.md done-count keeps rising (up to 4 rounds) instead of a fixed 2 SendMessage retries, and confirms progress from PLAN.md rather than the builder's self-report.
- **Phase diffs span continuation rounds**: the reviewer receives the union of every round's commits, so the phase diff covers the whole phase rather than the last builder's slice.

## 5.0.2

Patch release — the verify-FAIL loop now re-enters `/ship:go`, and unreviewed phases leave a durable record.

### Fixed

- **Verify FAIL re-enters `/ship:go` on phased plans**: the verifier appended fix tasks as bare `<task>` elements, so on a phased plan (all phases done) go's pending-phase extraction found nothing, passed an empty phase list to the workflow, and skipped straight to verify-only — re-running the verifier against unfixed code and appending duplicate fix tasks. The verifier now wraps fix tasks in a new pending phase (`fix-1`, incrementing on repeat failures); the go skill also sweeps orphaned fix tasks from older plans into the `{id: "all"}` pseudo-phase, and its FAIL report points to `/ship:go` instead of the `/ship:build`-then-`/ship:go` workaround.
- **Skipped reviews are recorded in REVIEW.md**: a phase whose reviewer died twice (`reviewStatus: SKIPPED`, empty findings) was previously omitted from REVIEW.md entirely — the one phase that went unreviewed was the one with no record. It now gets its heading with `Status: SKIPPED`.

## 5.0.1

Patch release — hardens the go workflow's result handling and fixes a Windows launch failure.

### Fixed

- **Review findings outrank the verdict**: an `APPROVED` review that still listed critical/high findings previously skipped the fix round, and those findings were recorded as merely informational. Blocking findings are now derived from severities regardless of the reviewer's verdict, in both the review and re-review rounds.
- **A dead reviewer surfaces as a concern**: when both review attempts fail, the phase previously completed with `reviewStatus: 'SKIPPED'` and nothing user-visible. The workflow now injects a "review never ran — the diff went unreviewed" concern into the channel the go skill already reports.
- **Review prompt no longer assumes commit ordering**: the phase diff range was derived as `<first-commit>~1..HEAD`, which silently narrowed the reviewed diff to a single commit if a builder reported commits newest-first. The reviewer now confirms ordering with `git log`, and the ill-defined merge-base fallback is replaced with `git diff HEAD`.
- **Workflow scripts check out as LF**: the Workflow engine's permission layer rejects scripts containing CR bytes, so `/ship:go` failed to launch on Windows where `core.autocrlf` checked the plugin cache copy out as CRLF. A `.gitattributes` rule (`ship/workflows/*.js text eol=lf`) fixes installed copies at the source.

## 5.0.0

Doctrine release — the ruleset moves from prescriptive micromanagement to outcome-gated guidance: contract the artifacts, gate the outcomes, free the process. Machine contracts (task XML, result JSON shapes, go.workflow.js schemas, status state machine) are unchanged.

### Changed

- **Outcome gates replace question/task quotas**: the brainstormer writes CONTEXT.md only when the problem, scope boundary, and 3+ testable acceptance criteria can be stated without guessing and the user has confirmed — question count is judgment ("5-10+ questions" and the HARD-GATE minimums are gone). The plan's task-count floor is removed (the ~12-task ceiling stays as a split trigger).
- **Exploration scales to uncertainty**: the plan skill's mandatory 3-agent exploration fan-out is removed — it reuses CONTEXT.md Codebase Notes when present, explores inline for small or familiar surfaces, and fans out Explore agents only for large or unfamiliar ones.
- **Contracts-vs-internals task altitude**: plan `<action>`s specify observable, load-bearing contracts (schemas, endpoint shapes, error behavior at boundaries, library choices, integration points) and leave internals (function names, decomposition, imports) to the builder. New litmus: would two reasonable implementations differ in a way the user cares about?
- **Builder internals latitude with surface-don't-take**: the builder follows planned contracts exactly, owns unspecified internals, and surfaces materially better approaches as deviations/concerns or NEEDS_CONTEXT — never silently substituting its own approach for a planned contract.
- **Plan-verify runs as a fresh-context subagent**: the skill orchestrates inline but delegates the review to a general-purpose subagent that shares none of the planner's conversation. Grounding checks (paths, references, depends IDs, packages, verify-command feasibility) are retained; format-policing checks are gone; the plan's self-checks 6.2–6.7 move to the reviewer as judgment (the acceptance-coverage map and adversarial review stay in plan).
- **Design proposes feature-specific approaches**: the three canned philosophy agents (minimal changes / clean architecture / pragmatic balance) are replaced by 2-3 genuinely distinct approaches derived from the feature's actual decision axes.
- **Build skill deduplicated**: the orchestrator's Trust-But-Verify re-run is removed (the reviewer already re-runs every phase verify command — verifies run 2×, matching the go-workflow path), and the pre-build Explore digest is now conditional on phase size instead of mandatory.

### Removed

- **`INFRA_DETECTED` and the NFR routing table**: replaced by two sentences of judgment guidance — probe the NFR dimensions the codebase makes relevant, skip the ones that plainly don't apply.
- **Brainstormer `model: opus` pin**: the agent inherits the session model, consistent with the builder/reviewer/verifier.

## 4.1.0

Minor release — reviewer and verifier follow the session model, plus reliability fixes at the seams between the agents and the two orchestration paths.

### Changed

- **Reviewer and verifier inherit the parent model**: `ship-reviewer` and `ship-verifier` no longer pin `model: sonnet` in frontmatter — like the builder, they inherit the parent session model. The brainstormer keeps its explicit `opus` pin.

### Fixed

- **go workflow re-review prompt embeds the findings**: each workflow `agent()` call spawns a fresh agent, so the re-reviewer had no memory of the round-1 critical/high findings it was asked to confirm as resolved. The re-review prompt now lists the findings and the fix commits explicitly.
- **`VERIFY_SCHEMA` accepts `criteria_verdicts`**: the verifier is instructed to report per-criterion verdicts, but the workflow schema's `additionalProperties: false` rejected the field, forcing a validation retry that silently dropped the evidence. The schema now includes it.
- **Verifier diff-base handles an empty diff**: `git merge-base HEAD main` is HEAD itself when the feature was built directly on main, leaving Stage 2's changed-file list empty. The fallback (feature commits via `git log --grep`, or PLAN.md `<files>`) now also fires on an empty diff, not just a git error.
- **Reviewer Inputs documents all invocation forms**: diff range (manual build), commit list (go workflow), or neither (working tree vs merge-base) — previously only the diff-range form was described.
- **go skill persists review findings to REVIEW.md**: findings from `/ship:go` phases only appeared in the chat report; the reconcile step now appends them to REVIEW.md in the same format as the manual build path.
- **Verifier verdict asymmetry made explicit**: grep evidence can prove absence (→ FAIL) but never correctness (existence alone is at most INCONCLUSIVE); the FAIL definition previously required an executed verify command, contradicting the wiring rule.

## 4.0.2

Patch release — `/ship:go` survives flaky agent crashes instead of dying after the work is already committed.

### Fixed

- **go workflow retries agent crashes, then degrades gracefully**: the Workflow harness's final-JSON schema wrapper (`StructuredOutput`) has flaked and thrown even when the agent's underlying work was already committed and green, killing the whole run and losing only orchestration state. Every `agent()` call in `ship/workflows/go.workflow.js` now goes through a `safeAgent` wrapper — one retry, then degrade to a `null` result that the existing null-paths handle (build → `stoppedAt: NO_RESULT`, review → `SKIPPED`, verify → null verdict). Retrying is safe because PLAN.md tracks task status and commits are atomic, so a retried builder sees done tasks and returns quickly.
- **Unconfirmed re-reviews surface as unresolved**: if critical/high findings triggered a fix round but the re-review produced no result, the findings are now reported as `unresolved` instead of the phase silently reading as clean.
- **go skill handles a null verdict**: when all phases build but the verifier produces no result, the skill sets `status: built`, confirms the build commits landed, and directs the user to manual `/ship:verify` (previously this case had no defined handling).
- **Version test derives from `ship/VERSION`**: `tests/rearchitecture-v4.test.js` asserted a hardcoded `4.0.0` and broke on every release; it now reads the expected version from `ship/VERSION` so the three version files just have to agree.

## 4.0.1

Patch release — fix `/ship:go` failing on a clean run.

### Fixed

- **`/ship:go` workflow tolerates string-encoded `args`**: the Workflow runtime can deliver the `args` payload to `ship/workflows/go.workflow.js` as a JSON-encoded string (sometimes double-encoded) instead of the parsed object the docs promise, so `args.feature` read `undefined` and the workflow threw `go.workflow: args.feature is required` immediately. The workflow now unwraps up to a couple of layers of string encoding before reading `feature`/`phases`/`keyFileContext`, and still fails with the clear required-field error on genuinely malformed input. The fix is pure JavaScript (no shell, paths, or platform calls), so it runs identically on macOS and Windows.

## 4.0.0

Re-architecture for modern Claude Code capabilities — cut token waste in `/ship:go` by moving orchestration onto the Workflow engine, collapsing the verification stack, and stripping defensive prose the agents no longer need. **Breaking:** `/ship:qa` is removed and the status flow changes.

### Changed

- **`/ship:go` runs on the Workflow engine**: the repetitive, non-interactive build→verify spine now executes in `ship/workflows/go.workflow.js` via schema-validated `agent()` calls, so per-phase builder/reviewer/verifier output stays out of the main conversation context instead of being collected into it. The interactive steps (plan, plan-verify, plan-approval gate, finish) still run inline in the `go` skill. The old `ship/workflows/go.md` markdown state-machine is removed.
- **Verification collapsed from 4 layers to 2**: a pre-build plan check (`/ship:plan-verify`) and a single post-build gate (`/ship:verify`). The verifier now does its own adversarial testing and anti-pattern scan instead of re-synthesizing pre-gathered `/review` + QA findings, eliminating the findings-shuttling that double-handled text through the main window.
- **Reviewer absorbs trust-but-verify**: `ship-reviewer` now re-runs each phase's `<verify>` command before reviewing the diff (a failing verify is a critical finding), so the workflow doesn't need a separate orchestrator-level re-run.
- **Agents slimmed ~50%**: removed the rationalization tables, forbidden-responses sections, and analysis-paralysis guards that were scaffolding for weaker models. Net ~960 → ~400 lines across the agents, reducing input tokens on every agent invocation.
- **Structured output replaces text-JSON parsing**: the go workflow validates agent output via JSON Schema (`StructuredOutput`) rather than parsing fenced `build_result`/`review_result`/`verify_result` blocks. The agents still emit those blocks for the manual skill paths.
- **`VERIFY.md` template collapsed from 4 stages to 2**: a Stage 1 acceptance-criteria table and a Stage 2 "Bug Hunt & Quality" section (adversarial tests, bug findings, anti-pattern scan, quality notes). The separate Stage 3 (`/review`) and Stage 4 (QA) sections are gone.

### Removed

- **`/ship:qa` skill and `ship-qa` agent**: adversarial testing and the anti-pattern scan are now part of `ship-verifier` (single post-build gate). `QA.md` and its template are gone.
- **`hooks/subagent-stop.cjs`**: schema validation replaces text-JSON format validation; the manual build skill retains its own auto-continue recovery. Ship now ships 5 hooks.
- **Status states `qa-passed` / `qa-failed`**: the flow is now `built → done` via `/ship:verify` (FAIL appends fix tasks and reverts to `plan-verified`).

### Migration

- `claude plugin update ship` (or re-sync a legacy `.claude/` install). Any feature sitting at `qa-passed` should be advanced with `/ship:verify`; `qa-failed` features should run `/ship:build` then `/ship:verify`.

## 3.6.0

Build context isolation — three changes that push the build orchestrator's context window back toward its floor by keeping raw file bodies out of the orchestrator and bounding verify capture.

### Changed

- **Delegated pre-build digest**: the build orchestrator now spawns the read-only `Explore` agent to produce `## Key File Context`, keeping raw file bodies out of the orchestrator window (graceful-degrades to empty context on failure).
- **Bounded trust-but-verify capture**: verify pass/fail is decided on exit code; only a 5-line tail is kept on success, full output re-pulled only on failure.
- **JSON-only builder/reviewer handoffs**: `ship-builder` and `ship-reviewer` final messages are the fenced JSON block only, with no trailing prose.

## 3.5.0

Build quality — four orchestrator-level improvements that move quality checking into the build loop instead of deferring it all to `/ship:qa` and `/ship:verify`, plus a new read-only reviewer agent.

### Added

- **Per-phase review gate**: A new `ship-reviewer` agent reviews each completed phase's `git diff` before the phase is marked done. Critical/high findings are sent back to the same builder via SendMessage for exactly one fix round and re-reviewed; medium/low findings are recorded but don't burn builder turns. All findings (fixed and unresolved) append per-phase to `.planning/features/{name}/REVIEW.md` so `/ship:qa` and `/ship:verify` can cross-check and they survive compaction. A reviewer failure (error, turn exhaustion, unparseable output) degrades gracefully — the phase proceeds with a "review skipped" concern and the build is never blocked.
- **`ship-reviewer` agent**: New read-only agent in `agents/ship-reviewer.md` that emits a `review_result` JSON block. Ship now ships 5 agents (brainstormer, builder, qa, reviewer, verifier).
- **Trust-but-verify gate**: After the builder claims COMPLETE, the build orchestrator re-runs every task's `<verify>` command before marking the phase done. A failure is sent back to the builder with the command output; a repeat failure after the fix round stops the build with a CHECKPOINT.
- **Interactive NEEDS_CONTEXT**: A NEEDS_CONTEXT result now triggers AskUserQuestion in the orchestrator, and the answer is SendMessaged back to the still-alive builder instead of dead-stopping the loop and discarding warm context. Applies in both `/ship:build` and `/ship:go` (capped at 2 rounds per phase; a third stops the build).
- **`review_result` validation**: `hooks/subagent-stop.cjs` validates the `ship-reviewer` agent's `review_result` block, with recovery-message injection on missing/invalid output and tests under `node --test`.

### Changed

- **Builder inherits the session model**: Dropped the pinned `model: sonnet` from `agents/ship-builder.md` so the builder runs on the session model instead of silently downgrading Opus or Fable sessions. Other agents (brainstormer, qa, verifier) are unchanged.
- **`/ship:go` workflow**: Removed NEEDS_CONTEXT from its stop conditions and adopted the same ask-then-resume flow as the build skill.
- **CLAUDE.md and README**: Updated for the new build flow — reviewer agent, REVIEW.md artifact, per-phase review gate, trust-but-verify, interactive NEEDS_CONTEXT, and the updated agent count.

## 3.4.0

Pipeline rigor — five interlocking changes that tighten the brainstorm → plan → build → QA → verify pipeline.

### Added

- **Adaptive NFR probe in brainstormer**: Detects project signals (`package.json`, `Dockerfile`, `.github/workflows/`, prior CONTEXTs) and asks only the non-functional requirement questions that apply — perf/scale, observability, rollout/flag/migration, security/data, error handling. Skips irrelevant NFRs (e.g., no rollout questions for a CLI tool) to avoid "N/A spam."
- **INCONCLUSIVE verify verdict**: Verifier now emits per-criterion verdicts ∈ {PASS, FAIL, INCONCLUSIVE}. Criteria with no runnable `<verify>` command that would otherwise have been judged via grep-only evidence are marked INCONCLUSIVE instead of being rubber-stamped as PASS.
- **`qa-failed` status**: New first-class status replaces the broken `plan-verified` rollback on QA failure. Distinct from `plan-verified`; signals "plan was valid, implementation was buggy, fix tasks appended." Original task completion marks are preserved; new fix tasks append to PLAN.md under `## Fix Tasks (from QA)`. Status flow is now `brainstormed → planned → plan-verified → building → built → qa-passed → done`, with `qa-failed` as a side branch from `built`.
- **`--accept-inconclusive` override for `/ship:finish`**: When VERIFY.md contains any INCONCLUSIVE verdict, `/ship:finish` refuses to proceed unless `--accept-inconclusive` is passed. The override and reason are written into VERIFY.md for audit trail.
- **`test-rigor` exemplar fixture**: Synthetic dogfood feature preserved in the repo at `.planning/features/test-rigor/` as a reference exemplar of a feature walked through the upgraded pipeline end-to-end.

### Changed

- **QA agent uses git diff as source of truth**: QA now reads `git diff $(git merge-base HEAD main)..HEAD` instead of trusting `PLAN.md`'s `<files>` list. Catches builder deviations (Rule 1) that the static plan misses. QA.md cites files from the diff.
- **QA owns the anti-pattern scan**: TODO/FIXME/HACK/XXX/placeholder/stub/not-implemented scanning moved entirely into QA. The verifier now reads `QA.md` instead of re-scanning, eliminating duplicated grep work and contradictory verdicts.
- **VERIFY.md template**: Updated for per-criterion verdicts and override recording.
- **`/ship:resume`, `/ship:status`, `/ship:go` skills**: Recognize `qa-failed` as a first-class status. Resume routes from `qa-failed` to `/ship:build` then `/ship:qa`, skipping plan-verify.
- **`/ship:help` skill**: Documents the INCONCLUSIVE concept, `--accept-inconclusive` override, and `qa-failed` status.
- **CLAUDE.md**: Status-flow section updated to include `qa-failed`.

### Compatibility

In-flight features keep their original semantics; no auto-migration. New rules apply only to features started after 3.4.0.

## 3.3.0

### Added

- **QA step**: New standalone QA step between build and verify. The `ship-qa` agent acts as an adversarial tester — auto-discovers the project's test framework, writes risk-based tests across 6 categories (happy path, boundary, negative input, error handling, concurrency, security), commits test files with `test(feature): ...` format, and produces a structured QA.md report with bug findings.
- **`/ship:qa` skill**: Orchestrates QA execution, handles pass/fail status transitions, and appends fix tasks to PLAN.md on critical/high bugs.
- **QA.md template**: Structured report format with risk assessment, test files written, bug findings table, exploratory analysis, and verdict.
- **Verifier Stage 4**: Verifier agent now processes QA findings in a new Stage 4, affecting the verification verdict. Critical/high QA bugs block a PASS verdict.
- **QA agent output validation**: `subagent-stop.cjs` hook validates `qa_result` JSON blocks from the `ship-qa` agent, with recovery message injection on missing/invalid output.
- **New `qa-passed` status**: Status flow is now `brainstormed → planned → plan-verified → building → built → qa-passed → done`. QA gates verification — users cannot skip QA and go directly to verify.

### Changed

- **Go workflow**: Runs QA after build automatically. Stops on QA failure (fix tasks written, needs rebuild).
- **Verify skill**: Now looks for features with status `qa-passed` (not `built`). Reads QA.md and passes findings to verifier agent.
- **Resume, status, help skills**: Updated to reflect the new QA step in status tables, next-step suggestions, and command listings.

## 3.2.0

### Added

- **Feature archiving**: `/ship:finish` now moves completed feature directories from `.planning/features/` to `.planning/archive/` after PR creation or local merge. Keeps the active features directory clean while preserving full history (CONTEXT.md, PLAN.md, VERIFY.md). Option 3 (keep as-is) skips archiving.

## 3.1.0

### Added

- **Reference field in tasks**: Plan tasks now include a `<reference>` pointing to the closest existing code pattern. The builder reads the referenced file first and uses it as a template, producing more consistent code.
- **Adversarial self-review (Step 6.8)**: Plans are now stress-tested for idempotency, null inputs, unavailable dependencies, race conditions, and security surfaces before writing.
- **Integration verify rule**: The last task's verify command must exercise the complete feature path end-to-end, not just an isolated unit.
- **Exploration Summary in PLAN.md**: Key exploration findings (similar patterns, architecture, conventions) are now persisted in PLAN.md so the builder has codebase context without re-exploring.
- **Error path specification**: Tasks at system boundaries must specify error responses (status codes, error shapes, logging) in their action instructions.
- **Context-aware phasing**: Phases are now sized to fit within the builder's context window (40 maxTurns, ≤15 unique files per phase).
- **Task dependencies**: Optional `depends` attribute on tasks for non-sequential dependency chains.
- **Plan-verify enhanced checks (2.5)**: Verifier now validates reference file existence, dependency ordering, error path coverage, integration verify, and exploration summary presence.
- **Builder reference awareness**: Builder reads `<reference>` files before implementing each task.

## 3.0.3

### Changed

- **Structured agent output**: Builder and verifier agents now emit JSON blocks (`build_result`, `verify_result`) instead of free-text Markdown. Build and verify skills parse JSON fields directly for reliable status handling.
- **Shared feature scanner**: Extracted duplicated feature-scanning logic from `guide.cjs` and `post-compact.cjs` into a shared `scan-features.cjs` module.
- **Hook-injected feature state**: Skills no longer embed inline shell commands (`!` expansions) to scan feature state at load time. All 14 skills now rely on hook-injected "SHIP ACTIVE FEATURES" context from session start and post-compaction hooks.
- **Subagent-stop hook**: Updated to parse new JSON `build_result` format with fallbacks for raw JSON and legacy Markdown format.

## 3.0.2

### Fixed

- **Status line**: Rewrote statusline to use Claude Code's native `rate_limits` and `used_percentage` input schema fields. Removed OAuth token resolution and API fetch machinery (~100 lines). Rate limits and context percentage are now read directly from the input JSON.

### Added

- Session cost display in the status line (reads `cost.total_cost_usd` from input)

### Note

The plugin system does not support `statusLine` registration natively. After installing, add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/marketplaces/dilhanz-ship/hooks/statusline.cjs"
  }
}
```

## 3.0.0

Ship is now a Claude Code plugin. Install with `claude plugin install ship` or from the marketplace with `/plugin marketplace add dilhanz/ship`.

### Breaking Changes

- **Plugin distribution**: Ship is distributed as a Claude Code plugin instead of a manual installer. The old `npx github:dilhanz/ship` method is deprecated.
- **Skill names renamed**: All skills drop the `ship-` prefix. `ship-start` becomes `start`, invoked as `/ship:start`. The plugin namespace `ship:` handles disambiguation.
- **Hook files renamed**: All hook files drop the `ship-` prefix (e.g., `ship-guide.cjs` -> `guide.cjs`).
- **Removed skills**: `update` and `uninstall` skills removed — the plugin system handles both natively via `claude plugin update` and `claude plugin uninstall`.
- **Removed hooks**: `check-update` hook removed — plugin system handles update checks natively.

### Added

- `.claude-plugin/plugin.json` manifest for Claude Code plugin system
- `hooks/hooks.json` for declarative hook registration with `${CLAUDE_PLUGIN_ROOT}` paths
- `.claude-plugin/marketplace.json` for GitHub-based distribution via `/plugin marketplace add dilhanz/ship`
- `${CLAUDE_PLUGIN_DATA}` support for temp/cache file isolation (session metrics, context bridge files)

### Changed

- All 14 skill directories renamed: `ship-X` -> `X`
- All 6 hook files renamed: `ship-X.cjs` -> `X.cjs`
- Agent `skills:` frontmatter references updated to unprefixed names
- All hardcoded `.claude/` paths replaced with `${CLAUDE_PLUGIN_ROOT}/`
- Hook temp/cache paths use `${CLAUDE_PLUGIN_DATA}` with `os.tmpdir()` fallback for legacy mode
- Guide hook command references updated from `/ship-X` to `/ship:X` format
- `install.js` marked as deprecated with console warning (still functional for legacy users)
- `install.js` deregister filters tightened to path-anchored `.includes()` checks
- CLAUDE.md and README.md updated for plugin system documentation
