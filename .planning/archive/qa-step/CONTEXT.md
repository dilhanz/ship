---
feature: "qa-step"
status: built
created: "2026-04-09"
---

## Problem

Ship's verification step (the verifier) only checks whether acceptance criteria are met — it asks "did we build what was asked?" but never asks "will it break in production?" There is no adversarial testing step that probes edge cases, writes regression tests, hunts for bugs in error paths, or validates behavior under unexpected inputs. The gap means shipped features may pass spec compliance but harbor latent bugs that only surface in production.

## Solution

Add a standalone QA step between build and verify — a new `ship-qa` agent invoked by a `/ship:qa` skill. The QA agent acts as an adversarial tester: it auto-discovers the project's test framework, writes test files covering risk-based categories (happy path, boundary, negative, error handling, concurrency, security — selecting which matter for the feature), runs them, performs exploratory analysis, and produces a QA.md report with structured bug findings. Test files are auto-committed with `test(feature): ...` format. On critical/high-severity bugs, QA rolls back status and appends fix tasks to PLAN.md. QA findings feed into the verifier as a `## QA Findings` section (paralleling how `/review` findings work today), so the verifier's verdict accounts for QA results.

## Decisions

- **Standalone step, not embedded in verify:** QA needs its own turn budget (40 turns) and dedicated agent. Deep adversarial testing doesn't fit as a sub-step crammed into the verifier's 30-turn budget.
- **Both test writing AND reporting:** QA writes actual test files (committed automatically) AND produces a QA.md bug report. Not report-only.
- **Auto-commit test files:** QA commits tests with `test(feature-name): description` format, consistent with how the builder commits. QA.md lists all files written so the user can review.
- **Risk-based test categories:** QA assesses which of the 6 categories (happy path, boundary, negative, error handling, concurrency, security) are relevant to the feature and focuses there. No blanket coverage of irrelevant categories.
- **Roll back + fix tasks on failure:** Critical/high bugs reset status to `plan-verified` and append fix tasks to PLAN.md, same pattern as the verifier on FAIL/PARTIAL.
- **QA findings feed into verifier:** QA.md findings are passed to the verifier as a `## QA Findings` section in its prompt, paralleling `/review` findings. Verifier uses QA findings in its verdict.
- **Sonnet model:** Matches the verifier. Good balance of reasoning capability and speed.
- **Auto-discover test framework:** QA scans package.json, pyproject.toml, Cargo.toml, go.mod, etc. to find the project's test framework and conventions. No manual config needed.
- **Always runs in /ship:go:** The go workflow always executes QA after build. Status flow becomes: `built → qa-passed → done`.
- **40-turn budget:** Same as builder. Enough for substantial test writing, running, and exploratory analysis.
- **New status: `qa-passed`:** Inserted between `built` and `done` in the status state machine.

## Acceptance Criteria

- [ ] New `agents/ship-qa.md` agent file with proper frontmatter (name, model: sonnet, tools, maxTurns: 40, memory: project) and full adversarial QA instructions
- [ ] New `skills/qa/SKILL.md` skill file with proper frontmatter and orchestration logic (find feature, invoke QA agent, display results)
- [ ] New `ship/templates/QA.md` template for the QA report (test plan, test files written, bug findings table, verdict)
- [ ] QA agent auto-discovers project test framework by scanning config files (package.json, pyproject.toml, etc.)
- [ ] QA agent writes test files and auto-commits them with `test(feature-name): description` format
- [ ] QA agent performs risk-based test category selection (not blanket coverage)
- [ ] QA agent produces structured `qa_result` JSON output block (like `build_result` and `verify_result`)
- [ ] On critical/high bugs: QA sets status to `plan-verified` and appends fix tasks to PLAN.md
- [ ] On pass: QA sets status to `qa-passed`
- [ ] Verify skill updated to read QA.md and pass `## QA Findings` section to verifier agent
- [ ] Verifier agent updated to process QA findings in a new Stage (affecting verdict like /review findings do)
- [ ] Go workflow updated: status table maps `built → /ship:qa` and `qa-passed → /ship:verify`
- [ ] Status skill, resume skill, and help skill updated to include QA step
- [ ] `hooks/subagent-stop.cjs` updated to validate `ship-qa` agent output (extract `qa_result` block)
- [ ] New status `qa-passed` works with existing hook infrastructure (scan-features, post-compact, etc.)

## Scope

**In scope:**
- New QA agent, skill, and template
- Status flow changes (new `qa-passed` status)
- Go workflow integration (always runs QA)
- Verify skill + verifier agent updates to consume QA findings
- Hook updates for QA agent output validation
- Help/status/resume skill updates
- QA agent git-commits skill preloading for test commits

**Out of scope:**
- Performance/load testing (separate concern, not adversarial QA)
- Visual regression testing or screenshot comparison
- QA for the Ship framework itself (this feature is about QA for user projects)
- Custom QA configuration (e.g., user specifying which test categories to run)
- QA agent continuation/retry logic (like builder's auto-continue) — can add later if 40 turns proves insufficient

## Research Notes

No research needed. The QA agent pattern is well-understood and all integration points are internal to Ship's existing architecture.
