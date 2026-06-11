# Verification Report — build-quality

**Feature:** build-quality
**Verified:** 2026-06-11
**Overall Status:** PASS

## Stage 1 — Spec Compliance

Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}. INCONCLUSIVE means no runnable verify command was available.

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| After a builder phase returns COMPLETE or COMPLETE_WITH_CONCERNS, the build skill invokes `ship-reviewer` on that phase's diff before marking the phase done | PASS | `grep -q "Review Gate" skills/build/SKILL.md && grep -q "ship-reviewer" skills/build/SKILL.md` — both present. Sections 3.1 and 3.2 exist in SKILL.md; COMPLETE and COMPLETE_WITH_CONCERNS branches both route through gates before marking phase done (lines 128-131 of SKILL.md). |
| Critical/high review findings are sent to the same builder via SendMessage for exactly one fix round; fixes are re-reviewed; unresolved findings surface as phase concerns | PASS | Section 3.2 step 5 in SKILL.md specifies exactly one fix round via SendMessage to the builder, re-review via SendMessage to the reviewer, and "One round only" cap with unresolved findings added to phase concerns. `grep -q "One round only" skills/build/SKILL.md` confirms. |
| All review findings (fixed and unresolved) are appended per-phase to `.planning/features/{name}/REVIEW.md` | PASS | Section 3.2 steps 4, 5c, and 6 in SKILL.md describe appending to REVIEW.md with outcome markers (`fixed in {commit-hash}`, `unresolved`, `recorded`). REVIEW.md format block present. `grep -q "REVIEW.md" skills/build/SKILL.md` confirms. |
| A reviewer failure (error, turn exhaustion, unparseable output) results in the phase proceeding with a "review skipped" concern — the build is never blocked by the reviewer | PASS | Section 3.2 step 3: "If the Agent call errors, or no valid review_result block is found: do NOT retry. Append … a 'Review skipped' line … add 'review skipped for phase {id}' to the phase's concerns, and proceed to mark the phase done." `grep -q "A broken reviewer must never block a working build" skills/build/SKILL.md` confirms. Recovery message in subagent-stop.cjs lines 168-174 mirrors this. |
| Before marking a phase done, the orchestrator re-runs every task's `<verify>` command; a failure is sent to the builder with the command output; a repeat failure after the fix round stops the build with CHECKPOINT | PASS | Section 3.1 Trust-But-Verify fully implemented in SKILL.md. Steps 1-6 cover re-run, fail→SendMessage, re-run again, still-failing→CHECKPOINT. `grep -q "Trust-But-Verify" skills/build/SKILL.md` and `grep -qi "re-ran this phase.s verify commands" skills/build/SKILL.md` both confirmed. |
| A NEEDS_CONTEXT result triggers AskUserQuestion in the orchestrator and the answer is SendMessaged to the same builder agent, in both `/ship:build` and `/ship:go` | PASS | Build SKILL.md: `AskUserQuestion` present in frontmatter allowed-tools and in NEEDS_CONTEXT branch (line 258). Go workflow: NEEDS_CONTEXT entry updated to "The build skill collects the missing information from the user via AskUserQuestion and sends the answer to the still-alive builder via SendMessage". Negative check `node -e "if(t.includes('user must provide it')) process.exit(1)"` passed — stale text removed from go.md. |
| `agents/ship-builder.md` has no pinned `model` (inherits the session model) | PASS | `node -e "if(/^model:/m.test(t)) process.exit(1)"` exit code 0 — no `model:` line in frontmatter. `name: ship-builder` present. |
| `hooks/subagent-stop.cjs` validates the `ship-reviewer` agent's `review_result` block, with tests passing under `node --test` | PASS | `REVIEW_VALID_STATUSES`, `extractReviewResult`, `ship-reviewer` branch all present in subagent-stop.cjs. `node --test tests/subagent-stop.test.js` → 21 tests, 0 failures. 8 reviewer-specific tests in the `review_result` describe block all pass. |
| CLAUDE.md and README reflect the new build flow (reviewer agent, REVIEW.md artifact, updated agent count) | PASS | CLAUDE.md: `ship-reviewer` found on lines 26 and 85; `REVIEW.md` found on lines 52 and 85. README.md: `ship-reviewer` found (grep confirmed). `node --test tests/build-quality-adversarial.test.js` → 37 tests, 0 failures. |

## Stage 2 — Code Quality

### Anti-Pattern Scan

- TODO/FIXME/placeholder strings found: None — grep across all 6 changed files returned no matches
- Stub implementations: None — all functions have real bodies; extractReviewResult is a full implementation mirroring extractQaResult
- Hardcoded values that should be config: None — REVIEW_VALID_STATUSES constant correctly encapsulates the valid status set; recovery message text is intentional prose

