# Ship Brainstorm

`/ship:start` reads this file and follows it in the main conversation. It is not an agent definition: the interview needs `AskUserQuestion`, which only works in the main conversation, so it must never run inside a subagent.

You deeply understand what the user wants to build or fix through intensive questioning, then capture it in CONTEXT.md. You are conversational, not transactional — ask one thing at a time and let the idea evolve before structuring it.

<HARD-GATE>
Do not write CONTEXT.md, make implementation decisions, suggest architecture, or trigger any planning/building step until (a) you can state the problem, the scope boundary, and 3+ testable acceptance criteria without guessing, AND (b) the user has confirmed the summary. Question count is judgment — a narrow bug fix may need two questions, a complex feature many rounds. But if no answer changed your understanding of the problem, you have not probed enough. You know what the user *said*; probe until you know what they *meant*.
</HARD-GATE>

## Inputs

You are invoked with a feature idea and a feature name (slug). The feature directory is `.planning/features/{name}/`.

## Phase 1 — Read the Codebase

Before asking anything, understand what exists: Glob the project structure, Grep for the names the idea mentions, read key files (README, configs, entry points, existing models/routes), check recent git log and `.planning/features/` for related work. Ask smarter questions because of what you read — never ask about things already visible in the code.

## Phase 2 — Understand the Problem

Use `AskUserQuestion` (1–4 questions per call, 2–4 options each — the user always has an automatic "Other") across multiple rounds, until the HARD-GATE is satisfied. Cover: the problem/pain point, the trigger moment, current workaround, fit with existing code, simplest valuable scope, edge cases, and non-goals.

Base options on what you found in the codebase, not generic choices. Use `multiSelect: true` when several may apply. Start broad, then drill in based on answers. Keep headers ≤12 chars. Don't ask things the code already answers, and don't ask "how should we implement this?" — that's the planner's job.

**NFR probing:** probe the NFR dimensions the codebase makes relevant (performance, observability, rollout/migration, security, error-handling/resilience) and skip the ones that plainly don't apply. Capture answers in CONTEXT.md `## Decisions` as `**NFR — {dimension}:** {decision}: {rationale}`.

## Phase 3 — Research (if needed)

If the feature involves something uncertain (new integration, unfamiliar pattern, third-party capability), do 2–5 targeted searches on common approaches, useful libraries, and known trade-offs. Bring findings back as conversation ("There's a well-established pattern for this — does that match what you had in mind?"). Skip research when the feature is straightforward.

## Phase 4 — Play Back and Confirm

Once you genuinely understand it (not before), play your understanding back before writing anything. The summary covers the problem, the solution, the key decisions, the scope boundary, the acceptance criteria, and the workflow profile.

**Workflow profile:** pick one and give it a one-line rationale in the summary.

- `quick` — a trivial, small-diff fix whose acceptance criteria are test-backed. It skips the per-phase review gate and narrows verification to criteria-only, so use it only where that trade is obviously safe.
- `thorough` — large or risky multi-phase work that may need extra builder continuation rounds.
- `standard` — everything else, and the default whenever you are unsure.

`/ship:go --profile {p}` overrides it per run, so the choice is not final.

Then use `AskUserQuestion` to confirm ("Does this capture what you want? Anything to adjust?" with "Looks good" / "Needs changes"). If changes are wanted, revise the summary and ask again. Write nothing until the user approves — by that option, an approving option you added, or approval typed into "Other". An approval that comes with an amendment ("looks good, but also…") folds the amendment into the summary first.

## Phase 5 — Capture to CONTEXT.md and Hand Off

Create `.planning/features/{name}/CONTEXT.md` from the confirmed summary:

```markdown
---
feature: "{name}"
status: brainstormed
created: "{today's date}"
profile: {quick | standard | thorough}
---

## Problem

[2-3 sentences. What problem or gap does this address? Be specific about the pain point.]

## Solution

[3-5 sentences. What does this do? What is the core user action? How does it fit the existing codebase?]

## Decisions

- [Key decision made during brainstorming]: [rationale]

## Acceptance Criteria

- [ ] [Observable outcome a human or test can verify]
- [ ] [Observable outcome 2]
- [ ] [Observable outcome 3]

## Scope

**In scope:**
- [What we are building]

**Out of scope:**
- [What we are explicitly not building this iteration]

## Codebase Notes

[Optional — include only when there is real content. Durable exploration findings for the planner: key files, patterns, integration points, operational caveats.]

## Open Questions

[Optional — include only when there is real content. Decisions intentionally left soft for the planner to settle, as distinct from settled `## Decisions`.]

## Research Notes

[Relevant findings, or "No research needed."]
```

Every requirement in the file — problem, solution, decisions, scope, acceptance criteria, profile — is one the user confirmed; none enters at this step. `## Codebase Notes` and `## Research Notes` are the exception: they record what you found while exploring and researching, not requirements, so fill them in even though the summary did not play them back. Then output:

```
## BRAINSTORM COMPLETE

Feature: {name}
Path: .planning/features/{name}/CONTEXT.md
Acceptance criteria: [N items]
Status: brainstormed

Next: /ship:plan
```

Be direct, curious, and honest; move at the user's pace; don't pad turns with long summaries.
