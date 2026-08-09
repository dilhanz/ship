---
feature: "autonomous-plan-loop"
goal: "Let /ship:go carry a feature from planned to plan-verified unattended via a deterministic replan → re-review loop, interrupting only when the replanner hits a decision it genuinely cannot settle"
---

## Exploration Summary

**Similar patterns:**
- `ship/workflows/go.workflow.js:235` `buildPhase()` — the loop to mirror: capped rounds, prior state embedded in a fresh agent's prompt, a landed/no-progress signal, terminal `EXHAUSTED` result.
- `ship/workflows/go.workflow.js:208` `fixPrompt` / `:218` `rereviewPrompt` — how findings are carried into an agent with no memory of the prior round.
- `ship/workflows/go.workflow.js:153` `safeAgent` — retry-once-then-null; every call site handles `null`.
- `ship/workflows/go.workflow.js:17-24` — defensive triple JSON-parse of `args`.
- `agents/ship-reviewer.md:1-13` — agent frontmatter shape (`name`, `description`, `tools`, `maxTurns`, `memory`) plus a `<HARD-GATE>` block; `:38-43` severity table; `:47-69` fenced `review_result` contract with the "structured output is enforced separately" note.
- `skills/plan-verify/SKILL.md:29-93` — the reviewer prompt to extract; `:99-107` severity table (APPROVED iff zero CRITICALs); `:183-190` never-rubber-stamp rules.
- `tests/builder-continuation.test.js:18-39` — the stubbed-`agent()` harness: strip `export const meta`, run the body in `new Function` with injected globals, resolve by `(label, prompt)`.
- `tests/doctrine-v5-wiring.test.js` — cross-file wiring-assertion style (skill ↔ agent ↔ workflow contracts, CHANGELOG ↔ VERSION).

**Architecture:** Skills (`skills/*/SKILL.md`) orchestrate; agents (`agents/*.md`) do bounded work; workflows (`ship/workflows/*.workflow.js`) express loops the model cannot be trusted to run in prose. Workflows invoke agents as `agentType: 'ship:ship-{name}'` (`go.workflow.js:248`); skills invoke them by bare name via the Agent tool.

**Conventions:** Zero npm dependencies; `node --test` with `tests/*.test.js`; workflow scripts are plain JS with a literal `export const meta`; `ship/VERSION`, `package.json`, `.claude-plugin/plugin.json` must agree with a matching `## {version}` CHANGELOG section.

**Existing tests that this feature breaks and must be updated (found during exploration, not in CONTEXT.md):**
- `tests/rearchitecture-v4.test.js:55-58` asserts `deepEqual(readdirSync('agents'), [4 agents])` — breaks the moment T1 lands. Retargeted in T8 (same phase as the break).
- `tests/doctrine-v5-wiring.test.js:37` asserts `skills/plan-verify/SKILL.md` itself contains "do not police document format" — that line moves into the extracted agent. Retargeted in T9.
- `tests/doctrine-v5-wiring.test.js:55-66` asserts `skills/go/SKILL.md` contains the literal `NEEDS-REVISION` — the go skill's `planned` row stops branching on that string. Retargeted in T9.

**Toolchain note:** on Node v25.8.1 `node --test tests/` fails with MODULE_NOT_FOUND (directory arguments are not accepted). Bare `node --test` and `node --test 'tests/*.test.js'` both run the suite. Every suite-wide verify in this plan uses bare `node --test`.

**Test-suite continuity rule:** each phase retargets the tests it breaks, so `node --test` is green at every phase boundary — not only after Phase 3.

## Research Notes

Domain familiar — no research needed. Internal rearchitecture over patterns already in the repo.

## Decisions

- **Open question 1 settled — `NEEDS_INPUT` resumes via a fresh `Workflow` invocation carrying `args.answers`, not `resumeFromRunId`.** By the time the user answers, the replanner has already rewritten PLAN.md, so a cached round-1 review verdict is stale — re-reviewing the revised plan is correct work, not waste. `resumeFromRunId` is also same-session-only and caches on unchanged `(prompt, opts)`, which an injected answers block invalidates from the first replan onward anyway. Fresh invocation keeps the contract to one shape.
- **Open question 2 settled — convergence key is `{task_id}||{file}`, normalized (trimmed, lowercased), compared as a set.** Description text is deliberately excluded: a reworded description for the same task and file is the same unresolved problem, and including it would let a paraphrase masquerade as progress. A genuinely new problem surfaces at a different task or file. Deterministic and directly testable.
- **The reviewer is read-only, so the replanner owns PLAN.md round history.** Each replan appends a `### Round {n}` subsection under `## Plan Review`. The go skill appends one final `### Outcome — {status}` block after the workflow returns. This satisfies "one subsection per round" without giving the reviewer write access.
- **Review severities stay `CRITICAL` / `WARNING` / `SUGGESTION`** (plan-review vocabulary), distinct from the build reviewer's lowercase `critical/high/medium/low`. Preserves the existing `/ship:plan-verify` contract verbatim.
- **`plan.workflow.js` returns a fifth status `BLOCKED`** beyond the four in CONTEXT.md, for "an agent returned nothing after `safeAgent`'s retry". CONTEXT.md requires that case never yield `APPROVED` and that the loop stop and report; giving it its own status keeps it distinguishable from `STUCK` (converged) and `UNRESOLVED` (cap hit). The go skill treats it like `STUCK`: leave `status: planned`, report, stop.
- **The cap check fires before replanning**, so round 5 ends on a review verdict rather than a replan whose result is never re-reviewed: 5 reviews, at most 4 replans.
- **`args.answers` is injected into every replan prompt of the run**, not just the round that raised the question — the loop restarts from round 1 on re-invocation, so the answers must be in scope wherever the replanner next needs them.

## Must Deliver

- `plan.workflow.js` returns `APPROVED` at `rounds: 1` with no replanner invoked when round 1 is clean
- CRITICALs in round 1 + clean round 2 → `APPROVED`, `rounds: 2`, exactly one replan carrying the round-1 CRITICALs
- Two consecutive identical CRITICAL sets → `STUCK` immediately, remaining rounds unspent
- Five rounds of distinct surviving CRITICALs → `UNRESOLVED` with the surviving findings
- Non-empty `needs_input` → `NEEDS_INPUT` with the questions and no further review; re-invocation with `args.answers` puts them in the replan prompt
- From round 2 on, the review prompt embeds prior CRITICALs and scopes the review to resolution + build-breaking new findings
- No agent result after retry → never `APPROVED`; stop and report
- `agents/ship-plan-reviewer.md` exists; `skills/plan-verify/SKILL.md` delegates to it, carries no inline reviewer prompt, still runs exactly one round
- `agents/ship-replanner.md` exists, writes PLAN.md, HARD-GATE forbids touching CONTEXT.md
- `skills/go/SKILL.md` at `planned` invokes the workflow and branches on all statuses; `STUCK`/`UNRESOLVED` leave `status: planned`
- `/ship:go --auto` skips the "Ready to build?" gate; without it the gate still fires
- After a multi-round run, PLAN.md `## Plan Review` holds one subsection per round
- `node --test` passes across the whole suite

