# Verification Report — dashboard-code-spans

**Feature:** dashboard-code-spans
**Verified:** 2026-08-23
**Head:** 1d14a7f3d6c2034fe33c062d669eb5dc68176845
**Overall Status:** PASS

Salvage check: `.planning/features/dashboard-code-spans/VERIFY.md` did not exist at the start of this
run, so nothing was salvaged and every criterion below was verified from scratch. (Two commits from a
previous, lost verification round — `00196fc` and `bad99b7` — were already on `main`; their artefacts
were treated as ordinary code under test, not as evidence.)

## Stage 1 — Acceptance Criteria

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE, DEFERRED}. INCONCLUSIVE means no runnable verify command was available; grep-only file existence does not upgrade to PASS. DEFERRED means the criterion targets shared `.project-manager/` state, which only the PM layer may write.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| 1. Code spans render — a backlog cell authored as ``Re-run `check` …`` produces `<code>check</code>` in the generated dashboard | PASS | `node --test --test-reporter=tap "tests/pm-state-conformance.test.js"` → `# pass 15 # fail 0 # skipped 0`. Direct probe: fixture copied to a temp `.project-manager`, `generateDashboard()` → `has <code>check</code>: true`, spans `["<code>check</code>","<code>tests/fixtures/pm-state/</code>","<code>inline()</code>"]`, `stray backticks in output: 0`. Tripwire row present at `tests/fixtures/pm-state/ROADMAP.md:15`. |
| 2. Escaping survives the conversion — `<`, `&`, `"` inside and outside a span are escaped; no raw `<` from state reaches the dashboard | PASS | `tests/dashboard-code-spans.test.js` "escapes first and converts second, inside and outside a span" passes (asserts `<code>&lt;b&gt; &amp; &quot;x&quot;</code>`, `doesNotMatch /&lt;code&gt;/`, and that every `<` in the document opens a tag). Independently pinned by my `tests/dashboard-inline-fidelity.test.js` round-trip + pre-escaped-entity tests. Mutation M8 (convert-then-escape) is killed: `# pass 2 # fail 2` on the fidelity file, `# fail 1` on the shipped file. |
| 3. Attributes are untouched — a backtick in a `Status` cell emits no `<code>` inside `class="…"`, structural tags stay balanced | PASS | `tests/dashboard-code-spans.test.js` "a backtick in a Status cell or a milestone badge emits no tag inside an attribute" passes; `tests/dashboard-inline-adversarial.test.js` asserts the same over 27 hostile payloads. `'code'` is in the balanced-tag list at `tests/pm-state-conformance.test.js:269`. Mutation M4 (`inline()` applied to the Status attribute cell) is killed: `# fail 1`. |
| 4. Only code spans convert — `**bold**`, `_em_`, `[t](u)` stay literal | PASS | `tests/dashboard-code-spans.test.js` "bold, emphasis, and links survive as literal text" passes: `doesNotMatch /<strong[\s>]/`, `/<em[\s>]/`, `/<a[\s>]/`, and literal `**bold**`, `_em_`, `[text](docs/x.md)` present alongside `<code>real</code>`. |
| 5. The dogfood blocks run everywhere — clean checkout reports 0 skipped, 0 failures | PASS | `git archive HEAD` into a temp tree (`neither present` for `.planning`/`.project-manager`) then `node --test --test-reporter=tap "tests/*.test.js"` → `# tests 840 # pass 840 # fail 0 # skipped 0`. The three formerly gated blocks are named in the clean run: `ok - pm-sync-nudge — against the committed fixture ROADMAP.md`, `ok - pm-state format — the committed fixture conforms`, `ok - dashboard.html — offline and derived from state`. No `dogfood` gate remains (`grep -rn 'dogfood' tests/pm-state-conformance.test.js tests/pm-nudge-verify.test.js` → only a prose comment). |
| 6. The two workflows agree — `test.yml` exists, triggers on push + pull_request, pins Node 22, same command string as `release.yml` | PASS | `cat .github/workflows/test.yml` → `on: push / pull_request`, `node-version: '22'`, `run: node --test "tests/*.test.js"`; `release.yml:82` is byte-identical and pins `node-version: '22'` at line 50. `node --test "tests/ci-workflow-parity.test.js"` → `# pass 4 # fail 0`. Mutation M3 (drift the `test.yml` command to `node --test tests/`) is killed: `# fail 1`. |
| 7. `<code>` is styled with a local font stack and the dashboard stays offline | PASS | `ship/templates/dashboard.html:112-117` — `code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; … }`. `grep -nE 'url\(\|@import\|https?://\|<link\|<script\|srcset' ship/templates/dashboard.html` → no matches. `ok - dashboard.html — offline and derived from state` passes. Mutation M6 (delete the `code` rule) is killed: `# fail 1`. |
| 8. Real state is green on this machine | PASS | `node ship/pm-update.cjs` → exit 0; `grep -c '<code>' .project-manager/dashboard.html` → `5`, including `<code>check</code>`; `node --test --test-reporter=tap "tests/pm-state-conformance.test.js"` → `# pass 15 # fail 0 # skipped 0`. The assertion reproduced as failing in CONTEXT.md no longer fails. Full repo suite (real state present): `# tests 840 # pass 840 # fail 0 # skipped 0`. |
| 9. The stale memory no longer suppresses | PASS | `.claude/agent-memory/ship-ship-verifier/dogfood-suite-failure.md` frontmatter reads `RESOLVED 2026-08-23 … a future failure is a real regression, record it as a FAIL`; body line 18 reads `it is a **real regression — record it as a FAIL** … Do not classify it as pre-existing and do not skip it`. `MEMORY.md` pointer updated to match, and `git ls-files .claude/agent-memory/ship-ship-verifier/` shows all three files tracked (index, note, and the `[[test-runner-environment]]` target it links to). |

