---
feature: "build-quality"
status: plan-verified
created: "2026-06-11"
---

## Problem

`/ship:build` defers all quality checking to post-build steps (`/ship:qa`, `/ship:verify`), so bugs introduced in phase 1 aren't caught until the whole build is committed — the main source of `qa-failed` → rebuild churn. The builder self-reports COMPLETE with no independent check that verify commands actually passed, NEEDS_CONTEXT dead-stops the loop and discards the builder's warm context, and the builder is pinned to `model: sonnet`, silently downgrading users running Opus or Fable sessions.

## Solution

Four orchestrator-level improvements to the build skill, keeping the current Agent tool + fenced-JSON + subagent-stop architecture (no Workflow migration). (1) A per-phase review gate: a new `ship-reviewer` agent reviews each completed phase's diff; critical/high findings go back to the same builder via SendMessage for one fix round, and all findings append to `REVIEW.md` in the feature directory. (2) Trust-but-verify: the orchestrator re-runs every task's `<verify>` command after the builder claims COMPLETE, before marking the phase done. (3) Interactive NEEDS_CONTEXT: the orchestrator collects missing info via AskUserQuestion and SendMessages it to the still-alive builder instead of stopping — in both `/ship:build` and `/ship:go`. (4) The builder inherits the session model instead of pinning sonnet.

## Decisions

- **Scope — all four improvements in one feature:** review gate, trust-but-verify, interactive NEEDS_CONTEXT, model inheritance. They all live in the build orchestration layer and ship together.
- **Architecture — keep Agent tool orchestration:** no Workflow-tool migration; the SendMessage retry machinery and subagent-stop hook backstop stay. Workflow migration may be a later feature.
- **Reviewer — new `ship-reviewer` agent:** lives in `agents/ship-reviewer.md` alongside builder/verifier, read-only tools, reviews the phase diff, emits a `review_result` JSON block. Ship stays self-contained (no dependency on other plugins' agents).
- **Fix loop — one round:** critical/high findings go to the same builder via SendMessage; fixes are re-reviewed once; anything unresolved is recorded as a concern, then the build proceeds.
- **Finding threshold — critical + high only trigger fixes:** medium/low findings are recorded but don't burn builder turns. Why: avoids style-nitpick loops.
- **NFR — error handling (reviewer):** degrade gracefully. If the reviewer errors, hits its turn limit, or returns unparseable output, the phase is marked done with a "review skipped" concern. Why: a broken reviewer must never block a working build (mirrors the hooks-never-throw principle).
- **Trust-but-verify scope — all task verifies:** re-run every `<verify>` command in the completed phase, not a sample.
- **Verify-fail handling — send back to builder:** failing command + output goes to the same builder to fix; if it fails again after the fix round, stop with CHECKPOINT. Why: a false COMPLETE is usually fixable with the failure evidence in hand; persistent failure is a Rule 3 signal.
- **Persistence — REVIEW.md in the feature directory:** each phase's findings (fixed and unresolved) append to `.planning/features/{name}/REVIEW.md` so `/ship:qa` and `/ship:verify` can cross-check and it survives compaction.
- **Model — builder only:** drop `model: sonnet` from `ship-builder.md` so it inherits the session model. Other agents (brainstormer: opus, qa, verifier) unchanged — separate decision. No automatic escalation logic this iteration.
- **Go workflow — adopt interactive NEEDS_CONTEXT:** `go.md` removes NEEDS_CONTEXT from stop conditions and uses the same ask-then-resume flow as the build skill.

## Acceptance Criteria

- [ ] After a builder phase returns COMPLETE or COMPLETE_WITH_CONCERNS, the build skill invokes `ship-reviewer` on that phase's diff before marking the phase done
- [ ] Critical/high review findings are sent to the same builder via SendMessage for exactly one fix round; fixes are re-reviewed; unresolved findings surface as phase concerns
- [ ] All review findings (fixed and unresolved) are appended per-phase to `.planning/features/{name}/REVIEW.md`
- [ ] A reviewer failure (error, turn exhaustion, unparseable output) results in the phase proceeding with a "review skipped" concern — the build is never blocked by the reviewer
- [ ] Before marking a phase done, the orchestrator re-runs every task's `<verify>` command; a failure is sent to the builder with the command output; a repeat failure after the fix round stops the build with CHECKPOINT
- [ ] A NEEDS_CONTEXT result triggers AskUserQuestion in the orchestrator and the answer is SendMessaged to the same builder agent, in both `/ship:build` and `/ship:go`
- [ ] `agents/ship-builder.md` has no pinned `model` (inherits the session model)
- [ ] `hooks/subagent-stop.cjs` validates the `ship-reviewer` agent's `review_result` block, with tests passing under `node --test`
- [ ] CLAUDE.md and README reflect the new build flow (reviewer agent, REVIEW.md artifact, updated agent count)

## Scope

**In scope:**
- `skills/build/SKILL.md` — review gate, trust-but-verify re-run, interactive NEEDS_CONTEXT
- `agents/ship-reviewer.md` — new reviewer agent with `review_result` JSON contract
- `agents/ship-builder.md` — remove `model: sonnet`
- `ship/workflows/go.md` — interactive NEEDS_CONTEXT handling
- `hooks/subagent-stop.cjs` + tests — validate `review_result`
- CLAUDE.md / README documentation updates

**Out of scope:**
- Workflow-tool migration / schema-enforced structured outputs
- Parallel phase building with worktree isolation
- Model changes to brainstormer, qa, or verifier agents; automatic model escalation
- Changes to `/ship:qa` or `/ship:verify` content (they may read REVIEW.md but their flow is unchanged)
- Remediation of pre-existing review findings outside the phase diff

## Research Notes

No external research needed. Capabilities verified in-session: SendMessage continuation to a live agent (already used by the build skill), AskUserQuestion in the main conversation (used by start/go), and Agent-tool model inheritance when frontmatter `model` is omitted.