## Acceptance Coverage Map

| Criterion | Task(s) |
|---|---|
| APPROVED at rounds 1, no replanner | T3 (loop) + T6 (test) |
| CRITICALs then clean → APPROVED rounds 2, one replan with findings embedded | T3 + T6 |
| Identical CRITICAL sets → STUCK immediately | T3 (convergence guard) + T6 |
| Five distinct rounds → UNRESOLVED with surviving findings | T3 (cap) + T6 |
| needs_input → NEEDS_INPUT, no further review; answers reach the replan prompt | T2 (schema field) + T3 + T6 |
| Round ≥2 review prompt embeds prior CRITICALs, scoped review | T1 (agent honors it) + T3 (prompt) + T6 |
| No agent result → never APPROVED | T3 (BLOCKED) + T6 |
| ship-plan-reviewer.md exists; plan-verify delegates, single-shot | T1 + T4 + T6 |
| ship-replanner.md exists, PLAN.md-only, CONTEXT.md HARD-GATE | T2 + T6 |
| go branches on all statuses; STUCK/UNRESOLVED keep `planned` | T5 + T6 |
| `--auto` skips the gate | T5 + T6 |
| PLAN.md `## Plan Review` one subsection per round | T2 (replanner writes it) + T5 (outcome block) + T6 |
| `node --test` passes | T8 (Phase 1) + T9 (Phase 2) + T6 + T7 |

---

<phase id="1" name="Agent contracts" status="pending">

<task id="1" status="done" commit="31ed602">
  <name>Extract the plan reviewer into agents/ship-plan-reviewer.md</name>
  <files>agents/ship-plan-reviewer.md</files>
  <reference>agents/ship-reviewer.md — frontmatter shape, HARD-GATE block, severity table, and the fenced result-block contract with the "structured output is enforced separately" note</reference>
  <action>Create the agent. Frontmatter: `name: ship-plan-reviewer`, a "Use when..." description, `tools: Read, Glob, Grep, Bash`, `maxTurns: 30`, `memory: project`. No `model` pin.

Body: port the reviewer prompt verbatim in substance from `skills/plan-verify/SKILL.md:30-92` — the independent-reviewer framing, "read both CONTEXT.md and PLAN.md", the READ-ONLY rule (Bash for existence/feasibility probes only, never modify a file), "stay plan-driven", the "Mechanical grounding" checklist (files paths, reference resolution, depends IDs, packages, verify commands) and the "Judgment review" checklist (completeness, wiring, ordering, pattern consistency, duplicate functionality, coverage, side effects). Carry across the sentence "Do NOT police document format — review substance, not section presence or wording." verbatim, the severity table from `:99-107`, the rule "APPROVED iff zero CRITICAL findings", and the never-rubber-stamp rules from `:183-190` (never approve without codebase-grounded exploration, never rewrite the plan, never block on style, never invent requirements).

Add a `<HARD-GATE>` block: do not modify any file; Bash is for read-only existence and feasibility probes only; findings go in the result block, the orchestrator persists them.

Add an `## Inputs` section: invoked with a feature name and, from round 2 of a loop onward, a list of prior CRITICAL findings. When prior findings are supplied, scope the review to (a) whether each is now resolved and (b) new findings raised only when they would actually break the build — do not re-litigate the plan from scratch.

Add an `## Output` section: emit a fenced block tagged `plan_review_result` as the final message, nothing after the closing fence, with the note that structured output is enforced separately when run inside a workflow. Shape:
{"feature": string, "status": "APPROVED" | "NEEDS-REVISION", "examined": [string], "findings": [{"severity": "CRITICAL"|"WARNING"|"SUGGESTION", "task_id": string|null, "file": string, "description": string, "evidence": string, "recommendation": string}]}
`status` is `APPROVED` iff `findings` contains zero `CRITICAL` entries. `task_id` is the PLAN.md task id the finding attaches to, or null for plan-wide findings. Note explicitly that `task_id` and `file` together identify a finding across rounds, so both must be stable and specific.</action>
  <verify>test -f agents/ship-plan-reviewer.md &amp;&amp; grep -q '^name: ship-plan-reviewer' agents/ship-plan-reviewer.md &amp;&amp; grep -qi 'do not police document format' agents/ship-plan-reviewer.md &amp;&amp; grep -q 'plan_review_result' agents/ship-plan-reviewer.md &amp;&amp; grep -q 'HARD-GATE' agents/ship-plan-reviewer.md</verify>
</task>

<task id="2" status="done" commit="ce6fdb6">
  <name>Create agents/ship-replanner.md with PLAN.md-only write access</name>
  <files>agents/ship-replanner.md</files>
  <reference>agents/ship-builder.md:1-11 — frontmatter with write tools; agents/ship-reviewer.md:11-13 — HARD-GATE block phrasing</reference>
  <action>Create the agent. Frontmatter: `name: ship-replanner`, a "Use when..." description (revise an existing PLAN.md to resolve plan-review CRITICAL findings), `tools: Read, Write, Edit, Glob, Grep, Bash`, `maxTurns: 30`, `memory: project`. No `model` pin.

`<HARD-GATE>`: PLAN.md for the named feature is the ONLY file you may create or modify. You must never modify CONTEXT.md — it is human-owned brainstorm output. Bash is for read-only inspection only. A CRITICAL finding that is really a requirements gap is NOT yours to fix: escalate it via `needs_input`.

`## Inputs`: a feature name, the CRITICAL findings from the latest review, and optionally an answers block from the user resolving questions a previous round raised. Read `.planning/features/{name}/PLAN.md` and `CONTEXT.md` (read-only), then verify each finding against the actual code before acting — a reviewer can be wrong, and a finding you disprove is resolved by leaving the plan correct and recording why.

`## Task format`: revisions must preserve the PLAN.md task XML contract — `<task id status depends>` with `<name>`, `<files>`, `<reference>`, `<action>`, `<verify>`; `<verify>` must be a runnable shell command; task ids stay globally unique; never renumber an existing task id (findings reference it across rounds).

`## Escalation bias` — the load-bearing rule: set `needs_input` ONLY when both hold: (a) the answer changes the plan's structure, and (b) it cannot be settled from CONTEXT.md, the codebase, or existing project conventions. Otherwise choose the option most consistent with existing patterns, apply it, and record it under PLAN.md `## Decisions` with its rationale. Do not escalate naming, decomposition, or anything the builder would decide anyway. When an answers block is supplied, treat those answers as settled and do not re-ask them.

