---
feature: "build-quality"
goal: "Add a per-phase review gate, orchestrator-side verify re-runs, interactive NEEDS_CONTEXT, and builder model inheritance to the build orchestration layer"
---

## Exploration Summary

**Similar patterns:**
- `agents/ship-qa.md` — closest agent template: sonnet, 40 maxTurns, fenced `qa_result` JSON contract with severity-tagged findings array, HARD-GATE block, Forbidden Responses, Rationalization Table, "What You Do NOT Do" section
- `agents/ship-verifier.md` — read-leaning agent consuming pre-gathered findings
- `skills/build/SKILL.md:83-121` — SendMessage auto-continue machinery (2 retries, then BUILDER EXHAUSTED report); `skills/build/SKILL.md:123-191` — status routing (COMPLETE / COMPLETE_WITH_CONCERNS / NEEDS_CONTEXT / CHECKPOINT)
- `hooks/subagent-stop.cjs:14-56` — `extractBuildResult` (fenced block → raw-JSON balanced-brace fallback → legacy Markdown); `:62-96` — `extractQaResult` (same shape, no legacy); `:106` — agent allowlist `['ship-builder', 'ship-qa']`
- `tests/subagent-stop.test.js:12-40` — `runHook` child-process helper; per-status pass-through tests + failure-case recovery tests

**Architecture:** Skills orchestrate inline (unlimited turns) and invoke agents via the Agent tool; agents emit fenced JSON result blocks; subagent-stop.cjs is a backstop that injects recovery context when a block is missing/invalid; go.md is a status-driven dispatcher that follows the build skill's instructions for the build step. PLAN.md task/phase status is the shared ground truth.

**Conventions:** kebab-case filenames; `.cjs` hooks (CommonJS, Node built-ins only, top-level try/catch, exit(0) silently on error); tests in `tests/{source-name}.test.js` using `node:test` + `node:assert/strict`; agent frontmatter `name/model/description/tools/maxTurns/memory/skills`; zero npm dependencies.

## Research Notes

Domain familiar — no research needed. Capabilities (SendMessage continuation, AskUserQuestion, model inheritance when frontmatter `model` omitted) verified during brainstorm.

## Decisions

- **Reviewer model — pin `sonnet`:** matches ship-qa/ship-verifier convention. CONTEXT.md restricts inheritance to the builder only; the reviewer is a bounded read-only task where sonnet is sufficient. Revisit with the other agents later.
- **Reviewer tools — `Read, Glob, Grep, Bash`:** Bash is required to view the phase diff (`git diff`, `git show`, `git log`). The agent body restricts Bash to read-only git commands and running nothing that mutates the tree. No Write/Edit — findings go in the JSON block; the orchestrator writes REVIEW.md.
- **`review_result` statuses — `APPROVED` | `NEEDS_FIXES`:** NEEDS_FIXES iff any critical/high finding; APPROVED otherwise (medium/low findings may still be present). Two statuses keep hook validation simple, mirroring qa_result's PASS/FAIL.
- **Orchestrator writes REVIEW.md, not the reviewer:** keeps the reviewer read-only and lets the orchestrator merge round-1/round-2 outcomes (fixed vs unresolved) into one per-phase section.
- **Ordering within the gate — trust-but-verify before review:** re-running verify commands is cheap and mechanical; no point reviewing a diff that doesn't even pass its own verifies.
- **NEEDS_CONTEXT loop cap — 2 rounds per phase:** a third NEEDS_CONTEXT in the same phase stops the build with the existing CONTEXT NEEDED report. Prevents an ask-loop when the builder keeps coming back for more.
- **Reviewer failure — no retry:** per CONTEXT.md, any reviewer failure (error, turn exhaustion, unparseable output) degrades to "review skipped" concern immediately. The subagent-stop hook's recovery message tells the orchestrator to treat it as skipped, not to retry.

## Must Deliver

