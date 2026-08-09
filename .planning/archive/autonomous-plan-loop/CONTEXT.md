---
feature: "autonomous-plan-loop"
status: done
created: "2026-08-10"
---

## Problem

`/ship:go` cannot get a feature from `brainstormed` to `plan-verified` unattended. `skills/go/SKILL.md:22` hard-stops on any NEEDS-REVISION verdict and tells the user to run `/ship:plan` by hand, so every plan ↔ plan-verify cycle costs a manual round-trip — even though the reviewer's CRITICAL findings are almost always mechanical (wrong path, missing dep, unresolved reference) and need no human judgment at all. The build side already solved this exact shape: `buildPhase()` in `ship/workflows/go.workflow.js:235` loops builders, embeds prior findings in the retry prompt, detects no-progress, and escalates only when genuinely stuck. The plan side never got the same treatment.

## Solution

Add `ship/workflows/plan.workflow.js` — a deterministic replan → re-review loop that mirrors `buildPhase()`. At status `planned`, `/ship:go` invokes it instead of the single-shot `/ship:plan-verify` skill. Each round runs a fresh `ship-plan-reviewer` agent; if CRITICAL findings remain, a `ship-replanner` agent revises PLAN.md with those findings embedded in its prompt, and the next round re-reviews. The loop returns `APPROVED` (no CRITICALs), `NEEDS_INPUT` (the replanner hit a decision it cannot settle), `STUCK` (the same CRITICALs recurred), or `UNRESOLVED` (5 rounds exhausted). Only `NEEDS_INPUT` interrupts the user, and it resumes after they answer. Round-1 planning stays inline in the main conversation — it is exploration-heavy, already automatic inside `/ship:go`, and is the one place `AskUserQuestion` earns its keep.

## Decisions

- **Loop lives in a workflow script, not skill prose:** a JS `for` loop with schema-validated `agent()` results is the only reliable way to express "repeat until approved" — markdown instructions get short-circuited by round 2. Same reason `buildPhase()` exists.
- **Revision loop only; round-1 plan stays inline:** the user's pain is the replan cycle, not the first plan. Initial planning needs unlimited turns and interactive clarification; revision is a bounded edit against a complete artifact and is safe subagent work.
- **Max 5 rounds:** matches `MAX_BUILD_ROUNDS` in `go.workflow.js:31` for symmetry across the two loops.
- **Convergence guard fires before the cap:** if a round's CRITICAL set equals the previous round's, the replanner cannot fix it — stop immediately rather than burning the remaining rounds.
- **Reviewer drift guard:** a fresh reviewer each round preserves independence (`skills/plan-verify/SKILL.md:23`) but can invent new CRITICALs forever. From round 2 on, the review prompt embeds the prior CRITICALs and scopes the review to (a) are these resolved and (b) new findings only if they would actually break the build. Same shape as `rereviewPrompt` at `go.workflow.js:218`.
- **STUCK/UNRESOLVED stop and report:** leave `status: planned`, surface the surviving CRITICALs and the round count, direct the user to `/ship:plan`. Mirrors how `stoppedAt` is reported today. Never silently proceed to build on a plan that failed review.
- **NEEDS_INPUT asks, then resumes:** the workflow returns the questions, `/ship:go` asks via `AskUserQuestion`, then re-invokes the workflow with the answers in `args` so the loop continues from that round. A full restart per clarification would make `needs_input` no better than a failure.
- **Escalation is structured data, not model judgment:** `needs_input` is a required schema field on the replanner's result. Leaving "should I ask the human?" to prose produces both silent wrong guesses and gating on trivia.
- **Replanner is biased against asking:** it may set `needs_input` only when the answer changes the plan's structure AND cannot be settled from CONTEXT.md or the codebase; otherwise it picks the option most consistent with existing patterns and records it under PLAN.md `## Decisions`. Without this, the interruption moves rather than disappears.
- **Replanner never writes CONTEXT.md:** PLAN.md is its only writable artifact. A CRITICAL that is really a requirements gap becomes a `needs_input` escalation. The brainstorm output stays human-owned.
- **Reviewer prompt extracted to `agents/ship-plan-reviewer.md`:** both `/ship:plan-verify` and the workflow invoke the same agent instead of duplicating ~65 lines of prompt (`skills/plan-verify/SKILL.md:29-93`) across two files.
- **`/ship:plan-verify` stays single-shot:** the manual path stays manual — one review, one verdict, user decides. Keeps the blast radius small and preserves the ability to inspect a review before anything rewrites PLAN.md.
- **Build-approval gate kept, `--auto` added:** the "Ready to build?" gate (`skills/go/SKILL.md:27-35`) fires after `plan-verified` and is outside the loop being fixed. Default behavior unchanged; `/ship:go --auto` skips it for fully hands-off runs.
- **NFR — error handling:** reuse the `safeAgent` wrapper (`go.workflow.js:153`). A dead reviewer must never yield `APPROVED` — the existing doctrine ("never approve a plan without a completed review", `skills/plan-verify/SKILL.md:109`) holds inside the loop: a null review after retry stops the loop and reports.
- **NFR — observability:** PLAN.md `## Plan Review` gains one subsection per round (findings + what the replanner changed), so the plan's history explains why it ended up as it did. No separate file, no telemetry.
- **NFR — cost:** the round cap and convergence guard are the cost control. Moving revision rounds out of the main conversation also stops full exploration + PLAN.md + review output landing in context three times over.
- **NFR — rollout:** additive. Existing `/ship:plan`, `/ship:plan-verify`, `/ship:build` paths are unchanged; only the `planned` row of the `go` routing table is rewired.

## Acceptance Criteria