`## Round history`: after revising, ensure a `## Plan Review` section exists in PLAN.md and append a `### Round {n}` subsection to it containing the CRITICAL findings received and a bullet per change made (or per finding disproved, with the evidence). Never rewrite or delete an earlier round's subsection.

`## Output`: emit a fenced block tagged `replan_result` as the final message, nothing after the closing fence, noting structured output is enforced separately inside a workflow. Shape:
{"feature": string, "status": "REVISED" | "NEEDS_INPUT", "changes": [string], "addressed": [string], "needs_input": [{"question": string, "options": [string], "why_blocking": string}], "notes": string|null}
`needs_input` is REQUIRED and is `[]` when nothing needs asking. `status` is `NEEDS_INPUT` iff `needs_input` is non-empty. When escalating, still commit any revisions you were able to make independently, and list them in `changes`.

Every `needs_input` entry MUST carry `question`, at least two and at most four concrete `options`, and `why_blocking`. State this as a hard requirement in the agent body: the orchestrator renders these directly as a multiple-choice question, so "I need more information" with no options is not a valid escalation. If you genuinely cannot name two candidate answers, you do not have a question the user can act on — settle it yourself per the escalation bias.</action>
  <verify>test -f agents/ship-replanner.md &amp;&amp; grep -q '^name: ship-replanner' agents/ship-replanner.md &amp;&amp; grep -q 'never modify CONTEXT.md' agents/ship-replanner.md &amp;&amp; grep -q 'replan_result' agents/ship-replanner.md &amp;&amp; grep -q 'needs_input' agents/ship-replanner.md</verify>
</task>

<task id="8" status="done" commit="c552fe5">
  <name>Retarget the agent-roster test to the six-agent roster</name>
  <files>tests/rearchitecture-v4.test.js</files>
  <reference>tests/rearchitecture-v4.test.js:54-58 — the `v4 — agent roster` block asserting `deepEqual` over `readdirSync('agents')`</reference>
  <action>T1 and T2 add two agent files, which breaks the exact-roster assertion in the same phase. Fix it here so the suite is green at the Phase 1 boundary.

Update the `exactly the 4 expected agents exist` test: rename it to reflect six agents and extend the sorted `deepEqual` expectation to `['ship-brainstormer.md', 'ship-builder.md', 'ship-plan-reviewer.md', 'ship-replanner.md', 'ship-reviewer.md', 'ship-verifier.md']`. KEEP `assert.deepEqual` — an exact roster is the point, so a stray agent file is still caught. Do not weaken it to a subset/`includes` check.

Leave the sibling `agents are slimmed` test's loop list unchanged unless the new agents also need that guarantee — if extending it, confirm neither new agent carries a `Rationalization Table` or `Forbidden Responses` section first.</action>
  <verify>node --test tests/rearchitecture-v4.test.js</verify>
</task>

</phase>

<phase id="2" name="Loop and wiring" status="pending">

<task id="3" status="done" commit="6595b88">
  <name>Implement ship/workflows/plan.workflow.js</name>
  <files>ship/workflows/plan.workflow.js</files>
  <reference>ship/workflows/go.workflow.js — copy the args-unwrapping (:17-24), safeAgent (:153-169), schema-constant style, and the buildPhase round-loop shape (:235-316)</reference>
  <action>Create the workflow script. It runs as a plain script body with `args`, `phase`, `log`, `agent`, `parallel`, `pipeline`, `budget` injected as globals (see the test harness in tests/builder-continuation.test.js:36).

Header: `export const meta = { name: 'ship-plan-loop', description: 'Replan → re-review a Ship feature plan until it has no CRITICAL findings', phases: [{ title: 'Plan review', detail: 'review the plan, revise it against CRITICAL findings, re-review' }] }` — a pure literal.

Args: `{ feature: string, answers?: string, roundOffset?: number }`. Unwrap `args` with the same defensive up-to-3× JSON.parse loop as go.workflow.js:17-24. Throw `new Error('plan.workflow: args.feature is required')` when feature is missing. `roundOffset` defaults to `0` and exists so a `NEEDS_INPUT` re-invocation — which restarts the internal loop at round 1 — does not make the replanner append a second `### Round 1` subsection colliding with the first run's (T2 forbids rewriting an earlier subsection). Only the replanner's history label uses the offset; the loop counter, the cap, and the returned `rounds` all stay 1-based and offset-free.

Constants: `MAX_PLAN_ROUNDS = 5`.

`PLAN_REVIEW_SCHEMA` — object, `additionalProperties: false`, required `['feature','status','findings']`; `status` enum `['APPROVED','NEEDS-REVISION']`; `examined` array of string; `findings` array of objects (`additionalProperties: false`, required `['severity','file','description']`) with `severity` enum `['CRITICAL','WARNING','SUGGESTION']`, `task_id` type `['string','null']`, `file` string, `description` string, `evidence` string, `recommendation` string.

`REPLAN_SCHEMA` — object, `additionalProperties: false`, required `['feature','status','changes','needs_input']`; `status` enum `['REVISED','NEEDS_INPUT']`; `changes` and `addressed` arrays of string; `needs_input` array of objects (`additionalProperties: false`, required `['question','options','why_blocking']`) with `question` string, `options` array of string with `minItems: 2` and `maxItems: 4`, `why_blocking` string; `notes` type `['string','null']`.

The `options` bounds are load-bearing, not cosmetic: T5 feeds each entry straight into `AskUserQuestion`, which requires 2-4 options. A question arriving with zero or one option would leave the branch undefined at the exact moment the user is being interrupted — the one path in this whole feature that must not fail. Enforcing it in the schema means `safeAgent` retries a malformed escalation instead of the go skill improvising one.

Copy `safeAgent` from go.workflow.js:153-169 verbatim (including the `retry` opt-out, unused here but kept identical for symmetry).

Prompts:
- `reviewPrompt(round, priorCriticals)` — round 1: "Review the plan for feature: {feature}" plus instructions to read `.planning/features/{feature}/PLAN.md` and `CONTEXT.md` and follow its review contract. Round ≥2: additionally state that a previous review raised the CRITICAL findings listed below and a replanner has since revised PLAN.md; that this agent has no memory of that review and must verify from the plan and code; that it must report (a) whether each listed finding is now resolved and (b) new findings ONLY when they would actually break the build. Render each prior finding as `{i}. [CRITICAL] Task {task_id or '—'} / {file} — {description}`. Same shape as go.workflow.js:218 `rereviewPrompt`.

  The round-≥2 prompt must also carry the **disproved-finding rule**: a replanner may resolve a finding by disproving it and recording the evidence under `## Plan Review` rather than by changing the plan. Treat such a finding as RESOLVED unless you can rebut that specific recorded evidence — and if you do re-raise it, cite the rebuttal. Without this, a correctly disproved finding leaves the plan unchanged, the next reviewer re-raises the same `task_id||file`, and the convergence guard returns `STUCK` on a plan that was already right.
