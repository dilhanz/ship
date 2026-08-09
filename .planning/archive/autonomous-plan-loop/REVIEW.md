# Review Findings — autonomous-plan-loop

## Phase 1 — Agent contracts (round 1)

Status: APPROVED

- [low] tests/rearchitecture-v4.test.js:68: The sibling "agents are slimmed" test still loops over only the original four agents; ship-plan-reviewer and ship-replanner are not covered by the Rationalization Table / Forbidden Responses guard. T8 permitted leaving it unchanged, and neither new agent currently carries those sections, so this is a coverage gap rather than a defect. — recorded

## Phase 2 — Loop and wiring (round 1)

Status: APPROVED

- [medium] ship/workflows/plan.workflow.js:189: `review.findings.filter(...)` is read without a guard, unlike every other schema-required field in the file (`replan.changes || []`, `review.examined || []`) and unlike go.workflow.js, which defends `build.commits || []` / `build.tasks_completed || 0`. If a reviewer result arrives without `findings`, the TypeError propagates out of the workflow and kills the run instead of degrading through safeAgent to a BLOCKED result. — recorded
- [low] ship/workflows/plan.workflow.js:25: `roundOffset` is taken verbatim from args with only a falsy guard, so a string value makes `round + roundOffset` at :151 string-concatenate (`### Round 13` instead of `### Round 4`). Only symptom is a mislabelled PLAN.md history subsection. — recorded
- [low] skills/go/SKILL.md:41: The outcome block is written before branching on every terminal status, including NEEDS_INPUT, so PLAN.md can accumulate `### Outcome — NEEDS_INPUT` blocks ahead of the real terminal block. Matches T5's action text literally — plan-faithful, not a deviation. — recorded
- [low] skills/go/SKILL.md:21: Section 2 is titled "Advance Pre-Build Steps (inline)" and its lead-in still says "run these inline", but the `planned` row now dispatches to a Workflow (section 2a). — recorded

## Phase 3 — Tests and release (round 1)

Status: APPROVED

- [low] tests/plan-loop.test.js:227: The agent-wiring assertions use bare substring `includes()` for generic field names ("feature", "status", "file", "description", "options"), which occur in ordinary prose in the agent markdown, so the check can pass even if the documented result shape drifts away from PLAN_REVIEW_SCHEMA/REPLAN_SCHEMA. — recorded
- [low] tests/plan-loop.test.js:52: safeAgent labels its retry attempt `${label}:retry`, so the `reviews()`/`replans()` prefix filters count a retried call twice. Nothing is masked today, but a future single-failure-retry test would read the counts as an extra round. — recorded
