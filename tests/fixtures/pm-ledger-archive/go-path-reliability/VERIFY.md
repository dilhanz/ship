# Verification Report — go-path-reliability

**Feature:** go-path-reliability
**Verified:** 2026-08-22
**Head:** d4c36642dda8860861bfb45d2860d013b8ee00d4
**Overall Status:** PASS

## Stage 1 — Acceptance Criteria

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE, DEFERRED}. INCONCLUSIVE means no runnable verify command was available; grep-only file existence does not upgrade to PASS.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| 1. `agents/ship-verifier.md` declares `maxTurns: 60`, at parity with reviewer/builder/plan-reviewer, asserted by a test reading all four frontmatters | PASS | `grep -n "^maxTurns:"` across the four agents → all `60`. `node --test tests/go-path-reliability.test.js` → 17/17 pass, including `all four schema-driven agents carry the same maxTurns, and it is 60` (tests/go-path-reliability.test.js:38). |
| 2. `ship/verify-scratch.cjs` is module + CLI; against a real fixture repo accepts a valid record and rejects non-ancestor / foreign-commit / missing / malformed-unstamped | PASS | `node --test tests/verify-scratch.test.js` → 19/19 pass. Independently re-proved in `tests/go-path-reliability-adversarial.test.js` (11 fixture-repo cases: accepts base==HEAD, accepts own test commits, resolves short hashes; rejects foreign commit, non-ancestor, missing file, malformed JSON, no-stage, no-base_head, bad stage value, unresolvable commit, foreign-repo SHA). |
| 3. `ship/verify-scratch.cjs` exits 0 and returns a reject verdict — never throws, never exits non-zero — on garbage input, a non-git dir, or a nonexistent path | PASS | Adversarial CLI matrix (9 invocations incl. `[]`, `--cwd` with no value, `--cwd=/nonexistent`, `--nonsense`, `--help`, `-`) → every one `status === 0` with parseable `{valid:false, reason:string}`. Module API over 6 hostile arg shapes → `doesNotThrow`. Source confirms no `throw` and a deliberate no-`process.exit` (ship/verify-scratch.cjs:240). |
| 4. Stage 0 captures the base head before any verifier commit; salvage order is partial scratch → complete VERIFY.md → full re-verify; record is `.review-scratch/verify.json` with `base_head`, `stage`, criteria verdicts, carried-finding outcomes, `tests[]` | PASS | agents/ship-verifier.md:55–105 documents capture-before-commit with the self-invalidation rationale, the three-step order, and all six record keys. Dogfooded live this run: the record was created before the first commit, and `node ship/verify-scratch.cjs go-path-reliability` returned `valid:true, stage:"bughunt"` after three of my own test commits landed. |
| 5. A Stage 1 flush leaves VERIFY.md with the criteria table, `**Status:** IN PROGRESS — Stage 1 only`, and **no** `**Head:**` line; Stage 3 replaces both | PASS | Executed end-to-end this run: the Stage 1 flush was written and asserted programmatically — `marker present: true | Head line present: false`. This file is the Stage 3 replacement carrying `**Overall Status:** PASS` and a `**Head:**` stamp. Contract text at agents/ship-verifier.md:150–155 and ship/templates/VERIFY.md:8; `node --test tests/structured-output-salvage.test.js` → 40/40 pass. |
| 6. `salvageVerifyPrompt()` reads the scratch record before VERIFY.md and instructs the retry to adopt, resume, and not re-author committed test files | PASS | go.workflow.js:422–441: step 1 is the helper invocation, step 2 is VERIFY.md. Proved by execution, not reading — adversarial test loads the real workflow and asserts on the actual retry prompt: `indexOf('**1. The scratch record.**') < indexOf('**2. VERIFY.md.**')` and the literal `${CLAUDE_PLUGIN_ROOT}` survives prompt construction. |
| 7. `skills/verify/SKILL.md` deletes `.planning/features/{name}/.review-scratch/` after VERIFY.md is written | PASS | skills/verify/SKILL.md:40–46, "Clean Up the Scratch Record", including the preservation exception when the verifier returned no result. `tests/structured-output-salvage.test.js:212` asserts it. |
| 8. `agents/ship-pm.md`'s `check` verb distinguishes absent / IN PROGRESS / recorded VERIFY.md | PASS | agents/ship-pm.md:102–106 defines all three states with distinct reporting rules; the IN PROGRESS branch also names the salvageable `verify.json`. `tests/structured-output-salvage.test.js:225` asserts it. |
| 9. `safeAgent` classifies transport failures distinctly; such a death does not consume a `MAX_BUILD_ROUNDS` slot; `MAX_TRANSPORT_RETRIES` (3) bounds them; the terminal reason is derived, and the hardcoded "turn budget exhausted" string at the exhaustion exit is gone | PASS | Behavioral, via the real workflow loaded and run: a sustained builder outage stops after exactly **3** builder calls as `INFRASTRUCTURE` (not 5 / `EXHAUSTED`); two outages that recover cost the phase **0** rounds (`builderRounds === 1`); a plain agent failure still consumes its round (5 calls → `EXHAUSTED`, reason `turn budget exhausted`, recommendation `split its remaining tasks`); a run that exhausts rounds with a transport death last reports a transport-derived reason and the re-run recommendation. Source: go.workflow.js:225–290, :516, :563–575. |
| 10. A sustained outage returns terminal status `INFRASTRUCTURE`, and `skills/go/SKILL.md` §6.5 renders it explicitly — CONTEXT.md stays `building`, the report says the connection dropped, recommendation is to re-run `/ship:go` | PASS | go.workflow.js:505 (build path) and :755–767 (verify pseudo-phase). skills/go/SKILL.md:180 renders `INFRASTRUCTURE` in its own paragraph: leaves CONTEXT.md `building`, reports `stoppedAt.build.reason`, recommends `/ship:go {name}`, and explicitly forbids the split-tasks advice. Executed test: a transport-killed verifier yields `stoppedAt.phase.id === 'verify'` with status `INFRASTRUCTURE`, while a non-transport verifier death yields `stoppedAt === null` — the classification does not overreach. |
| 11. The builder refuses to mark a task `done` while any `depends` task is pending; `progressPrompt`/`PROGRESS_SCHEMA` report out-of-order done tasks | PASS | agents/ship-builder.md:38 (check before writing code), :45 (never mark done with a pending dependency), :48–53 (deviation, not a silent skip, with Rule 1 / CHECKPOINT routing). go.workflow.js:135 (`out_of_order` in PROGRESS_SCHEMA), :349 (progressPrompt bullet), :535–538 (raised as phase concerns). Executed test proves an `out_of_order` entry reaches the phase result as a concern exactly once, even though the builder that caused it is gone. |
| 12. Salvage events appear in the workflow result and the `GO COMPLETE` report, naming agent, record, and adopted/rejected | PASS | go.workflow.js:265–269 (`recordSalvage`), :771 (`return { …, salvageEvents }`); skills/go/SKILL.md `GO COMPLETE` template has `[If salvageEvents is non-empty:] Salvage events:`. Executed tests cover all three shapes: a salvaged verifier retry → `[{agent:'verify', record:'.review-scratch/verify.json', outcome:'adopted'}]`; a retry returning nothing → `outcome:'no-result'`; a clean run → `[]`. |
| 13. `node --test` passes across the whole suite, `tests/structured-output-salvage.test.js` carries the verifier partial-progress cases, and the three version files + CHANGELOG read 5.11.0 | PASS | Clean worktree at HEAD: `node --test tests/*.test.js` → **637 pass, 0 fail**. Local dogfood run: 654 tests, 653 pass, 1 fail — a **pre-existing** failure reproduced at pre-feature commit `e41371e~1` against the same state, in a file this feature never touches (`git log e41371e~1..485273b -- ship/pm-update.cjs tests/pm-state-conformance.test.js` is empty) and which CONTEXT.md declares out of scope. Verifier partial-progress cases at tests/structured-output-salvage.test.js:118–235. `ship/VERSION`, `package.json`, `.claude-plugin/plugin.json` all `5.11.0`; `CHANGELOG.md:3` is `## 5.11.0`. |