- `replanPrompt(round, criticals, answers)` — "Revise the plan for feature: {feature}", the numbered CRITICAL list (severity, task id, file, description, and recommendation when present), the history round number `round + roundOffset` for the `### Round {n}` subsection it must append, and — when `answers` is a non-empty string — a `## Answers from the user` section carrying it verbatim with the instruction to treat those answers as settled and not re-ask them. Include the reminder that PLAN.md is its only writable artifact, that a requirements gap must be escalated via `needs_input`, and that disproving a finding (with the evidence recorded in the round subsection) is a valid resolution.

Convergence key: `const findingKey = (f) => \`${(f.task_id == null ? '' : String(f.task_id)).trim().toLowerCase()}||${String(f.file || '').trim().toLowerCase()}\`` and `sameCriticalSet(a, b)` comparing the two key sets — equal iff the Sets have the same size and every key of one is in the other. Return `false` when either list is empty.

Before the loop, declare the two accumulators the steps below read: `let priorCriticals = []` and `const history = []`. `priorCriticals` must start empty — step 2 returns `findings: priorCriticals` and a round-1 `BLOCKED` must report `[]`, not crash.

Loop, `for (let round = 1; round <= MAX_PLAN_ROUNDS; round++)`, with `phase('Plan review')` called once before it:
1. `review = await safeAgent(reviewPrompt(round, priorCriticals), { agentType: 'ship:ship-plan-reviewer', schema: PLAN_REVIEW_SCHEMA, phase: 'Plan review', label: \`plan-review:r${round}\` })`.
2. If `!review` → return `{ feature, status: 'BLOCKED', rounds: round, findings: priorCriticals, history, reason: 'the plan reviewer returned no result after retry — a plan is never approved without a completed review', recommendation: ... }`. Never APPROVED.
3. `criticals = review.findings.filter(f => f.severity === 'CRITICAL')`. Push `{ round, reviewStatus: review.status, criticals: criticals.length, findings: review.findings }` onto `history`.
4. If `criticals.length === 0` → return `{ feature, status: 'APPROVED', rounds: round, findings: review.findings.filter(f => f.severity !== 'CRITICAL'), examined: review.examined || [], history }`. Trust findings over the verdict in both directions: zero CRITICALs approves even if `review.status` says NEEDS-REVISION, and a non-empty CRITICAL list never approves.
5. If `priorCriticals.length && sameCriticalSet(criticals, priorCriticals)` → return `{ feature, status: 'STUCK', rounds: round, findings: criticals, history, reason: ..., recommendation: 'Run /ship:plan {feature} to rework the plan by hand.' }`. Log it.
6. If `round === MAX_PLAN_ROUNDS` → return `{ feature, status: 'UNRESOLVED', rounds: round, findings: criticals, history, reason: ..., recommendation: ... }`.
7. `replan = await safeAgent(replanPrompt(round, criticals, answers), { agentType: 'ship:ship-replanner', schema: REPLAN_SCHEMA, phase: 'Plan review', label: \`replan:r${round}\` })`. If `!replan` → return `BLOCKED` as in step 2 (with a reason naming the replanner). If `replan.needs_input && replan.needs_input.length` → return `{ feature, status: 'NEEDS_INPUT', rounds: round, questions: replan.needs_input, findings: criticals, changes: replan.changes || [], history }` and run no further review.
8. `priorCriticals = criticals`; continue.

`history` is returned on EVERY exit path (including `BLOCKED`, which may fire at round 1 before any replanner has written a `### Round n` subsection). It is the workflow's own record of what each round found, independent of whether the replanner survived to persist anything — T5 renders it into the PLAN.md outcome block, so it is a consumed return value, not diagnostics.

The loop always returns from inside; no fallthrough return is reachable, but the ordering above must be exact — the cap check precedes the replan so round 5 ends on a review verdict (5 reviews, at most 4 replans).</action>
  <verify>node -e "const fs=require('fs');const s=fs.readFileSync('ship/workflows/plan.workflow.js','utf8').replace('export const meta','const meta');new Function('args','phase','log','parallel','pipeline','agent','budget','return (async () => {'+s+'})()');console.log('ok')"</verify>
</task>

