---
feature: "pipeline-rigor"
status: done
created: "2026-05-25"
---

## Problem

Ship's brainstorm → plan → build → QA → verify pipeline has five concrete rigor gaps surfaced by a deep internal audit: (1) the brainstormer never probes non-functional requirements (perf, observability, rollout, migration, flags, security), so production-shaped features ship with critical blind spots; (2) the QA agent reviews `PLAN.md`'s `<files>` list rather than the actual git diff, so any builder deviation (Rule 1) escapes scrutiny; (3) the verifier treats grep-finding an import as proof of wiring, rubber-stamping features that compile but don't work; (4) when QA fails, status rolls back to `plan-verified` while original tasks stay marked done — the `plan-verified` contract is silently violated; (5) QA and verifier both grep for TODO/FIXME/hardcoded values with no contract between them, burning tokens and risking contradictory verdicts.

## Solution

Tighten the pipeline with five interlocking changes, shipped as one feature: the brainstormer gains an **adaptive NFR probe** that reads project signals (package.json, infra files, prior CONTEXTs) and asks only the NFR questions that apply; the QA agent reads `git diff $(git merge-base HEAD main)..HEAD` as the source of truth and stops trusting `PLAN.md` for what changed; the verifier introduces an **INCONCLUSIVE** verdict for criteria with no runnable `<verify>` command, refusing to PASS on grep alone; a new **`qa-failed`** status replaces the broken plan-verified rollback path; the anti-pattern scan moves entirely into QA and the verifier reads `QA.md` instead of re-scanning. The verifier's INCONCLUSIVE blocks `/ship:finish` by default, with an explicit `--accept-inconclusive` override that's recorded in VERIFY.md. Backward compatibility is intentional: in-flight features (`qa-step`, `plugin-distribution`) finish under the old semantics.

## Decisions

- **Single bundled feature, not split.** The five fixes are thematically linked (rigor of the pipeline) and touch mostly markdown agent/skill files. Atomic-commits-per-task keep the diff reviewable without forcing artificial PR boundaries.
- **Adaptive NFR probe, not universal gate.** The brainstormer reads project signals and probes only relevant NFRs (skips rollout questions for a CLI tool; probes them for a service). Higher quality than a fixed checklist; avoids "N/A spam" that universal probing produces.
- **Git diff vs `merge-base HEAD main` is the QA source of truth.** Matches how human reviewers see a PR. Catches builder deviations (Rule 1) that PLAN.md's `<files>` list misses. Resolves the "QA reads stale plan" gap directly.
- **Verifier emits INCONCLUSIVE when no runnable `<verify>` exists.** Honest about what was actually checked. Forces the plan author to specify verifiable acceptance criteria when they want a PASS verdict. Grep-only evidence cannot upgrade to PASS.
- **INCONCLUSIVE blocks `/ship:finish` by default; explicit `--accept-inconclusive` override is recorded.** Override is a deliberate user act, not a default-on convenience. VERIFY.md captures the override reason so the audit trail is intact.
- **New `qa-failed` status.** Distinct from `plan-verified`; signals "plan was valid, implementation was buggy, fix tasks appended." `/ship:resume` from `qa-failed` runs `/ship:build` then `/ship:qa`, skipping plan-verify. Original tasks remain marked done; new fix tasks are appended.
- **QA owns the anti-pattern scan; verifier reads QA.md.** Single source of truth. Verifier only re-scans if QA was skipped (e.g., `/ship:verify` invoked directly without QA). Eliminates the duplicated TODO/FIXME grep.
- **In-flight features keep old semantics; no auto-migration.** `qa-step` and `plugin-distribution` finish under the rules they started with. New rules apply only to features started after pipeline-rigor merges.
- **Dogfood acceptance via a synthetic test feature.** Acceptance requires creating `.planning/features/test-rigor/` (e.g., a contrived `/ship:doctor` feature) and exercising the upgraded pipeline end-to-end. Empirical, reproducible, throwaway.

## Acceptance Criteria