- After a builder phase returns COMPLETE/COMPLETE_WITH_CONCERNS, the build skill re-runs every task `<verify>` command, then invokes `ship-reviewer` on the phase diff, before marking the phase done
- Critical/high review findings go to the same builder via SendMessage for exactly one fix round; fixes are re-reviewed once; unresolved findings surface as phase concerns
- All review findings (fixed and unresolved) append per-phase to `.planning/features/{name}/REVIEW.md`
- Reviewer failure never blocks the build — phase proceeds with a "review skipped" concern
- A verify re-run failure goes to the builder with the command output; repeat failure after the fix round stops the build with CHECKPOINT
- NEEDS_CONTEXT triggers AskUserQuestion and the answer is SendMessaged to the still-alive builder, in both `/ship:build` and `/ship:go`
- `agents/ship-builder.md` has no pinned `model`
- `hooks/subagent-stop.cjs` validates `review_result`, with tests passing under `node --test`
- CLAUDE.md and README reflect the new build flow

## Acceptance Coverage Map

```
Criterion: "review gate invoked on phase diff before phase done"        → Task 5
Criterion: "critical/high → one fix round → re-review → concerns"      → Task 5
Criterion: "findings appended per-phase to REVIEW.md"                  → Task 1 (contract) + Task 5 (writer)
Criterion: "reviewer failure → review skipped concern, never blocks"   → Task 2 (hook recovery) + Task 5 (skip path)
Criterion: "verify re-run, fail → builder, re-fail → CHECKPOINT"       → Task 6
Criterion: "interactive NEEDS_CONTEXT in build and go"                 → Task 7 (build) + Task 8 (go)
Criterion: "ship-builder.md has no pinned model"                       → Task 4
Criterion: "subagent-stop validates review_result, tests pass"         → Task 2 + Task 3
Criterion: "CLAUDE.md and README reflect new flow"                     → Task 9
```

---

<phase id="1" name="Reviewer agent and hook validation" status="done">

<task id="1" status="done" commit="7a344b3">
  <name>Create ship-reviewer agent with review_result JSON contract</name>
  <files>agents/ship-reviewer.md</files>
  <reference>agents/ship-qa.md — closest agent structure: frontmatter shape, HARD-GATE, severity definitions, findings array in fenced JSON result, Forbidden Responses, "What You Do NOT Do"</reference>
  <action>Create agents/ship-reviewer.md. Frontmatter:

```yaml
---
name: ship-reviewer
model: sonnet
description: Use when a build phase completes and its diff needs independent review — reviews the phase diff read-only and emits a review_result JSON block
tools: Read, Glob, Grep, Bash
maxTurns: 30
memory: project
---
```