<task id="4" status="done" commit="959c825">
  <name>Rewire skills/plan-verify/SKILL.md to delegate to the plan reviewer agent</name>
  <files>skills/plan-verify/SKILL.md</files>
  <reference>skills/plan-verify/SKILL.md:21-93 — the section being replaced; skills/build/SKILL.md — how an inline skill invokes a named ship agent via the Agent tool</reference>
  <action>Replace the inline reviewer prompt (the fenced block at lines 29-93) with a delegation: launch ONE `ship-plan-reviewer` subagent via the Agent tool, passing only the feature name and the instruction to follow its review contract and return its `plan_review_result` block. Update the "How This Skill Works" section to name the agent while keeping its fresh-context rationale (the reviewer must not share the planner's conversation). The literal hyphenated string `fresh-context` must survive that rewrite — `tests/doctrine-v5.test.js:99` asserts it, and `skills/plan-verify/SKILL.md:23` is its only occurrence in the file, inside the very sentence being replaced.

Everything else stays byte-for-byte behaviorally identical: the Find Active Feature block, the severity table, the APPROVED-iff-zero-CRITICAL rule, the relaunch-once-then-report-and-stop rule ("never approve a plan without a completed review"), both PLAN.md append templates including the literal `**Status:** APPROVED` and `**Status:** NEEDS-REVISION` lines, `status: plan-verified` on approval, the `## PLAN REVIEW COMPLETE` display block, and the What NOT to Do list. This skill remains SINGLE-SHOT — exactly one review round, no revision loop. State that explicitly in the body so the contrast with the go loop is on the page.

Delete the now-duplicated prompt content from the skill (the mechanical-grounding and judgment-review checklists and the "do not police document format" line now live only in the agent), but keep a one-line pointer to `agents/ship-plan-reviewer.md` as the contract's home.</action>
  <verify>grep -q 'ship-plan-reviewer' skills/plan-verify/SKILL.md &amp;&amp; grep -q 'fresh-context' skills/plan-verify/SKILL.md &amp;&amp; ! grep -q 'Mechanical grounding' skills/plan-verify/SKILL.md &amp;&amp; grep -q '\*\*Status:\*\* APPROVED' skills/plan-verify/SKILL.md &amp;&amp; grep -q '\*\*Status:\*\* NEEDS-REVISION' skills/plan-verify/SKILL.md &amp;&amp; grep -q 'status: plan-verified' skills/plan-verify/SKILL.md &amp;&amp; grep -q '## PLAN REVIEW COMPLETE' skills/plan-verify/SKILL.md</verify>
</task>

<task id="5" status="done" commit="e0f7860">
  <name>Rewire the go skill's planned row to the loop and add --auto</name>
  <files>skills/go/SKILL.md</files>
  <reference>skills/go/SKILL.md:43-67 — the existing Workflow-invocation and Reconcile &amp; Report sections, whose structure the new plan-loop section mirrors</reference>
  <action>Edit the go skill:

1. **Routing table (line 22)**: replace the `planned` row's action with "Run the plan loop (section 2a)". Keep the `brainstormed` and `done` rows unchanged.

2. **New section "2a. Plan Loop (workflow)"**, placed between the routing table and the approval gate:
   - Invoke `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/ship/workflows/plan.workflow.js", args: { feature: "{name}" } })`.
   - Explain that it loops review → replan → re-review up to 5 rounds and returns `{ feature, status, rounds, findings, questions?, history }`, with agent output staying inside the workflow.
   - Branch on `status`:
   - On EVERY terminal status, write the outcome block to PLAN.md: ensure a `## Plan Review` section exists (**create it if absent** — on a clean round 1 no replanner ran, so the section does not exist yet), then append `### Outcome — {status}`. The block ALWAYS renders `rounds` and, when present, `reason` — then renders one line per round as `- Round {n}: {reviewStatus}, {criticals} critical`, but only when `history` is non-empty. A round-1 `BLOCKED` returns `history: []` (T3 step 2 returns before step 3 pushes), so `rounds` + `reason` are what make that case legible; the per-round lines carry the multi-round cases where no replanner subsection was written.
   - Branch on `status`:
     - `APPROVED` — set CONTEXT.md `status: plan-verified`; the outcome block additionally lists the round count, the examined files, and any WARNING/SUGGESTION findings; continue to the approval gate.
     - `NEEDS_INPUT` — ask the returned `questions` via AskUserQuestion (one question per entry, using its `options` plus the automatic Other), then RE-INVOKE the same workflow with `args: { feature, answers: "<Q/A transcript>", roundOffset: <total rounds spent so far across all invocations> }` and re-branch on the new status. The `roundOffset` is what keeps the replanner's `### Round {n}` headings unique across re-invocations — without it a second run restarts at `### Round 1` and collides with the first run's subsection, which T2 forbids it from rewriting. Do not use `resumeFromRunId`. Cap this at 2 re-invocations; if a third `NEEDS_INPUT` arrives, report it and stop.
     - `STUCK` — leave CONTEXT.md `status: planned`; report the surviving CRITICAL findings and the round count; tell the user to run `/ship:plan {name}`; stop.
     - `UNRESOLVED` — same as STUCK but reporting that 5 rounds were spent; stop.
     - `BLOCKED` — leave `status: planned`; report that an agent produced no result after retry (a plan is never approved without a completed review) and that the run stopped; suggest `/ship:plan-verify {name}` to review once manually; stop.
   - State the invariant explicitly: only `APPROVED` advances the status machine; `STUCK`, `UNRESOLVED`, and `BLOCKED` all leave CONTEXT.md at `planned` and never proceed to build.

3. **`--auto` flag**: in section 1, parse `--auto` out of `$ARGUMENTS` before resolving the feature name (so `/ship:go my-feature --auto` and `/ship:go --auto` both work). In section 3, state that the "Ready to build?" AskUserQuestion gate is skipped when `--auto` was passed and fires otherwise. Document the flag in the skill's opening paragraph and in `argument-hint`.

4. Update the opening paragraph so it no longer claims plan-verify runs inline — the plan revision loop now runs in a workflow; round-1 planning and the finish step stay inline.</action>
  <verify>grep -q 'plan.workflow.js' skills/go/SKILL.md &amp;&amp; grep -q -- '--auto' skills/go/SKILL.md &amp;&amp; for s in APPROVED NEEDS_INPUT STUCK UNRESOLVED BLOCKED; do grep -q "$s" skills/go/SKILL.md || exit 1; done &amp;&amp; echo ok</verify>
</task>

<task id="9" status="done" commit="4b1cdaf">
  <name>Retarget the doctrine-v5 wiring assertions that T4 and T5 move</name>
  <files>tests/doctrine-v5-wiring.test.js</files>
  <reference>tests/doctrine-v5-wiring.test.js:34-38 — the `plan-verify no longer format-polices` test; :54-67 — the `go skill routes on the verdict strings plan-verify still emits` test</reference>
  <action>T4 moves the reviewer prompt out of `skills/plan-verify/SKILL.md` and T5 stops the go skill branching on `NEEDS-REVISION`, breaking two assertions in this file. Retarget them here, in the phase that causes the break, so `node --test` is green at the Phase 2 boundary. Do NOT delete either test.

1. `plan-verify no longer format-polices the plan document` (~:34): keep the `Exploration Summary.*non-empty` negative assertion against `skills/plan-verify/SKILL.md`. Move the `do not police document format` positive assertion to read `agents/ship-plan-reviewer.md` instead, and add an assertion that `skills/plan-verify/SKILL.md` names `ship-plan-reviewer` — so the rule's new home and the delegation that reaches it are both pinned.

2. `go skill routes on the verdict strings plan-verify still emits` (~:54): keep every `plan-verify` assertion exactly as-is (it still emits `APPROVED` and `NEEDS-REVISION`, still has `## PLAN REVIEW COMPLETE`, both `**Status:**` lines, and `status: plan-verified`). On the go side, keep asserting `APPROVED` and replace the `NEEDS-REVISION` assertion with the plan-loop statuses `NEEDS_INPUT`, `STUCK`, `UNRESOLVED`, `BLOCKED`. Rename the test if its current name no longer describes it.

Run the whole suite, not just this file — Phase 1's T8 and this task together must leave it green.</action>
  <verify>node --test</verify>
</task>

</phase>

<phase id="3" name="Tests and release" status="pending">

<task id="6" status="pending">
  <name>Test the loop's control flow and the cross-file wiring</name>
  <files>tests/plan-loop.test.js</files>
  <reference>tests/builder-continuation.test.js:18-39 — the runWorkflow harness to copy; tests/doctrine-v5-wiring.test.js:54-81 — the cross-file contract-assertion style</reference>
  <action>Create `tests/plan-loop.test.js` using `node:test` + `node:assert/strict`. Copy the `runWorkflow(args, resolve)` harness from tests/builder-continuation.test.js:22-39, pointed at `ship/workflows/plan.workflow.js`, returning `{ result, calls }` with `calls` collecting `opts.label` and `resolve(label, prompt)` driving each round.

Helpers: `clean()` → `{feature:'f', status:'APPROVED', findings:[]}`; `critical(taskId, file, desc)` → a CRITICAL finding object; `review(...findings)` → `{feature:'f', status:'NEEDS-REVISION', findings}`; `revised()` → `{feature:'f', status:'REVISED', changes:['x'], needs_input:[]}`.

Cases — one per acceptance criterion:
1. Clean round 1 → `result.status === 'APPROVED'`, `result.rounds === 1`, and `calls` contains no label starting with `replan:`.
2. CRITICALs in round 1, clean round 2 → `APPROVED`, `rounds === 2`; `calls` has exactly one `replan:` label; the captured replan prompt contains the round-1 finding's file and description.
3. The same CRITICAL set twice → `STUCK` with `rounds === 2`, and `calls` shows exactly two review calls (remaining rounds unspent). Include a variant where round 2's finding has the SAME `task_id`+`file` but a reworded description, asserting it still converges — this pins the decided key.
4. A different CRITICAL every round → `UNRESOLVED`, `rounds === 5`, exactly 5 `plan-review:` calls and 4 `replan:` calls, and `result.findings` carries round 5's surviving findings.
5. Replanner returns non-empty `needs_input` → `NEEDS_INPUT`, `result.questions` matches, and no review call occurs after that replan.
6. Re-invocation with `args.answers` → the captured round-1 replan prompt contains the answers text verbatim.
7. Round-2 review prompt contains the round-1 CRITICAL descriptions AND scoping language (assert on a phrase the workflow emits, e.g. /would actually break the build/).
8. Reviewer throws on both attempts (return a thunk that throws, as in builder-continuation.test.js:151) → `result.status === 'BLOCKED'`, never `APPROVED`. Same for a throwing replanner.
9. A review returning `status: 'APPROVED'` alongside a CRITICAL finding does NOT approve (findings beat the verdict).

Add a `describe('plan loop — agent and skill wiring')` block asserting: `agents/ship-plan-reviewer.md` exists with the `plan_review_result` contract and every severity string the workflow's schema accepts; `agents/ship-replanner.md` forbids modifying CONTEXT.md and requires `needs_input`; `skills/plan-verify/SKILL.md` names `ship-plan-reviewer` and carries no inline reviewer checklist; `skills/go/SKILL.md` mentions `plan.workflow.js`, `--auto`, and each of the five statuses the workflow can return.

Also assert the `roundOffset` contract: a run with `args.roundOffset: 3` puts `### Round 4` (not `### Round 1`) in the round-1 replan prompt, while `result.rounds` still counts from 1.

Note: the two `tests/doctrine-v5-wiring.test.js` retargetings are NOT in this task — they were moved into T9 (Phase 2), the phase that causes the break, so the suite is green at every phase boundary.</action>
  <verify>node --test tests/plan-loop.test.js</verify>
</task>

<task id="7" status="pending">
  <name>Bump the version, write the CHANGELOG entry, and update CLAUDE.md</name>
  <files>ship/VERSION, package.json, .claude-plugin/plugin.json, CHANGELOG.md, CLAUDE.md, README.md, skills/help/SKILL.md</files>
  <reference>CHANGELOG.md:3-20 — the 5.1.0 entry's structure (one-line summary, then ### Added / ### Changed / ### Fixed bullets)</reference>
  <action>Set the version to `5.2.0` in all three files (`ship/VERSION` — bare string; `package.json` `version`; `.claude-plugin/plugin.json` `version`). Minor, not patch: this adds a workflow, two agents, and a flag, all additively.

Add a `## 5.2.0` section at the top of CHANGELOG.md (directly under `# Changelog`), matching the existing entries' voice. `### Added`: the plan revision loop (`/ship:go` now carries a feature from `planned` to `plan-verified` unattended — review → replan → re-review, capped at 5 rounds, with a convergence guard that stops the moment a round's CRITICAL set repeats); the `ship-replanner` and `ship-plan-reviewer` agents; `/ship:go --auto` to skip the build-approval gate. `### Changed`: `/ship:plan-verify` now delegates to `ship-plan-reviewer` instead of carrying an inline prompt, and stays single-shot. Note that `NEEDS_INPUT` is the only case that interrupts, and that `STUCK`/`UNRESOLVED`/`BLOCKED` leave the feature at `planned` and never proceed to build.