- [ ] Brainstormer, when run on a project with infrastructure signals (e.g., `package.json`, `Dockerfile`, `.github/workflows/`), asks at least 2 NFR questions covering at least 2 of: perf/scale, observability, rollout/flag/migration, security/data, error handling.
- [ ] Brainstormer, when run on a project without infra signals (pure library/CLI), does NOT ask irrelevant NFR questions (no rollout questions for a CLI tool).
- [ ] QA agent's QA.md cites files from `git diff $(git merge-base HEAD main)..HEAD` output, not from PLAN.md's `<files>` block. Verifiable by grepping QA.md for `diff` evidence or via an explicit "Reviewed files (from git diff)" section.
- [ ] Verifier emits `INCONCLUSIVE` for any acceptance criterion that has no runnable `<verify>` command AND would otherwise have been judged via grep-only evidence. VERIFY.md schema lists per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}.
- [ ] When VERIFY.md contains any INCONCLUSIVE verdict, `/ship:finish` refuses to proceed unless `--accept-inconclusive` is passed; the override and reason are written into VERIFY.md.
- [ ] When QA verdict is FAIL (critical or high bugs), feature status transitions to `qa-failed` (not `plan-verified`). PLAN.md gains an appended `## Fix Tasks (from QA)` section; original task completion marks are preserved.
- [ ] `/ship:resume` recognises `qa-failed` and routes the user to `/ship:build` (then `/ship:qa`), skipping plan-verify.
- [ ] `/ship:status` displays `qa-failed` as a first-class status (no fallthrough to "unknown").
- [ ] Verifier no longer greps for TODO/FIXME/HACK/XXX/placeholder/stub/not-implemented when a recent QA.md exists for the feature. Instead, verifier reads QA.md's findings and incorporates them. Behaviour verifiable by inspecting verifier prompt + a transcript of a verify run with QA.md present.
- [ ] In-flight features (`qa-step`, `plugin-distribution`) continue to work under their original semantics — no skill or agent breaks when reading their existing CONTEXT.md/PLAN.md.
- [ ] A synthetic dogfood feature `.planning/features/test-rigor/` is created and walked through the upgraded pipeline end-to-end, demonstrating each behaviour above. The dogfood run is preserved in the repo (not deleted) as a reference exemplar.
- [ ] Documentation: CLAUDE.md status-flow section updated to include `qa-failed`; `/ship:help` mentions the INCONCLUSIVE concept and override flag.

## Scope

**In scope:**
- Brainstormer agent: adaptive NFR probe based on project-signal detection.
- QA agent: read git diff as source of truth; own the anti-pattern scan.
- Verifier agent: emit per-criterion verdicts (PASS/FAIL/INCONCLUSIVE); read QA.md instead of re-scanning; produce a structured verdict block.
- New `qa-failed` status in CONTEXT.md frontmatter, with resume/status/finish skills updated to recognise it.
- `/ship:finish` gains `--accept-inconclusive` override.
- VERIFY.md template updated for per-criterion verdicts and override recording.
- Synthetic dogfood feature created and walked through the pipeline.
- Documentation (CLAUDE.md, /ship:help) updated.

**Out of scope:**
- Auto-migration of in-flight features.
- Structured-JSON-schema output mode for VERIFY.md (deferred; today's structured-via-markdown is enough).
- Multi-agent adversarial review panel (Superpowers-style cohort) — separate future feature.
- Model assignment per agent (Opus/Sonnet/Haiku) — separate future feature.
- PreCompact hook, new hook events — separate future feature.
- QA / verifier turn-budget auto-continuation — known gap, separate feature.
- Memory wiring (`memory: project` declared but unused in agent bodies) — separate feature.
- Status semantics for build failures mid-flight (the `status: plan-verified` lingering after task 1 fails) — separate feature.

## Research Notes

- Internal audit (this conversation) identified 15 weaknesses across Ship; pipeline-rigor addresses the top 5 by severity.
- External trends survey confirmed:
  - GitHub anthropics/claude-code issue #29849 (confirmation bias in iterative adversarial QC loops) — verified real. Informs the QA/verifier separation and the INCONCLUSIVE concept.
  - `wan-huiyan/agent-review-panel` (multi-agent adversarial review with judge) — verified real; informs a future feature, out of scope here.
  - Official Claude Code hooks doc lists 28 events including `PreCompact`, `FileChanged`, `PostToolBatch`, `UserPromptSubmit` — informs future hook work, out of scope here.
- No research needed on Ship internals; audit produced sufficient citation-quality findings (agents/ship-{brainstormer,builder,qa,verifier}.md, skills/{plan,plan-verify,build,qa,verify}/SKILL.md, hooks/*.cjs).