**Totals:** 13 PASS, 0 FAIL, 0 INCONCLUSIVE, 0 DEFERRED.

## PM Handoff

None — no criterion required shared PM state.

## Stage 2 — Bug Hunt & Quality

Full depth. The feature's own suite asserts the *source text* of `go.workflow.js`, which catches prose drift but cannot catch a logic error. The adversarial work here therefore **executes** the shipped code: `verify-scratch.cjs` against real fixture git repositories, and `go.workflow.js` loaded into an `AsyncFunction` with `args`/`agent`/`log`/`phase` injected, so classification, round accounting, the `INFRASTRUCTURE` exits and the salvage channel are observed as behavior.

### Carried Review Findings

REVIEW.md marks no finding `unresolved`; the prompt directed the recorded medium/high findings to be treated as Stage 2b targets anyway. Each got a command.

| Severity | Phase | File | Finding | Outcome | Evidence |
|----------|-------|------|---------|---------|----------|
| high | 3 | ship/workflows/go.workflow.js:745 | Verifier-outage `INFRASTRUCTURE` branch unreachable — the cap counts deaths per `safeAgent` *call*, so a single verifier outage leaves the counter at 1 | **not reproduced** | The fix round did land. Fix commit `1ad91a1` replaced the cap test with a classification test (`if (!verdict && lastFailure && lastFailure.transport)`, go.workflow.js:755). Executed test "a verifier lost to the connection surfaces as a verify pseudo-phase, not a null verdict" passes: `stoppedAt.phase.id === 'verify'`, status `INFRASTRUCTURE`. Companion test proves a non-transport verifier death still yields `stoppedAt === null`, so the fix did not overreach. |
| medium | 4 | tests/go-path-reliability.test.js:100-104 | Vacuous assertion: `branch.indexOf(A) < branch.indexOf(B)` passes when `A` is absent (`-1 < any index`) | **reproduced — now closed** | Clean brace-balanced mutant (`MAX_TRANSPORT_RETRIES` → `1e9`) in a throwaway worktree: `node --check` passes, and `tests/go-path-reliability.test.js` still reports **17/17 pass** while a real outage would decrement `round` forever. New `tests/go-path-reliability-carried.test.js` fails loudly on the identical mutant (2 fail from the committed tree) — its harness bounds agent calls so the infinite refund loop surfaces as an assertion rather than a hang. |
| medium | 1 | agents/ship-verifier.md:102 | The record rewrite does not carry the predecessor's `tests[]` forward, so the salvage chain breaks after a second consecutive death | **reproduced** | Fixture repo: run-1 record → `valid:true`; run-2 record listing only its own commit → `valid:false`, reason "commit … is not one of the record's own test commits"; the same record carrying run 1 forward → `valid:true`. Pinned in `tests/go-path-reliability-carried.test.js`, together with the mirror case (re-capturing `base_head` instead of adopting it silently excludes run 1's work). Fails closed. |
| medium | 3 | ship/workflows/go.workflow.js:241 | 5xx pattern `/(status\|error)[^0-9]{0,20}50\d/i` false-positives on non-transport agent errors | **reproduced** | `isTransportError` extracted from source and executed: `"Error: input length 5012 exceeds context"` → `true`; `"agent error after 502 turns"` → `true`; `"agent error: task 5031 not found"` → `true`. A genuine agent failure is refunded its build round, and three consecutive ones end the run as `INFRASTRUCTURE` with a misleading reason — the feature's own bug, inverted. |
| medium | 4 | CLAUDE.md:78,97 | Architecture doc still describes the pre-fix verifier | **reproduced** | `git log e41371e~1..485273b -- CLAUDE.md` is empty (untouched by the feature). Line 97 still reads "the verifier salvages its own VERIFY.md" and lists the verifier's fingerprint as "a `**Head:**` line in VERIFY.md itself" — both superseded by the base-head-stamped `.review-scratch/verify.json` that salvage now reads first. `grep -c "verify-scratch" CLAUDE.md` → **0**, so line 78's Supporting Files list omits the new helper. |
| medium | 3 | skills/go/SKILL.md:180 | A verify-phase `INFRASTRUCTURE` stop records CONTEXT.md as `building`, while item 7 records the same real situation as `built` | **reproduced (criterion still met)** | Read of items 5 and 7 plus the executed workflow: a transport-killed verifier yields `stoppedAt`/`INFRASTRUCTURE` → `building`; a non-transport verifier death yields `stoppedAt === null` → `built`. Same event, two recorded statuses, decided by the failure's classification. Acceptance criterion 10 explicitly specifies `building`, so the criterion passes; the inconsistency is a quality finding. |
| medium | 4 | tests/pm-state-conformance.test.js:199 | Full suite red locally | **reproduced, not caused by this feature** | Reproduced at pre-feature commit `e41371e~1` against the same local state (13 pass, 1 fail). Cause is `ship/pm-update.cjs` emitting literal backticks where the test expects `<code>`; neither that file nor the test is in the feature's 12 commits, and CONTEXT.md declares `pm-update.cjs` out of scope. Clean worktree at HEAD: 637 pass, 0 fail. Carried forward as the criterion-13 outcome. |
| low | 3 | skills/go/SKILL.md:212 | Unmarked conditional line inside the fenced `GO COMPLETE` template | **reproduced** | `sed -n '209,214p'`: every neighbouring conditional carries an `[If …]` marker; the `INFRASTRUCTURE` sentence is a bare indented continuation line. An agent rendering the template literally may emit the meta-instruction into the user-facing report. |

