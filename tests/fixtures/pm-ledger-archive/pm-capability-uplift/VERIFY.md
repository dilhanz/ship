# Verification Report — pm-capability-uplift

**Feature:** pm-capability-uplift
**Verified:** 2026-08-11
**Overall Status:** INCONCLUSIVE

7 of 8 acceptance criteria PASS with executed evidence. One criterion (`check <feature>` debt filing)
is INCONCLUSIVE: half of it is proven by a real, spot-checked artifact, the other half was
deliberately not exercised end-to-end and the team recorded that gap in its own backlog.

## Stage 1 — Acceptance Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `skills/pm-state/SKILL.md` documents all five state files, the 7-column backlog table, the `#### {item}` detail-section convention, the `decisions/{date}-{slug}.md` spill files, the P0–P3 key, and the Size column — and a `node --test` assertion covers each | PASS | Read `skills/pm-state/SKILL.md` (213 lines): five files listed L10-18, exact header L39, `### Detail sections` L42-46, spill-file path L131, P0–P3 key L30, Size enum L31, `## Backwards compatibility` L195. `node --test tests/pm-wiring.test.js` → the `pm wiring — state format contract` block (4 tests: exact header · `no time estimates` + `S \| M \| L \| XL` · STATUS.md/CONVENTIONS.md/`decisions/`/`#### `/back-compat · P0–P3) all pass |
| `hooks/pm-sync-nudge.cjs` parses the backlog table by header name and produces correct drift output against **both** a legacy 5-column ROADMAP and a new 7-column one; tests cover both | PASS | `hooks/pm-sync-nudge.cjs:42-52` locates `Item`/`Status`/`Ship feature` by `indexOf` on the header row; no fixed column count remains. `node --test tests/pm-nudge.test.js tests/pm-nudge-adversarial.test.js` → 33 pass / 0 fail, including the `v5` legacy re-runs, the mixed-shape file, and the reordered-column case. Verifier-authored `tests/pm-nudge-verify.test.js` → 8/8 pass, incl. drift detected against this repo's own committed `ROADMAP.md` (`pm-capability-uplift: roadmap says in-progress, actually done`) |
| `/ship:pm` documents the four verbs plus bare-brief and free-text-question routing, and its `allowed-tools` include the write, Bash, and Agent access the verbs require | PASS | Executed 14 structural assertions over `skills/pm/SKILL.md` — all PASS: `allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent`; `argument-hint` lists all verbs; routing line names all four; `## Bare brief (no arguments)`; free-text branch; one quoted brief per verb; next-style / parallel-style / decision-history routing all preserved; trailing `$ARGUMENTS` |
| `agents/ship-pm.md` exists, states the write boundary and the never-edit-application-source and never-rewrite-history rules; `/ship:pm` delegates to it | PASS | Executed 13 structural assertions over `agents/ship-pm.md` — all PASS: `name: ship-pm`, `tools` incl. Write/Edit/Bash, `maxTurns: 40`, `<HARD-GATE>` block, all four write globs, all seven permitted git verbs, `Never edit application source`, `reset --hard`/`push --force`/`rebase`, `Never invent status`, `Never begin implementation`, reads `pm-state/SKILL.md`. Delegation: `skills/pm/SKILL.md:26` invokes the Agent tool with `subagent_type: "ship:ship-pm"` — matching the `ship:ship-<name>` convention used at `ship/workflows/go.workflow.js:248,335,388` |
| `pm-state` permits S/M/L/XL sizing while still banning deadlines and day/week estimates, and the existing no-estimates test is narrowed to match rather than deleted | PASS | `skills/pm-state/SKILL.md:189` hard rule 1: "no deadlines, no time estimates, no day/week/sprint sizing, no velocity. Sizing by plan effort (`S \| M \| L \| XL`) **is** permitted". `git diff 51241e1..HEAD -- tests/pm-wiring.test.js` shows the assertion **replaced, not removed**: `-assert.ok(c.includes('no estimates'))` → `+assert.ok(c.includes('no time estimates'))` **and** `+assert.ok(c.includes('S \| M \| L \| XL'))` |
| `/ship:pm check <feature>` run against a real archived-or-done feature reports each acceptance criterion as proven or unproven with named evidence, and files unproven ones as verification debt at P0/P1 | INCONCLUSIVE | **Reporting half proven.** `CHECK-DRYRUN.md` carries 14 `- [PROVEN\|UNPROVEN]` lines; the audited source has exactly 14 criteria (`grep -c "^- \[" ~/src/clean24new/.planning/archive/admin-dashboard-redesign/CONTEXT.md` → `14`) and the criterion texts match. Evidence is real, not hallucinated: cited `DashboardPageBuilder.cs:188` is `HasAccessAsync("dashboard-v2", …)`, `:192` is `return BuildV2Dashboard(…)`, `:646` is the `BuildV2Dashboard` definition, `:949` is `RefreshIntervalSeconds = 30` — all resolve at the exact cited lines. Verdict line present. **Debt-filing half not exercised.** The four UNPROVEN criteria were filed nowhere; one meta item was filed instead (`.project-manager/ROADMAP.md` M1, P1, Source `CHECK-DRYRUN.md`). The repo's own ROADMAP records it: "the verb's debt-filing path has therefore never run end-to-end against a ship-owned feature." No runnable command can settle this — the verb is a prompt, and `.planning/archive/` in this repo is empty |
| Dogfood: `.project-manager/` is bootstrapped via the enriched `/ship:pm-sync`, containing all five files, and `dashboard.html` renders from `file://` with zero network requests | PASS | `node --test tests/pm-state-conformance.test.js` → 15/15 pass. Five non-empty files present; every backlog row obeys the documented contract (status enum, P0–P3, S/M/L/XL/—, mandatory non-`—` Source); every Depends-on resolves to a real item; every slug resolves under `.planning/`; every `#### ` section indexes a real row; STATUS.md's five sections in documented order; DECISIONS.md newest-first within the 1–3 line cap; dashboard has **zero** `http://`/`https://`/`@import`/`url(`/`<iframe>`/`<script>`/`<link>`/`srcset`/inline handlers, no unreplaced `<!-- PM: -->` placeholders, balanced structural tags, and renders every milestone and backlog item from ROADMAP.md plus real STATUS.md in-flight content |
| `node --test` passes across the whole suite, including the updated `pm-wiring`, `pm-nudge`, and `pm-nudge-adversarial` tests | PASS | `node --test "tests/*.test.js"` (CI's exact invocation, `.github/workflows/release.yml:82`) → **tests 215, pass 215, fail 0** across 46 suites |

## Stage 2 — Bug Hunt & Quality

### Adversarial Tests

- **Categories tested:** boundary (header-context lifecycle, cell-count edges), negative-input
  (malformed/omitted cells, lowercase headers, unbalanced pipes), error-handling (hook must never
  throw or block), happy-path-on-real-artifacts (the shipped ROADMAP.md and dashboard.html)
- **Tests written:** 23  **Passed:** 23 / 23
- **Test files committed:**
  - `tests/pm-nudge-verify.test.js` (8 tests) — commit `97fb7e6`
  - `tests/pm-state-conformance.test.js` (15 tests) — commit `c1c7921`

The parser's riskiest rule — clearing the active header context on a non-blank, non-table line — was
attacked from both directions, since the plan's own Risk Notes flagged it:

- A **blank** line between header and rows must *not* drop the table → passes.
- A `#### Detail` prose section between two tables must *not* let headerless rows inherit the previous
  header → passes (`beta` correctly absent from the drift output).

The dogfooded `.project-manager/ROADMAP.md` was fed to the shipped hook directly: it drifts correctly
when the feature is archived, and stays silent when reality matches. The format the feature documents
and the state the feature wrote are therefore mutually consistent, not just individually plausible.

One authored test initially failed and was corrected — the dashboard renders inline `` `code` ``
spans as `<code>` elements, so the raw-HTML substring comparison was wrong, not the generator. Fixed
by comparing against tag-stripped text.

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | low | silent-failure | Header matching is exact and case-sensitive, so a table whose header reads `\| item \| status \| … \|` (or any reworded column) is skipped entirely — drift detection silently stops for that table with no warning anywhere. Documented in pm-state as "must be exactly", and a legacy table cannot hit it, but a hand-edited ROADMAP can | `hooks/pm-sync-nudge.cjs:42-45` | Open |
| 2 | low | documentation | `README.md`'s command list (L38-48) documents `/ship:verify` and `/ship:finish` but neither `/ship:pm` nor `/ship:pm-sync`. Pre-existing since 5.3.0, not introduced here, but the PM layer roughly tripled in this release and the public README still does not mention it | `README.md:38-48` | Open |

No critical or high bugs found.

### Anti-Pattern Scan

- TODO/FIXME/placeholder/stub markers: **None** in the 22 changed files. The two grep hits are a
  CHANGELOG entry describing the anti-pattern scan itself (`CHANGELOG.md:216`) and a test comment
  (`tests/rearchitecture-v4.test.js:156`) — neither is a marker.
- Empty function bodies / hardcoded values: **None**. `parseRoadmapRows` is a complete rewrite with no
  dead branches; the three magic strings it matches (`Item`, `Status`, `Ship feature`) are the
  documented contract, not incidental constants.
- Broken imports / convention violations: **None**. The hook stays on Node built-ins only
  (`fs`, `path`, `./scan-features.cjs`), keeps its top-level try/catch and silent `process.exit(0)`,
  and preserves the `hookSpecificOutput` shape. All three version files read `5.4.0` and a matching
  `## 5.4.0` CHANGELOG section exists, so `.github/workflows/release.yml` will accept the tag.

### Quality Notes

- The header-context state machine is the right shape for the problem and the JSDoc at
  `hooks/pm-sync-nudge.cjs:12-26` accurately describes the behaviour it implements — including the
  blank-line exception, which is the part a future reader would otherwise get wrong.
- `skills/pm-sync/SKILL.md:57-59` (Growth path) and `:75` correctly classify a legacy directory as
  "not damage", and the never-fabricate-a-Source rule survives into the migration path — the single
  place where inventing provenance would have been most tempting.
- The dogfooded `STATUS.md` labels its own PM-derived priorities as `unverified` and names
  `/ship:pm-sync` as the step that would settle them. The never-invent-status rule was applied to the
  first artifact written under it, which is the strongest available signal that it is operative.
- `agents/ship-pm.md` does not say which milestone a `check`-filed verification-debt item belongs to,
  and `ROADMAP.md` requires every item to sit under one. A future run has to improvise that
  placement. Cosmetic, worth a line if the verb is revised.
- `STATUS.md`'s repo-hygiene line ("ahead of `origin/main` by 10 unpushed commits") is already stale
  at 12. That is correct behaviour for a dated snapshot, not a defect — noted only so it is not read
  as drift later.

## Human Checks Required

- [ ] Open `.project-manager/dashboard.html` in a browser via `file://` and confirm it renders as
      intended. Zero network requests is proven statically (no external reference of any kind exists
      in the file), and structural tags are balanced, but visual rendering was not observed.
- [ ] Run `/ship:pm check <feature>` for real once this repo has its first archived feature, to
      exercise the debt-filing path end-to-end. The backlog already carries this as a P1 item.
- [ ] Run `/ship:pm-sync` interactively to confirm the PM-derived priorities and sizes in the
      bootstrapped `ROADMAP.md`, which STATUS.md currently flags as `unverified`.

## Gaps

- **`check <feature>` debt filing is contract-only, never executed.** The dry run produced a genuine,
  spot-check-verified 14-criterion report against a real archived feature, but filed none of its four
  UNPROVEN criteria as verification debt — deliberately, since the audited feature lives in another
  repo and `.planning/archive/` here is empty. The P0/P1 filing behaviour exists as prompt text in
  `agents/ship-pm.md:80` and `skills/pm/SKILL.md:32`, asserted by grep in `tests/pm-wiring.test.js`,
  and nowhere else. *Recommended:* accept as INCONCLUSIVE and close the already-filed P1 backlog item
  ("Re-run `check` against a ship-owned archived feature") when this repo archives its first feature —
  which will be this one.

## Recommendation

**Needs human review** — narrowly, and only for the one criterion above.

Seven criteria pass on executed evidence, the full suite is green at 215/215 including 23
verifier-authored adversarial tests, and no critical or high bugs exist. The single INCONCLUSIVE is a
known, self-documented limitation rather than a defect: the feature could not exercise its own
`check` verb end-to-end because the repo has no archived feature to audit yet, and it filed that gap
into its own backlog instead of papering over it. Clear with
`/ship:finish --accept-inconclusive "check debt-filing path awaits this repo's first archived feature; already tracked as M1/P1"`.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** yes
- **Reason:** check reporting half proven against a real archived feature with spot-checked evidence; debt-filing half is unexercisable until this repo archives its first feature, tracked as a P1 item in .project-manager/ROADMAP.md
- **Operator:** dilhanj@outlook.com
- **Timestamp:** 2026-08-11T03:38:30Z