Update CLAUDE.md: add `ship/workflows/plan.workflow.js` and the two new agents to the Architecture block and the agent list, and add a Key Concepts bullet for the plan revision loop alongside the existing "Workflow-engine `/ship:go`" bullet.

Update README.md: the **Plan** paragraph (~line 67) still describes the review as a single fresh-context subagent pass and never mentions the loop or `--auto`. Extend it to say that under `/ship:go` the review runs as a capped revision loop (review → replan → re-review, max 5 rounds, convergence guard) that interrupts only on `NEEDS_INPUT`, that `/ship:plan-verify` remains single-shot, and that `/ship:go --auto` skips the build-approval gate. No test asserts this — it is doc drift, but the README is the user-facing description of the flow this feature changes.

Update `skills/help/SKILL.md`: two lines directly contradict the post-T5 behavior — `:21` ("Auto-run remaining steps (plan → plan-verify → build → verify)") and `:34-35` ("`/ship:go` runs build→verify in a background Workflow …; plan, plan-verify, and finish run interactively"). Correct both to say the plan revision loop and the build→verify spine both run in workflows, while round-1 planning, the build-approval gate, and finish stay interactive; mention `--auto`. No test asserts these lines, but they are a contradiction rather than an omission.

The suite-wide verify uses bare `node --test`: on Node v25.8.1 a directory argument (`node --test tests/`) fails with MODULE_NOT_FOUND regardless of the task being correct. The two version greps are also split — `grep -q PATTERN a b` exits 0 on the first match across both operands, so a single combined grep would pass with only one of the two files bumped.</action>
  <verify>node --test &amp;&amp; grep -q '^5.2.0$' ship/VERSION &amp;&amp; grep -q '"version": "5.2.0"' package.json &amp;&amp; grep -q '"version": "5.2.0"' .claude-plugin/plugin.json &amp;&amp; grep -q '^## 5.2.0$' CHANGELOG.md &amp;&amp; grep -q 'plan.workflow.js' CLAUDE.md &amp;&amp; grep -q -- '--auto' README.md</verify>
</task>

</phase>

## Risk Notes

