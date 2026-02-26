# Workflow: plan-phase

This workflow guides Claude through planning a specific phase. It is invoked by the `/ship:plan-phase [N]` command.

---

## Purpose

Produce a concrete, executable plan for phase N — with specific tasks, file paths, and verify commands — before any code is written.

## Prerequisites

- `.planning/ROADMAP.md` must exist (run `/ship:new-project` first)
- `.planning/STATE.md` must exist
- Phase N must be defined in ROADMAP.md

## Steps

### Step 1 — Validate phase number

Read `.planning/ROADMAP.md` and `.planning/STATE.md`.

Check:
- Does phase N exist in the roadmap?
- Is there a prior phase that hasn't been verified yet? (Check STATE.md Phase History)
  - If yes, warn the user: "Phase [N-1] has not been verified yet. Continue anyway? (/ship:verify-phase [N-1] is recommended first)"

If the phase doesn't exist in the roadmap, tell the user and stop. Suggest `/ship:add-phase` to add new phases.

### Step 2 — Check for existing plan

Use Glob to check if `.planning/NN-PLAN.md` already exists.

- If it exists: read it, then ask: "A plan for Phase N already exists. Do you want to (1) use the existing plan, (2) replan from scratch, or (3) revise the existing plan?"
  - Use existing → stop here, tell user to run `/ship:execute-phase N`
  - Replan → proceed, the new plan will overwrite the old
  - Revise → proceed and instruct ship-planner to treat the existing plan as a draft to improve

### Step 3 — Invoke ship-planner

Invoke the `ship-planner` agent with the phase number, using `model: "opus"`.

> "Invoking ship-planner for Phase N — [Phase Name]"

The planner will:
- Read ROADMAP.md, STATE.md, PROJECT.md, REQUIREMENTS.md
- Read the previous phase's SUMMARY.md (if planning phase N > 1) for execution context and decisions
- Do up to 3 WebFetch calls if research is needed
- Write `.planning/NN-PLAN.md`
- Update STATE.md status to "executing"

### Step 3.5 — Verify plan quality

Invoke the `ship-plan-checker` agent with the phase number, using `model: "opus"`.

**If PLAN VERIFIED** → proceed to Step 4 normally.

**If PLAN HAS ISSUES:**

Present the issues to the user exactly as the checker reported them, then ask:

> "The plan has quality issues (see above). What would you like to do?
> (1) Revise the plan to fix them
> (2) Proceed anyway"

- If **revise**: invoke `ship-planner` again (with `model: "opus"`), passing the checker's issue list as additional context so it knows what to fix. After the revised plan is written, run `ship-plan-checker` (with `model: "opus"`) once more.
  - If the revised plan is **PLAN VERIFIED** → proceed to Step 4.
  - If the revised plan still has blockers → present the remaining issues to the user and ask: "The revised plan still has blockers. Proceed anyway, or stop here to fix manually?"
    - If proceed → continue to Step 4 with a note that issues were acknowledged.
    - If stop → tell the user to edit `.planning/NN-PLAN.md` manually and re-run `/ship:plan-phase N`.
- If **proceed anyway**: continue to Step 4 with a note that issues were acknowledged.

> Note: Only one revision attempt is made automatically. Do not loop the planner/checker more than once.

### Step 4 — Review with user

After the planner returns `## PLAN READY`, read the plan file and present a summary:

```
## Plan Ready — Phase N: [Phase Name]

Tasks ([N]):
1. [Task name] → [verify command]
2. [Task name] → [verify command]
...

Must Deliver:
- [Must deliver items]

[If research was done: "Research: [brief note on findings]"]
```

Ask: "Ready to execute? Run /ship:execute-phase N"

Do not auto-proceed to execution — the user should explicitly trigger it.

---

## Error Handling

**If ROADMAP.md doesn't exist:** Tell the user to run `/ship:new-project` first.

**If STATE.md shows the phase is already "complete":** Confirm before replanning — replanning a complete phase is unusual.

**If the planner returns fewer than 3 tasks:** This may indicate the phase scope is too small. Review with the user — small phases might be merged.

**If the planner returns more than 8 tasks:** The phase may be too large. Suggest splitting into two phases or identifying which tasks are optional.