### Adversarial Tests

- **Categories tested:** error-handling, boundary, negative-input, security (argument injection / path handling), happy-path
- **Tests written:** 35  **Passed:** 35 / 35
- **Test files committed:**
  - `tests/go-path-reliability-adversarial.test.js` (23 tests) — `c560718`
  - `tests/go-path-reliability-carried.test.js` (5 tests) — `f8f91f6`
  - `tests/go-path-reliability-hostile.test.js` (7 tests) — `d4c3664`

Discretionary budget: 3 test files, capped as instructed. Mutation testing was used to confirm the tests actually bind — the `MAX_TRANSPORT_RETRIES` mutant is caught by the new files and missed by the existing one.

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | medium | error-handling | **The record self-invalidates between a verifier commit and the record rewrite that follows it.** Observed live on this verification: after committing `f8f91f6` the record still listed only `c560718`, and the helper rejected the verifier's own record. Broader than the phase-1 finding predicted — it needs no second death, only a verifier that commits more than once before rewriting. | agents/ship-verifier.md:91,102 | Open |
| 2 | medium | error-handling | A salvaged retry that reads `tests` as "every test file **you** have committed" rewrites the record with only its own commits while keeping the inherited `base_head`; the predecessor's commits then read as foreign and the record is rejected. Salvage chain breaks after a second consecutive death. | agents/ship-verifier.md:102 | Open |
| 3 | medium | negative-input | 5xx transport pattern misclassifies realistic non-transport agent errors as outages (`"input length 5012 exceeds context"`, `"agent error after 502 turns"`). Refunds a build round for a genuine failure; three consecutive ones end the run as `INFRASTRUCTURE` with a wrong reason and a wrong recommendation. | ship/workflows/go.workflow.js:241 | Open |
| 4 | medium | documentation | CLAUDE.md — the architecture doc governing every future agent in this repo — still describes the pre-fix verifier salvage design and never mentions `ship/verify-scratch.cjs`. | CLAUDE.md:78,97 | Open |
| 5 | medium | error-handling | The same verifier outage is recorded as CONTEXT.md `building` or `built` depending on whether the death was classified as transport. | skills/go/SKILL.md:180 vs item 7 | Open |
| 6 | medium | error-handling | Pre-existing and out of scope: `ship/pm-update.cjs` writes literal backticks into `dashboard.html` where `tests/pm-state-conformance.test.js:199` expects `<code>`, so the suite is red on any machine holding local `.project-manager/` state. | ship/pm-update.cjs | Open (pre-existing) |
| 7 | low | boundary | `verify-scratch.cjs` accepts a symbolic `base_head` (`HEAD`, `@`, `main`). Such a record re-resolves at validation time, making `base_head..HEAD` trivially empty and the record permanently valid — it can never go stale. Not reachable from the documented contract (Stage 0 captures `git rev-parse HEAD`, a SHA), so this is a defensive gap, not a live defect. | ship/verify-scratch.cjs | Open |
| 8 | low | documentation | The `GO COMPLETE` template's `INFRASTRUCTURE` line lacks the `[If …]` marker its neighbours all carry, risking a meta-instruction leaking into the user-facing report. | skills/go/SKILL.md:212 | Open |