- [ ] Driven by the stubbed-`agent()` harness in `tests/builder-continuation.test.js`, `plan.workflow.js` returns `{status: 'APPROVED', rounds: 1}` when the round-1 review has no CRITICAL findings, and never invokes a replanner
- [ ] Given CRITICALs in round 1 and a clean round 2, it returns `APPROVED` with `rounds: 2`, having invoked the replanner exactly once with the round-1 CRITICALs embedded in the replan prompt
- [ ] When two consecutive reviews return the same CRITICAL set, it returns `STUCK` immediately without spending the remaining rounds
- [ ] When every review returns different, still-CRITICAL findings, it stops after 5 rounds and returns `UNRESOLVED` with the surviving findings
- [ ] When the replanner returns a non-empty `needs_input`, it returns `NEEDS_INPUT` with the questions and runs no further review; re-invoked with `args.answers` present, the replan prompt contains those answers
- [ ] From round 2 on, the review prompt embeds the prior CRITICALs and instructs the reviewer to check resolution plus build-breaking new findings only
- [ ] When an agent yields no result after `safeAgent`'s retry, the workflow never returns `APPROVED` — it stops and reports
- [ ] `agents/ship-plan-reviewer.md` exists; `skills/plan-verify/SKILL.md` delegates to it, no longer carries the inline reviewer prompt, and still performs exactly one review round
- [ ] `agents/ship-replanner.md` exists, can write PLAN.md, and carries a HARD-GATE forbidding any modification of CONTEXT.md
- [ ] `skills/go/SKILL.md` at status `planned` invokes `plan.workflow.js` and branches on all four statuses; `STUCK` and `UNRESOLVED` leave CONTEXT.md `status: planned`
- [ ] `/ship:go --auto` skips the "Ready to build?" gate; without the flag the gate still fires
- [ ] After a multi-round run, PLAN.md `## Plan Review` contains one subsection per round
- [ ] `node --test` passes across the whole suite

## Scope

**In scope:**
- `ship/workflows/plan.workflow.js` — the replan → re-review loop
- `agents/ship-replanner.md` — new agent, PLAN.md-only write access, structured `needs_input`
- `agents/ship-plan-reviewer.md` — reviewer contract extracted from `skills/plan-verify/SKILL.md`
- `skills/plan-verify/SKILL.md` — rewired to delegate to the new agent, behavior otherwise unchanged
- `skills/go/SKILL.md` — `planned` row rewired to the workflow; four-way branch; `--auto` flag
- Tests for the loop's control flow, following the `builder-continuation.test.js` harness pattern
- Version bump (`ship/VERSION`, `package.json`, `.claude-plugin/plugin.json`) + CHANGELOG entry

**Out of scope:**
- Looping the manual `/ship:plan-verify` command
- The post-verify-FAIL rebuild path (verifier writes fix tasks → `plan-verified`) — keeps today's behavior
- Any replanner write access to CONTEXT.md
- Moving round-1 planning into a workflow
- Changing the brainstorm step or `/ship:start`

## Codebase Notes

- **The loop to mirror:** `ship/workflows/go.workflow.js:235` `buildPhase()` — rounds with a cap, prior state embedded in the continuation prompt, a landed/no-progress signal, and a terminal `EXHAUSTED` result. `fixPrompt` (:208) and `rereviewPrompt` (:218) show how findings are carried into a fresh agent that has no memory of the prior round.
- **`safeAgent`** (`go.workflow.js:153`) — retry-once-then-null wrapper around `agent()`, added because the harness's `StructuredOutput` wrapper has flaked. Reuse it; every call site must handle `null`.
- **Args unwrapping:** `go.workflow.js:17-24` defensively JSON-parses `args` up to 3 times — the runtime sometimes delivers a string. Copy this.
- **Test harness:** `tests/builder-continuation.test.js:20-30` strips `export const meta`, runs the script body in an async fn with injected globals, and stubs `agent()` with a `(label, prompt) => result` resolver. This makes every loop branch testable without spawning an agent. `tests/doctrine-v5-wiring.test.js` shows the cross-file wiring-assertion style (skill ↔ agent ↔ workflow contracts).
- **Current stop point:** `skills/go/SKILL.md:22` — the single table row that makes the cycle manual.
- **Reviewer prompt to extract:** `skills/plan-verify/SKILL.md:29-93`, plus the severity table at :99-107 (APPROVED iff zero CRITICALs) and the never-rubber-stamp rules at :183-190.
- **Agent frontmatter shape:** `agents/ship-reviewer.md:1-13` — `name`, `description`, `tools`, `maxTurns`, `memory`, plus a `<HARD-GATE>` block. `ship-plan-reviewer` is read-only (Read/Glob/Grep/Bash-for-probes); `ship-replanner` needs Write/Edit but must be gated to PLAN.md.
- **Namespacing:** agents are invoked from workflows as `agentType: 'ship:ship-replanner'` (see `go.workflow.js:248`), and from skills via the Agent tool by bare name.
- **Release convention:** `ship/VERSION`, `package.json`, and `.claude-plugin/plugin.json` must agree, with a matching `## {version}` CHANGELOG section, or the release workflow fails.

## Open Questions

- Whether `/ship:go` should re-enter the loop after `NEEDS_INPUT` via `resumeFromRunId` (cached prefix, cheaper) or a fresh `Workflow` invocation carrying `args.answers` (simpler contract, re-runs earlier rounds). The planner should settle this against how `resumeFromRunId` treats a changed `args` payload.
- Exact equality rule for the convergence guard — comparing normalized `{task id, file, description}` keys versus a looser similarity check. A too-strict rule lets a reworded finding pass as new; too loose stops a loop that was still converging.

## Research Notes

No research needed — this is an internal rearchitecture against patterns already established in the repo.
</content>