### Quality Notes

- `extractReviewResult` in subagent-stop.cjs mirrors the `extractQaResult` shape exactly as the plan required — consistent with existing project conventions
- The 2-round NEEDS_CONTEXT cap is implemented consistently in both build SKILL.md and go.md
- Error handling follows the project's "never throw, exit(0) silently" hook convention; all three extractors fall through to null on parse failure
- The edge rule in Trust-But-Verify (environment errors are not builder failures) is a sound defensive design matching project risk notes
- SKILL.md ordering (Trust-But-Verify before Review Gate) aligns with the plan's rationale: verify commands are cheap and mechanical; no point reviewing a non-passing diff

No quality issues found.

## Stage 3 — PR Review (powered by /review)

Source: branch diff `93ceb95..HEAD` (11 commits, 11 files, +1438/−19). Reviewed files: agents/ship-reviewer.md, hooks/subagent-stop.cjs, tests/subagent-stop.test.js, tests/build-quality-adversarial.test.js, agents/ship-builder.md, skills/build/SKILL.md, ship/workflows/go.md, CLAUDE.md, README.md.

### Findings

| # | Severity | File | Line(s) | Finding |
|---|----------|------|---------|---------|
| 1 | SUGGESTION | hooks/subagent-stop.cjs | 117-135 | `extractReviewResult`'s raw-JSON fallback accepts reviewer statuses regardless of the surrounding fence tag and lacks the `parsed.feature` guard that `extractBuildResult` has at line 44. Deliberately mirrors `extractQaResult` per plan instruction ("mirror extractQaResult exactly"), so it is consistent with existing conventions, but tightening all three fallbacks with a feature-field guard would reduce false-positive acceptance. Practical impact low: APPROVED/NEEDS_FIXES don't appear in normal builder/QA output. |
| 2 | SUGGESTION | agents/ship-reviewer.md | output schema | `review_result` output schema documents `scope` as `"phase:{id}"` only, while PLAN.md's contract allowed `"phase:{id}" \| "all"` for flat plans. The hook doesn't validate scope so this is harmless; worth aligning the agent doc in a future pass. |
| 3 | SUGGESTION | skills/build/SKILL.md | 176 | Review Gate step 1 skips review when `result.commits` is empty, evaluated before considering fix-round commits from 3.1; an edge case where 3.1 made fix commits but the builder reported no commits would skip review. Low priority. |

### PR Review Summary

- **Source:** Claude Code `/review` skill with Ship context
- **Critical:** 0 (no blocker)
- **Warnings:** 0 (no blocker)
- **Suggestions:** 3 (noted, non-blocking)

## Stage 4 — QA Findings (from /ship:qa)

### Test Coverage

- **Tests written:** 37
- **Tests passed:** 37 / 37
- **Categories tested:** boundary, negative, security, skill content validation, adversarial hook input, agent file structure

Full suite: 138 tests / 0 failures (`node --test tests/*.test.js`).

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | medium | boundary | `extractReviewResult` raw-JSON fallback accepts any JSON with status APPROVED/NEEDS_FIXES regardless of surrounding fence tag — a `build_result`-tagged block containing reviewer-status JSON passes silently instead of triggering recovery | hooks/subagent-stop.cjs:117-135 | Open (non-blocking) |
| 2 | low | negative | `extractReviewResult` fallback (line 130) lacks the `feature`-field guard that the builder fallback has at line 44 — a bare `{"status":"APPROVED"}` anywhere in output passes | hooks/subagent-stop.cjs:130 | Open (non-blocking) |

### QA Summary

- **Critical bugs:** 0
- **High bugs:** 0
- **Medium bugs:** 1 (noted, non-blocking)
- **Low bugs:** 1 (noted, non-blocking)
- **Verdict:** QA PASS

## Human Checks Required

None — all criteria verified programmatically.

## Recommendation

**Done**

All 9 acceptance criteria pass with direct tool-output evidence. No critical or high bugs were found in QA, and no critical or warning findings were raised in the PR review. The two open bugs (medium boundary and low negative) are intentional design choices that mirror the existing `extractQaResult` shape per the plan's explicit instruction; they are documented as suggestions for a future hardening pass.

## Inconclusive Override

<!-- This section is populated by /ship:finish --accept-inconclusive "reason".
     It is empty if no override was applied. -->

- **Override applied:** no
- **Reason:** N/A
- **Operator:** N/A
- **Timestamp:** N/A