No critical or high bugs. Findings 1 and 2 are two faces of one contract-wording defect and should be fixed together.

### Anti-Pattern Scan

- TODO/FIXME/placeholder/stub markers: **None.** Every hit across the changed files is prose *about* markers (agents/ship-verifier.md:193, ship/templates/VERIFY.md:58) or about template placeholders, not a marker left in shipped logic.
- Empty function bodies / hardcoded values: **None.** `MAX_TRANSPORT_RETRIES` and `MAX_BUILD_ROUNDS` are named constants; the profile knobs arrive as `args`.
- Broken imports / convention violations: **None.** `ship/verify-scratch.cjs` uses only `fs`/`path`/`child_process` (zero-dependency rule holds), spawns `git` **without** `shell: true`, contains no `throw`, and deliberately omits `process.exit` (documented at :240 — an explicit exit can truncate a pending async stdout write). Verified behaviorally: no option-shaped `base_head` payload executed.

### Quality Notes

- The helper's degrade-to-reject discipline is genuinely thorough. Every hostile shape I could construct — truncated JSON at four cut points, non-object envelopes, `tests` entries that are `null`/strings/objects-without-commit, 300-character slugs, empty slugs, repos with no commits — returned `{valid:false, reason:<string>}` without throwing.
- The `lastFailure` script-level channel is the right answer to the constraint CONTEXT.md flagged (`safeAgent` cannot signal a cause by return value because every call site tests `if (result)`), and the comments explain *why* rather than *what*.
- Pre-existing, outside this diff: CLAUDE.md:97 contains a duplicated phrase — "Deleting `.review-scratch/` deleting `.review-scratch/`".
- The feature is a strict improvement on the status quo it replaces: before it, the verifier had no durable record at all and every turn-capped death cost a full re-verification. The open findings all fail in the safe direction the CONTEXT.md NFR specifies — a rejected record costs a re-verification; none of them can report a verification that did not happen.

## Human Checks Required

None — all criteria verified programmatically.

## Gaps

None blocking. The medium findings above are recorded as recommendations, not gaps in the evidence.

## Recommendation

**Done** — all 13 acceptance criteria pass against executed code, and no critical or high bug was found; the one carried high finding does not reproduce because its fix round landed.

Ship it, then fix the contract wording in a follow-up. Findings 1 and 2 deserve priority: the record's durability is this feature's headline guarantee and it lapsed on its very first real run (mine), which is exactly the class of evidence the field report was built from. The fix is small and lives in prose — `agents/ship-verifier.md` should define `tests[]` as *every test commit in `base_head..HEAD`, including any inherited from a predecessor*, and should state that the record must be rewritten in the same turn as the commit that changes it. I judged this medium rather than high because it fails closed (the cost is a re-verification, never a false report of verification) and because blocking the release would leave in place a status quo with no durable record at all. An operator who weighs the headline guarantee more heavily than I did would be reasonable to send it back for that one-file fix.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** no
- **Reason:** N/A
- **Operator:** N/A
- **Timestamp:** N/A