## PM Handoff

None — no criterion required shared PM state. (Criterion 8 rests on running `ship/pm-update.cjs`, which
CLAUDE.md explicitly exempts from the handoff rule: mechanical dashboard reconciliation runs from any
lane through Node, so it verifies normally.)

## Stage 2 — Bug Hunt & Quality

Full depth — no profile narrowing was instructed (`profile: standard`).

### Carried Review Findings

No REVIEW.md existed at verification time and the prompt carried no Unresolved Review Findings block.
The three phase scratch records under `.review-scratch/` were read: **all three phases returned
`APPROVED` with zero critical/high findings**, so nothing was carried as a mandatory Stage 2b target.
The four `low` advisory findings they raised were nonetheless re-checked with commands and appear under
Bug Findings / Quality Notes below.

| Severity | Phase | File | Finding | Outcome | Evidence |
|----------|-------|------|---------|---------|----------|
| — | — | — | None carried (no critical/high unresolved findings; phases 1–3 all APPROVED) | n/a | `.review-scratch/phase-{1,2,3}.json` → `"status": "APPROVED"`, findings all `"severity": "low"` |

### Adversarial Tests

- **Categories tested:** security (escaping/injection order), boundary (degenerate backtick runs, multi-line values), negative-input (hostile state values), error-handling (absent/empty state files), regression-resistance (mutation testing)
- **Tests written:** 4 (in one new file); **Passed:** 4 / 4. Full suite after the addition: 840 passed, 0 failed, 0 skipped, both in the repo and in a clean `git archive` tree.
- **Test files committed:** `tests/dashboard-inline-fidelity.test.js` (`190f695`) — losslessness round trip, pre-escaped-entity exactness, blocker-index keying on raw text, and the `pm-update --next` CLI contract.
- **Mutation testing (9 mutants, run against a clean `git archive` copy so the working tree was never dirtied):**

