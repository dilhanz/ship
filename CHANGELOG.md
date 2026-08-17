# Changelog

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