Body sections (follow ship-qa.md's structure and tone):

1. Role statement: "You are the Ship Reviewer. Your job is to review the diff of a just-completed build phase for bugs the builder missed — before the phase is marked done. You review code; you never modify it."
2. HARD-GATE block: "Do NOT review files outside the phase diff. Do NOT modify any file. Do NOT run any command that mutates state — Bash is for read-only git commands (git diff, git show, git log, git rev-parse) only. Your findings go in the review_result JSON block; the orchestrator persists them."
3. "## Your Inputs" — invoked with: feature name, phase ID, and a git diff range (e.g. `abc1234~1..HEAD`). Read `.planning/features/{name}/PLAN.md` (what the phase was supposed to do) and `.planning/features/{name}/CONTEXT.md` (decisions and acceptance criteria). Run `git diff {range}` and `git diff --name-only {range}` to get the diff and changed-file list. Read full files for context only when the diff alone is ambiguous.
4. "## Review Dimensions" — check the diff for: (a) logic errors and bugs (off-by-one, inverted conditions, null/undefined access, unhandled error paths); (b) plan adherence (does the diff implement what the phase's `<action>` specs say — flag silent omissions); (c) security (injection, path traversal, secrets in code) when the diff touches input handling, shell commands, or file paths; (d) regressions (changes that break behavior visible elsewhere in the diff context). Do NOT flag style preferences, formatting, or pre-existing issues outside the diff.
5. "## Severity Definitions" — critical: data loss, security hole, or feature completely broken; high: incorrect behavior on realistic inputs, broken error handling on likely paths; medium: edge-case bug, fragile pattern, misleading naming that will cause bugs; low: minor robustness or clarity improvement. State explicitly: only critical and high trigger a fix round — be honest about severity, do not inflate medium findings to high.
6. "## Forbidden Responses" table mirroring ship-qa.md: "Looks good to me" without having run git diff; flagging pre-existing code outside the diff; severity inflation to force fixes; suggesting refactors beyond the phase scope.
7. "## What You Do NOT Do" — do NOT modify source files, do NOT write REVIEW.md (orchestrator's job), do NOT update PLAN.md or CONTEXT.md, do NOT re-run task verify commands (orchestrator already did), do NOT commit anything.
8. "## Output" — emit a fenced code block tagged `review_result`:

````
```review_result
{
  "feature": "{name}",
  "scope": "phase:{id}" | "all",
  "status": "APPROVED" | "NEEDS_FIXES",
  "findings": [
    {
      "id": 1,
      "severity": "critical" | "high" | "medium" | "low",
      "file": "{file}:{line}",
      "description": "{what is wrong}",
      "recommendation": "{how to fix it}"
    }
  ]
}
```
````

Status definitions: NEEDS_FIXES — one or more critical or high severity findings; APPROVED — no critical/high findings (medium/low findings may be present in the findings array). An empty findings array with APPROVED is a valid clean review.</action>
  <verify>grep -q "name: ship-reviewer" agents/ship-reviewer.md && grep -q "review_result" agents/ship-reviewer.md && grep -q "NEEDS_FIXES" agents/ship-reviewer.md</verify>
</task>

<task id="2" status="done" commit="7303496">
  <name>Validate review_result in subagent-stop hook</name>
  <files>hooks/subagent-stop.cjs</files>
  <reference>hooks/subagent-stop.cjs:62-96 extractQaResult — mirror this exact extraction shape (fenced block, then raw-JSON balanced-brace fallback, no legacy Markdown fallback)</reference>
  <action>Edit hooks/subagent-stop.cjs:

1. Add `const REVIEW_VALID_STATUSES = ['APPROVED', 'NEEDS_FIXES'];` next to the existing status constants (line 8).
2. Add `extractReviewResult(text)` mirroring `extractQaResult` exactly, but matching ```` ```review_result ```` fenced blocks and validating against REVIEW_VALID_STATUSES. Include the same raw-JSON balanced-brace fallback. No legacy Markdown fallback.
3. In the stdin handler, extend the agent allowlist (line 106) to `['ship-builder', 'ship-qa', 'ship-reviewer']`.
4. Add a `ship-reviewer` branch (before the builder fall-through, parallel to the ship-qa branch): extract via extractReviewResult; if valid, exit(0). If invalid/missing, inject recovery context using the same lastLines/truncated pattern:
   "REVIEWER AGENT STOPPED WITHOUT VALID RESULT. The reviewer agent did not emit a valid review_result JSON block with an expected status (APPROVED, NEEDS_FIXES). This likely means the reviewer hit its turn limit or encountered an error. Last output fragment:\n{truncated}\n\nRECOVERY: Treat this phase's review as skipped — record a 'review skipped' concern and proceed with the build. Do NOT retry the reviewer or block the phase."
5. Keep the top-level try/catch + silent exit(0) behavior untouched.</action>
  <verify>node -e "const t=require('fs').readFileSync('hooks/subagent-stop.cjs','utf8'); if(!t.includes('REVIEW_VALID_STATUSES')||!t.includes('ship-reviewer')||!t.includes('review_result')) process.exit(1)" && node --test tests/subagent-stop.test.js</verify>
</task>

<task id="3" status="done" commit="f00f8c9">
  <name>Add reviewer validation tests to subagent-stop suite</name>
  <files>tests/subagent-stop.test.js</files>
  <reference>tests/subagent-stop.test.js:47-176 — per-status pass-through tests and failure-case recovery tests for build_result; mirror structure for review_result</reference>
  <action>Append a `describe('subagent-stop hook — review_result')` block to tests/subagent-stop.test.js. Add a `reviewResultJson(obj)` helper mirroring `buildResultJson` (line 43) with the `review_result` fence tag. Tests:

1. Passes through valid APPROVED result with empty findings (agent_name: 'ship-reviewer'; expect output null, code 0).
2. Passes through valid NEEDS_FIXES result with a findings array containing one critical finding ({id:1, severity:'critical', file:'src/x.js:10', description:'...', recommendation:'...'}).
3. Passes through APPROVED with medium/low findings present.
4. Handles review_result JSON embedded in surrounding prose text.
5. Injects recovery for an unknown status (e.g. 'LGTM') — assert output.hookSpecificOutput.additionalContext includes 'REVIEWER AGENT STOPPED WITHOUT VALID RESULT' and 'review skipped'.
6. Injects recovery for missing result (plain prose message from ship-reviewer).
7. Injects recovery for malformed JSON inside a review_result fence.
8. Confirms a build_result block from agent_name 'ship-reviewer' does NOT pass validation (wrong block type → recovery injected).

Use the existing runHook helper unchanged.</action>
  <verify>node --test tests/subagent-stop.test.js</verify>
</task>

</phase>

<phase id="2" name="Build skill orchestration" status="done">

<task id="4" status="done" commit="b6d4dd1">
  <name>Remove pinned model from ship-builder agent</name>
  <files>agents/ship-builder.md</files>
  <reference>agents/ship-builder.md:1-12 — frontmatter block</reference>
  <action>Delete the `model: sonnet` line from agents/ship-builder.md frontmatter so the builder inherits the session model. Change nothing else in the file. Do NOT touch ship-qa.md, ship-verifier.md, or ship-brainstormer.md.</action>
  <verify>node -e "const t=require('fs').readFileSync('agents/ship-builder.md','utf8'); if(/^model:/m.test(t)) {console.error('model still pinned'); process.exit(1)}; if(!/^name: ship-builder$/m.test(t)) process.exit(1)"</verify>
</task>

<task id="5" status="done" commit="ea58c05" depends="1,2">
  <name>Add per-phase review gate to build skill</name>
  <files>skills/build/SKILL.md</files>
  <reference>skills/build/SKILL.md:83-121 — auto-continue SendMessage machinery; follow its step-numbered imperative style</reference>
  <action>Edit skills/build/SKILL.md. In "### 3. Handle Agent Result", change the COMPLETE and COMPLETE_WITH_CONCERNS branches: instead of immediately marking the phase done, both now route through two new gate sections in order — "### 3.1 Trust-But-Verify" (added by task 6; insert a forward reference placeholder line "Run the Trust-But-Verify gate (3.1), then the Review Gate (3.2), then mark the phase done.") and "### 3.2 Review Gate". This task writes section 3.2:

**### 3.2 Review Gate**

1. Compute the phase diff range: take the first commit hash from `result.commits` (plus any fix-round commits from 3.1) and run `git rev-parse {first-commit}~1` to get the base. The range is `{base}..HEAD`. If `result.commits` is empty or git rev-parse fails, skip the review with a "review skipped: no diff range" concern and proceed to mark the phase done.
2. Invoke the `ship-reviewer` agent via the Agent tool:

```
Review feature: {name}
Phase: {phase-id} — {phase-name}
Diff range: {base}..HEAD

Review the phase diff per your instructions. Read:
- .planning/features/{name}/PLAN.md
- .planning/features/{name}/CONTEXT.md

Emit your review_result JSON block when done.
```

3. Parse the fenced `review_result` JSON block from the reviewer's output. **If the Agent call errors, or no valid review_result block is found:** do NOT retry. Append to REVIEW.md (format below) a "Review skipped — reviewer failed or returned no parseable result" line for this phase, add "review skipped for phase {id}" to the phase's concerns, and proceed to mark the phase done. A broken reviewer must never block a working build.
4. **If status is "APPROVED":** append all findings (if any) to REVIEW.md marked `recorded`. Proceed to mark the phase done.
5. **If status is "NEEDS_FIXES":** append all findings to REVIEW.md, then run exactly one fix round:
   a. SendMessage to the **builder** agent (the same agent from step 2 of the phase loop):

```
The phase reviewer found issues that must be fixed before this phase can complete.
Fix ONLY these findings — do not refactor beyond them:

{numbered list of critical and high findings: severity, file, description, recommendation}

For each fix: implement it, re-run the affected task's <verify> command, and commit
with "fix({feature-name}): {short description}". Then emit an updated build_result JSON block.
```

   b. After the builder returns, SendMessage to the **reviewer** agent: "The builder applied fixes for your critical/high findings. New diff range: {base}..HEAD. Re-review ONLY whether each critical/high finding from your previous review is now resolved. Emit an updated review_result JSON block listing any still-unresolved findings." If this SendMessage fails or returns no parseable review_result, treat all findings from round 1 as unresolved concerns (do not loop).
   c. **One round only.** If the re-review still reports critical/high findings, record them in REVIEW.md as `unresolved`, add each to the phase's concerns list, and proceed to mark the phase done. Surface unresolved findings in the PHASE COMPLETE output under "Concerns".
6. Update REVIEW.md outcome markers: findings fixed in round 5a get `fixed in {commit-hash}`; medium/low get `recorded`; leftover critical/high get `unresolved`.

**REVIEW.md format** (orchestrator-owned; create `.planning/features/{name}/REVIEW.md` on first append):

```markdown
# Review Log — {feature-name}

## Phase {id} — {phase-name} (round {1|2})
Status: {APPROVED | NEEDS_FIXES | SKIPPED}
- [{severity}] {file}: {description} — {fixed in {hash} | unresolved | recorded}
```

Also update the PHASE COMPLETE output templates in section 3 to include a `Review: {APPROVED | {N} findings ({M} fixed, {K} unresolved) | skipped}` line. Do not change the NEEDS_CONTEXT or CHECKPOINT branches in this task (task 7 handles NEEDS_CONTEXT).</action>
  <verify>grep -q "Review Gate" skills/build/SKILL.md && grep -q "ship-reviewer" skills/build/SKILL.md && grep -q "REVIEW.md" skills/build/SKILL.md && grep -q "review_result" skills/build/SKILL.md</verify>
</task>

<task id="6" status="done" commit="af3887b" depends="5">
  <name>Add trust-but-verify gate to build skill</name>
  <files>skills/build/SKILL.md</files>
  <reference>skills/build/SKILL.md:83-121 — SendMessage continuation pattern; same imperative step style</reference>
  <action>Edit skills/build/SKILL.md. Write the "### 3.1 Trust-But-Verify" section (referenced by task 5's routing, positioned before 3.2 Review Gate):

**### 3.1 Trust-But-Verify**

The builder self-reports COMPLETE — independently confirm it before reviewing or marking the phase done.

1. From PLAN.md, collect the `<verify>` command of every task in the just-completed phase (tasks now marked status="done"). Re-run each command via Bash, in task order. Capture output and exit codes.
2. **All pass:** proceed to the Review Gate (3.2).
3. **Any fail:** SendMessage to the builder agent:

```
The orchestrator re-ran this phase's verify commands and task {id} ({task name}) failed:

Command: {verify command}
Exit code: {code}
Output:
{output, truncated to last 50 lines}

The task is not actually complete. Diagnose and fix the issue, re-run the verify command
until it passes, commit the fix with "fix({feature-name}): {short description}",
and emit an updated build_result JSON block.
```

   If multiple verifies failed, include all of them in one message.
4. After the builder returns, re-run ONLY the previously-failing verify commands.
5. **Still failing:** stop the build with CHECKPOINT semantics — leave CONTEXT.md status as `building`, do NOT mark the phase done, and output:

```
## CHECKPOINT REACHED

Feature: {name}
Phase: {phase-id} — {phase-name}
Reason: verify command for task {id} fails even after a fix round — builder reported COMPLETE but the work does not verify.
Failing command: {command}

Recommendation: investigate manually or replan this phase with /ship:plan {name}.
```

   **Stop the loop** — do not continue to the next phase, do not run the Review Gate.
6. **Now passing:** proceed to the Review Gate (3.2). Fix commits made here are included in the review diff range.

Edge rule: if a verify command cannot run at all in the orchestrator environment (missing tool, environment-specific path) and the failure output clearly shows an environment error rather than a code failure, record "verify {id} not re-runnable by orchestrator" as a phase concern and treat that single verify as passed — do not send environment problems to the builder.</action>
  <verify>grep -q "Trust-But-Verify" skills/build/SKILL.md && grep -qi "re-ran this phase's verify commands" skills/build/SKILL.md</verify>
</task>

<task id="7" status="done" commit="eceb3ef" depends="5">
  <name>Make NEEDS_CONTEXT interactive in build skill</name>
  <files>skills/build/SKILL.md</files>
  <reference>skills/build/SKILL.md:161-174 — current NEEDS_CONTEXT dead-stop branch to replace</reference>
  <action>Edit skills/build/SKILL.md:

1. Frontmatter: change `allowed-tools` to `Read, Write, Edit, Bash, Glob, Grep, Agent, SendMessage, AskUserQuestion`.
2. Replace the body of the **"If status is "NEEDS_CONTEXT":"** branch in section 3 with an interactive flow:

   a. Do NOT stop. The builder agent is still alive and holds warm context — collect the missing information and send it back.
   b. Use AskUserQuestion with one question built from `result.missing`: question text "The builder needs missing context to continue: {result.missing} — how should it proceed?", header "Context". Offer 2-4 plausible answer options when `result.missing` implies a choice (e.g. naming, approach, config value); when it is open-ended (e.g. an API key or URL), offer your best-guess options anyway — the user can always select "Other" and type a free-form answer.
   c. SendMessage to the builder agent:

```
The user provided the missing context you asked for:

Question: {result.missing}
Answer: {user's answer}

Continue with the remaining tasks in this phase and emit an updated build_result JSON block when done.
```

   d. Parse the new build_result from the SendMessage response and route it back through section 3's status handling (COMPLETE → gates 3.1/3.2; another NEEDS_CONTEXT → repeat this flow).
   e. **Cap: 2 NEEDS_CONTEXT rounds per phase.** On a third NEEDS_CONTEXT in the same phase, stop the loop, leave CONTEXT.md status as `building`, and output the existing CONTEXT NEEDED report plus the line "The builder asked for context 3 times in this phase — the plan likely has a gap. Consider /ship:plan {name} to replan."

3. Keep the CONTEXT NEEDED report template in the file for the cap case; otherwise this branch no longer stops the loop.</action>
  <verify>grep -q "AskUserQuestion" skills/build/SKILL.md && node -e "const t=require('fs').readFileSync('skills/build/SKILL.md','utf8'); const fm=t.split('---')[1]; if(!fm.includes('AskUserQuestion')) process.exit(1)"</verify>
</task>

</phase>

<phase id="3" name="Go workflow and documentation" status="done">

<task id="8" status="done" commit="3a0a249" depends="7">
  <name>Adopt interactive NEEDS_CONTEXT in go workflow</name>
  <files>ship/workflows/go.md</files>
  <reference>ship/workflows/go.md:71-82 — "Build status handling" and "Stop conditions" blocks to update</reference>
  <action>Edit ship/workflows/go.md:

1. In "**Build status handling:**", replace the NEEDS_CONTEXT line ("Stop and ask the user for the missing information. Do not continue until they provide it.") with: "**NEEDS_CONTEXT:** Do not stop. The build skill collects the missing information from the user via AskUserQuestion and sends the answer to the still-alive builder via SendMessage (capped at 2 rounds per phase — a third NEEDS_CONTEXT stops the build). Follow the build skill's interactive NEEDS_CONTEXT flow."
2. In "**Stop conditions:**", remove the line "Build returns NEEDS_CONTEXT (missing information — user must provide it)" and add "Build hits the NEEDS_CONTEXT round cap (builder asked 3 times in one phase — plan likely has a gap)".
3. In the status table and step 3 text, no other changes — phase looping, QA handling, and the plan approval gate stay as-is.
4. In the "Report" section's stop reasons, nothing structural changes; the NEEDS_CONTEXT cap case reads "Stopped at: build. Reason: NEEDS_CONTEXT round cap reached."</action>
  <verify>grep -q "AskUserQuestion" ship/workflows/go.md && node -e "const t=require('fs').readFileSync('ship/workflows/go.md','utf8'); if(t.includes('user must provide it')) process.exit(1)"</verify>
</task>

<task id="9" status="done" commit="718d781" depends="1,5,6,7,8">
  <name>Update CLAUDE.md and README for new build flow</name>
  <files>CLAUDE.md, README.md</files>
  <reference>CLAUDE.md — Architecture, Flow, Feature Directory Structure, and Key Concepts sections</reference>
  <action>Update CLAUDE.md:

1. Architecture block: `agents/*.md` line — change "3 specialized agents (brainstormer, builder, verifier)" to "4 specialized agents (brainstormer, builder, reviewer, verifier)" (adjust count upward if ship-qa is also listed in the file — count the actual agents/ directory).
2. Agents list: add `- ship-reviewer — per-phase diff review → review_result findings` alongside the other agent single-responsibility lines.
3. Feature Directory Structure: add `REVIEW.md   — per-phase review findings (fixed and unresolved)` to the `.planning/features/{feature-name}/` tree.
4. Key Concepts: add two bullets — "**Per-phase review gate:** after each build phase, a read-only ship-reviewer agent reviews the phase diff; critical/high findings trigger one builder fix round; all findings persist to REVIEW.md" and "**Trust-but-verify:** the build orchestrator re-runs every task's verify command after the builder claims COMPLETE; persistent failure stops the build with CHECKPOINT". Update the "Builder continuation" bullet if it mentions NEEDS_CONTEXT stopping — NEEDS_CONTEXT is now interactive (AskUserQuestion → SendMessage, 2-round cap).
5. hooks section: update subagent-stop.cjs description to "validates builder BUILD RESULT, QA, and reviewer REVIEW RESULT formats".

Update README.md (read it first to locate the matching sections): mirror the same changes wherever it describes the agent roster, build flow, feature directory artifacts, or NEEDS_CONTEXT behavior. Keep edits factual and minimal — match existing tone and depth. Do not renumber unrelated sections.</action>
  <verify>grep -q "ship-reviewer" CLAUDE.md && grep -q "REVIEW.md" CLAUDE.md && grep -q "ship-reviewer" README.md && node --test tests/</verify>
</task>

</phase>

## Risk Notes

- **Task 5 — diff range computation:** `result.commits` may contain hashes in non-chronological order or fix commits from 3.1 may predate review. Mitigation: the action pins base to `{first build commit}~1..HEAD`, which always covers the whole phase including fix commits; the skip path covers empty/invalid commits.
- **Task 5/6 — SendMessage to a dead builder:** if the builder agent was torn down between phases, SendMessage fails. The actions specify fallback behavior (reviewer: treat as unresolved; trust-but-verify failure with no reachable builder effectively becomes the CHECKPOINT stop). The builder is normally still alive because gates run immediately after its return.
- **Task 6 — environment-dependent verify commands:** orchestrator re-runs may fail for environment reasons, not code reasons (e.g. PATH differences). The edge rule in task 6 distinguishes environment errors from code failures to avoid false CHECKPOINTs.
- **Task 7 — AskUserQuestion in headless runs:** in non-interactive contexts the question cannot be answered; the existing 2-round cap plus CONTEXT NEEDED report is the degradation path.
- **Task 9 — README drift:** README structure isn't pre-read in this plan. The builder must read it first and adapt; the verify only asserts the ship-reviewer mention exists.

## Plan Review

**Status:** APPROVED
**Reviewed against:** skills/build/SKILL.md (auto-continue lines 83-121, NEEDS_CONTEXT branch lines 161-174), agents/ship-builder.md (frontmatter), agents/ship-qa.md (reference template for task 1), hooks/subagent-stop.cjs (extractQaResult lines 62-96, agent allowlist line 106), tests/subagent-stop.test.js (runHook helper, buildResultJson line 43), ship/workflows/go.md (status handling lines 71-82), agents/ and tests/ directory listings, README.md existence

### Findings

**Warnings:**
- Task 9 — CLAUDE.md's "3 specialized agents" line is already stale: agents/ contains 4 files today (brainstormer, builder, qa, verifier), so adding the reviewer makes 5. The task's instruction to "count the actual agents/ directory" governs — the literal "change 3 to 4" example text should not be followed blindly.
- Task 5 — inserts a routing line referencing section "3.1 Trust-But-Verify" which is only written by task 6. The dangling reference exists between the two commits; acceptable because both tasks are in phase 2 and strictly ordered, but the builder must not "helpfully" stub 3.1 in task 5.

**Suggestions:**
- Task 9's `node --test tests/` runs the full suite (7 test files) as an integration check — slower than targeting subagent-stop.test.js but a reasonable final gate for a markdown-orchestration feature with no runtime entry point.

Verify-command spot checks: task 4's `/^model:/m` regex does not falsely match `memory: project`; task 8's negative check string "user must provide it" appears at go.md line 79 and is removed by the task's own edits; task 3's test 8 is valid (a build_result block fails REVIEW_VALID_STATUSES validation via the raw-JSON fallback, so recovery fires).