| # | Mutant | Result |
|---|--------|--------|
| M1 | `inline()` → `esc()` (revert the feature) | **killed** — 8 failures across the suite |
| M2 | strip the backticks from the fixture tripwire row | **killed** — 2 failures (`dashboard-inline-adversarial` arms this directly) |
| M3 | drift `test.yml`'s command string | **killed** — 1 failure |
| M4 | apply `inline()` to the `Status` attribute cell | **killed** — 1 failure |
| M5 | widen the regex to `` `[\s\S]+` `` (span may cross a newline) | **survived** — see Quality Notes; not a reachable defect |
| M6 | delete the `code` style rule from the template | **killed** — 1 failure |
| M7 | key `blockedReasons.get()` on rendered text | **killed** by the new fidelity test |
| M8 | convert first, escape second | **killed** by the new fidelity test *and* the shipped `dashboard-code-spans` test |
| M9 | render `--next` CLI output through `inline()` | **killed** by the new fidelity test |

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | low | rendering fidelity | A markdown double-backtick span (` ``x`` `) leaves stray literal backticks: the regex needs 1+ chars between delimiters, so the outer pair does not match and the inner pair converts, producing `` `<code>x</code>` ``. Reproduced: cell `use ``x`` here` renders as `<td>use `<code>x</code>` here</td>`, tags balanced (2 open / 2 close), nothing injectable. The pm-state format only authors single-backtick spans. | ship/pm-update.cjs:318 | Open (cosmetic; matches phase-1's advisory finding) |
| 2 | low | CI hygiene | `.github/workflows/test.yml` declares no `permissions:` block, so the job inherits the repository default `GITHUB_TOKEN` scope, while `release.yml:25` pins its scope deliberately. The job only checks out and runs `node --test`; `contents: read` would suffice. Adding it does not touch the `Run tests` step string, so the parity test stays green. | .github/workflows/test.yml:11 | Open |

No critical, high, or medium bugs found. Nine mutants were used to confirm the tests are non-vacuous;
eight were killed and the survivor is unreachable through the module's public surface (below).

### Anti-Pattern Scan

- TODO/FIXME/HACK/XXX/placeholder/stub markers: **None** in the feature's changed files (the single `placeholder` hit is a test *name* in `tests/dashboard-inline-adversarial.test.js:197` describing the template's `<!-- PM:… -->` substitution).
- Empty function bodies / hardcoded values: **None**. The monospace stack in the new `code` rule is the same class of literal as the template's existing `system-ui` stack; the fixture's contents are test data by design.
- Broken imports / convention violations: **None**. The fixture uses `tests/fixtures/pm-state/planning/` (no leading dot) so it is not swallowed by `.gitignore`'s `.planning/` rule — confirmed with `git check-ignore` (exit 1, not ignored) — and the CI glob `tests/*.test.js` does not recurse into `tests/fixtures/`.

### Quality Notes

- **M5 survivor is not a test gap worth closing.** Widening `inline()`'s regex to `` `[\s\S]+` `` passes all 840 tests, but no authored value with a real newline can reach `inline()`: `bulletEntries` and `parseDecisions` join continuation lines with a space, and the frontmatter/table/goal parsers are single-line by construction. The `\n` exclusion is defence in depth. A consequence: `tests/dashboard-inline-adversarial.test.js:234` "a newline cannot be spanned" asserts balance only, and its scenario cannot deliver the newline its name implies — the name overpromises. `inline()` is not exported, so a direct unit test would mean widening the module's public surface. Recorded in verifier memory (`1d14a7f`) so it is not re-chased.
- **Leftover "real state" naming** in `tests/pm-nudge-verify.test.js:204,240,258` after the retarget (`ship-nudge-real-` temp prefix, a local named `real`). Behaviour is correct; the names now describe the thing that was replaced. Cosmetic — rename next time the file is touched.
- **`<strong>` absence assertion is scenario-bound.** `tests/dashboard-code-spans.test.js:130` asserts no `<strong>` originates from state; the dashboard emits a real `<strong>` for blocked rows (`ship/pm-update.cjs:518`), so that assertion depends on its fixture having no blocked row. Correct today, brittle if the fixture grows one.
- The `inline()` doc comment states the escape-then-convert rationale and the text-node-only restriction at the point of definition — the call-site split (`inline()` for prose, `esc()` for attributes and machine-derived values) matches CONTEXT.md decision 3 exactly, verified by reading all 20 call sites.
- The build's phase status attributes in PLAN.md still read `status="pending"` for all three phases while every task inside reads `status="done"` with a commit SHA. Bookkeeping only — it does not affect any criterion.

## Human Checks Required

- [ ] Open `.project-manager/dashboard.html` in a browser and confirm the `<code>` styling (background chip, monospace, 0.9em) is legible at a glance on the intended wall display. Rendering correctness is machine-verified; visual legibility at distance is a judgement call.

## Gaps

None. Every acceptance criterion was proved by a command that ran during this verification.

## Recommendation

**Done**

All nine acceptance criteria pass against running code, the suite is green with zero skips both in this
repo and in a clean checkout (840/840), and eight of nine mutants were killed — the survivor is
unreachable through the module's public API. The two open findings are low-severity and cosmetic (a
double-backtick edge case the pm-state format never authors, and a missing `permissions:` block in the
new workflow); neither blocks the feature.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** no
- **Reason:** N/A
- **Operator:** N/A
- **Timestamp:** N/A