- **Task 4 — regression surface.** `tests/doctrine-v5-wiring.test.js` asserts several literal strings in `skills/plan-verify/SKILL.md`. Task 4 must keep `**Status:** APPROVED`, `**Status:** NEEDS-REVISION`, `status: plan-verified`, and `## PLAN REVIEW COMPLETE` intact; only the extracted prompt content leaves. Task 9 (same phase) retargets the two assertions that intentionally move.
- **Tasks 1-2 — agent-roster regression.** `tests/rearchitecture-v4.test.js:55-58` pins the agent directory to an exact 4-file `deepEqual`. Task 8 extends it to six in the same phase. If a future task adds a seventh agent, this assertion fails again by design.
- **Task 5 — `### Round n` collision.** A `NEEDS_INPUT` re-invocation restarts the loop at round 1, so without `args.roundOffset` the replanner would append a second `### Round 1` it is forbidden (T2) from merging with the first. T5 passes the cumulative round count; T6 pins it.
- **Task 3 — the `agent()` schema is a contract with two agents written in Markdown.** If T1/T2's documented result shapes drift from `PLAN_REVIEW_SCHEMA`/`REPLAN_SCHEMA`, the harness rejects the agent's output at runtime and `safeAgent` degrades to `null` → `BLOCKED`. Task 6's wiring block asserts the field names appear in both agent files; keep them in sync when editing either.
- **Task 3 — convergence false-negative.** Keying on `task_id||file` means a reviewer that reports the same problem against a different task id each round will not converge; the 5-round cap is the backstop, and `UNRESOLVED` reports it honestly. Acceptable by decision.
- **Task 5 — `NEEDS_INPUT` re-invocation restarts the loop from round 1.** Each re-invocation costs a fresh review of the (now revised) plan. The 2-re-invocation cap in T5 bounds the worst case at 3 full loop runs.
- **Task 3 — the parse-only verify is weak.** `<verify>` proves only that `plan.workflow.js` parses; a structurally wrong loop passes it and the real gate (T6) is a phase away. Accepted: a stub-agent smoke run inside a shell one-liner is unwieldy, and Phase 2's own review gate plus T6 catch it. If T3 lands and T6 then fails on control flow, that is the expected detection point, not a surprise.
- **Task 6 — the harness runs the workflow body via `new Function`.** Any top-level `await` is fine (the body is wrapped in an async IIFE), but `Date.now()`/`Math.random()` are unavailable in the real engine; keep them out of `plan.workflow.js` or the workflow will throw only in production, not in tests.

## Plan Review

### Round 1

**Status:** NEEDS-REVISION
**Reviewed against:** ship/workflows/go.workflow.js (safeAgent :153, fixPrompt :208, rereviewPrompt :218, buildPhase :235, args unwrap :17-24, agentType :248), tests/builder-continuation.test.js (runWorkflow harness :22-39), tests/rearchitecture-v4.test.js, tests/doctrine-v5.test.js, tests/doctrine-v5-wiring.test.js, skills/plan-verify/SKILL.md, skills/go/SKILL.md, skills/build/SKILL.md, agents/ship-reviewer.md, agents/ship-builder.md, package.json, ship/VERSION, .claude-plugin/plugin.json, CHANGELOG.md, README.md

### Critical Issues

- Task 1, 2, 6 — Adding `agents/ship-plan-reviewer.md` and `agents/ship-replanner.md` breaks an exact-roster assertion the plan never accounts for.
- Evidence: `tests/rearchitecture-v4.test.js:55-58` asserts `deepEqual(readdirSync('agents'), ['ship-brainstormer.md','ship-builder.md','ship-reviewer.md','ship-verifier.md'])`. Confirmed passing today; it fails the moment Task 1 lands, and Task 7's suite-wide verify fails with it. PLAN.md's "Existing tests that this feature breaks" list and Risk Notes both miss it — only `doctrine-v5-wiring.test.js` is retargeted.
- Fix: add `tests/rearchitecture-v4.test.js` to Task 6's `<files>` and update the roster expectation to the six agents, keeping the `deepEqual` so a stray agent is still caught.

- Task 7 — The verify command `node --test tests/` does not run the suite on this toolchain; it fails mechanically regardless of whether the task is done correctly.
- Evidence: on Node v25.8.1 (`engines: {"node": ">=18"}`), `node --test tests/` → `Cannot find module '/Users/dilhan/src/ship/tests'` (MODULE_NOT_FOUND). Reconfirmed directly during this review. Bare `node --test` and `node --test 'tests/*.test.js'` both run 106 tests / 27 suites green. Task 6's multi-file form is fine.
- Fix: change Task 7's verify to `node --test` (or `node --test 'tests/*.test.js'`).

### Warnings

- Task 7 — `grep -q '"version": "5.2.0"' package.json .claude-plugin/plugin.json` exits 0 on the first match across both file operands, so it passes when only one file was bumped. Split into two greps joined by `&&`.
- Phases 1-2 — The test suite is red from Task 1 until Task 6 lands two phases later (Task 1 breaks the agent roster; Task 4 breaks `doctrine-v5-wiring.test.js:37`). The per-phase review gate re-runs only each task's own verify, so a build interrupted after Phase 1 or 2 leaves a failing suite. Move each test retargeting into the phase that causes its break, leaving only `tests/plan-loop.test.js` in Phase 3.
- Task 3 / Task 5 — The workflow returns `history` but no task consumes it; Task 5's branches read only `status`, `rounds`, `findings`, `questions`, `examined`. Per-round PLAN.md observability then rests entirely on the replanner having written `### Round {n}`, so a round-1 `BLOCKED` (or a replanner that dies before writing) loses findings the workflow did return. Either render `history` in Task 5's outcome block or declare it diagnostic-only.
- Task 5 — The NEEDS_INPUT re-invocation restarts the loop at round 1, so the replanner appends a second `### Round 1` that collides with the first run's, while Task 2 forbids rewriting an earlier subsection. Up to three `### Round 1` headings are possible. Pass a round offset in `args`, or label re-invocation rounds distinctly.

### Suggestions

- Task 5 — The APPROVED branch assumes `## Plan Review` exists, but on a clean round 1 no replanner ran and the section is absent. Say "create if absent, then append".
- Task 3 — The verify only proves the file parses; a structurally wrong loop passes it and the real gate (Task 6) is a phase away. Consider a smoke run of the clean-round-1 case through the same `new Function` harness.
- Task 3 — `priorCriticals` and `history` are used but never declared in the action text; state `let priorCriticals = []` and `const history = []` before the loop (step 2 returns `findings: priorCriticals` at round 1, which must be `[]`).
- Task 3 — A replanner that correctly *disproves* a CRITICAL leaves the plan unchanged, the next reviewer re-raises the same `task_id||file`, and the loop returns `STUCK` at round 2 — a false stall on a plan that was already right. Have the round-≥2 review prompt treat a disproved finding with recorded evidence as resolved unless the reviewer can rebut that specific evidence.
- Task 7 — `README.md:67` still describes the plan review as one-shot and never mentions the loop or `--auto`. No test asserts it, so this is doc drift only; add `README.md` to Task 7.

### Verified Clean

All `<files>` parents exist; every `<reference>` resolves to the named symbol; no `depends` attributes so no dangling or circular IDs; no third-party packages introduced (stdlib `node:test`/`node:assert`/`node:fs`/`node:path` only); `PLAN_REVIEW_SCHEMA`/`REPLAN_SCHEMA` match the result shapes Tasks 1-2 document field-for-field; `ship:ship-plan-reviewer`/`ship:ship-replanner` namespacing matches `go.workflow.js:248`; `skills/go/SKILL.md` already allows `Workflow` and `AskUserQuestion`, `skills/plan-verify/SKILL.md` already allows `Agent`; the test-harness claim holds (top-level `return` works inside the async IIFE wrapper, template literals pass through `new Function` intact); the Task 4 and Task 5 shell forms parse and behave correctly; `doctrine-v5.test.js:97-102` survives Task 4 as written; every CONTEXT.md acceptance criterion maps to at least one task.

### Round 2 — revision

Revised in response to Round 1. Both CRITICALs independently reconfirmed before acting (`tests/rearchitecture-v4.test.js:55-58` deepEqual roster; `node --test tests/` → MODULE_NOT_FOUND on Node v25.8.1).

**CRITICALs addressed:**
- Agent-roster regression — added **T8** to Phase 1 (`tests/rearchitecture-v4.test.js`), extending the `deepEqual` to the six-agent roster while keeping the exact-match assertion. Recorded in the Exploration Summary breakage list and Risk Notes.
- `node --test tests/` — T7's verify is now bare `node --test`; the toolchain constraint is documented in the Exploration Summary so no later task reintroduces the directory form.

**Warnings addressed:**
- Red suite across phases — each phase now retargets the tests it breaks (T8 in Phase 1, **T9** in Phase 2); T6 shrinks to `tests/plan-loop.test.js` only. New "Test-suite continuity rule" states the invariant.
- `grep -q` over two file operands — T7's verify splits the two version greps with `&&`.
- Unused `history` — T3 now returns it on every exit path and T5 renders it as per-round lines in the PLAN.md outcome block, making a round-1 `BLOCKED` legible when no replanner subsection exists.
- `### Round 1` collision on re-invocation — added `args.roundOffset` to T3 (labels only, not the loop counter or `rounds`); T5 passes the cumulative count; T6 pins the behavior.

**Suggestions addressed:**
- APPROVED branch assuming `## Plan Review` exists — T5 now says create-if-absent, applied to all terminal statuses.
- Undeclared `priorCriticals` / `history` — T3 declares both before the loop, with the reason `priorCriticals` must start `[]`.
- Disproved-finding false STUCK — T3's round-≥2 review prompt carries a disproved-finding rule (resolved unless the recorded evidence is rebutted); the replan prompt states disproving is a valid resolution.
- `README.md` drift — added to T7's `<files>` with the specific paragraph and content to update; its `--auto` mention is now in T7's verify.

**Not changed:** T3's parse-only verify (suggestion). A stub-agent smoke run inside a shell one-liner is unwieldy; T6 is the real gate and the trade-off is now recorded in Risk Notes rather than left implicit.

### Round 3 — review

**Status:** APPROVED
**Reviewed against:** ship/workflows/go.workflow.js (args unwrap :17-24, MAX_BUILD_ROUNDS :31, schemas :33-60, safeAgent :153-169, fixPrompt :208, rereviewPrompt :218, buildPhase :235, agentType :248), tests/builder-continuation.test.js:18-39, tests/rearchitecture-v4.test.js (roster :54-58, version agreement :139-144, go wiring :99-104), tests/doctrine-v5-wiring.test.js:34-38/:54-66/:83-89, tests/doctrine-v5.test.js:43-49/:97-102, skills/plan-verify/SKILL.md, skills/go/SKILL.md, skills/build/SKILL.md:73, skills/verify/SKILL.md:23, skills/help/SKILL.md:31-35, agents/ship-reviewer.md, agents/ship-builder.md, .claude-plugin/plugin.json, install.js:34-98, CHANGELOG.md, README.md:58-80. Executed: `node --test` (106/106 green), `node --test tests/` (MODULE_NOT_FOUND), and the T3/T4/T5/T7/T8 verify shell forms in both pass and fail configurations.

Both Round 1 CRITICALs confirmed resolved:
- Agent roster — T8 lands in Phase 1 alongside the break, keeps `assert.deepEqual`, and its expected list is correctly sorted for JS string ordering (`ship-plan-reviewer` < `ship-replanner` < `ship-reviewer`).
- `node --test tests/` — directory form reconfirmed broken on Node v25.8.1; T7/T9 use bare `node --test`, T6/T8 use single-file paths.

Round 1 warnings also confirmed resolved: per-phase test continuity (no test outside T8/T9's targets asserts any literal T4/T5 moves; `doctrine-v5.test.js:97-102` survives T4 as written), split version greps (fail correctly when only one file is bumped), `history` consumed by T5, `roundOffset`. All `<reference>` line ranges resolve; no `depends` attributes; stdlib only; `ship:ship-*` namespacing matches `go.workflow.js:248`; workflows need no manifest registration.

### Findings

- [WARNING] Task 3 / Task 5 — `needs_input.options` was optional in `REPLAN_SCHEMA` while T5 feeds it straight to AskUserQuestion (which requires 2-4 options), leaving the branch undefined at the one moment the user is interrupted. **Fixed in this round:** `options` and `why_blocking` are now required with `minItems: 2` / `maxItems: 4`, and T2's output contract states the two-option minimum as a hard rule.
- [WARNING] Task 4 — `tests/doctrine-v5.test.js:99` pins the literal `fresh-context`, whose only occurrence is `skills/plan-verify/SKILL.md:23`, inside the sentence T4 rewrites; the breakage list missed it. **Fixed in this round:** T4's action calls out the constraint and its verify now greps for `fresh-context`.
- [WARNING] Task 7 — `skills/help/SKILL.md:21` and `:34-35` state the opposite of post-T5 behavior (a contradiction, not an omission). **Fixed in this round:** added to T7's `<files>` with the two lines named.
- [SUGGESTION] Task 3 / Task 5 — a round-1 `BLOCKED` returns `history: []` (step 2 returns before step 3 pushes), so per-round lines render nothing in exactly the case the plan cited. **Fixed in this round:** T5's outcome block always renders `rounds` + `reason`, with per-round lines conditional on non-empty `history`.

All four were folded into the plan on approval; none blocked.
