---
name: ship:plan
description: Use when a feature has been brainstormed and needs a detailed implementation plan with tasks
effort: high
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, WebFetch, AskUserQuestion
argument-hint: "[feature-name]"
---

Create an implementation plan for the active feature.

## Find Active Feature

Feature state is injected by hooks at session start and after compaction — check conversation context for "SHIP ACTIVE FEATURES" or "SHIP FEATURE STATE" blocks first.

1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `brainstormed` or `planned` (replanning)
3. If no injected state is available, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates exist, list them and pick the most recent
5. If no candidates exist, report that no plannable features were found

## Pre-Planning Exploration

Scale exploration to uncertainty — the gate is the output, not the process:

- **Read CONTEXT.md `## Codebase Notes` first, if present.** When the brainstormer already mapped the territory, do not re-explore it — verify with spot-checks only.
- **Small or familiar surface:** explore inline with Glob/Read/Grep.
- **Large or unfamiliar surface:** fan out parallel Explore agents — you choose how many and what each investigates. Similar features, architecture, and conventions remain useful lenses, not mandatory slots.

Planning may start only when you know the integration points, the closest existing patterns, and the conventions the new code must follow. Collect what you learned into an `## Exploration Findings` block; these findings land in PLAN.md's `## Exploration Summary`.

## Post-Exploration Clarifying Questions

Review the Exploration Findings and CONTEXT.md together. Ask follow-up questions only if ANY of these are true:

- An integration point exists that CONTEXT.md doesn't address
- A critical design decision wasn't settled during brainstorming but is now visible from the code
- A scope conflict exists between CONTEXT.md and actual codebase state
- The exploration revealed patterns that could significantly change the approach

If none apply, skip this step. If questions are warranted, use AskUserQuestion with 1-4 targeted questions informed by exploration findings.

## Plan the Feature

Now create the plan. You have the full exploration findings and CONTEXT.md. Do supplementary Glob/Read calls as needed for specific details.

### Step 1 — Understand the Goal

Extract from CONTEXT.md:
- The problem being solved
- The solution approach
- Acceptance criteria (these become your Must Deliver items)
- Scope boundaries (what's in, what's out)
- Decisions already made

### Step 2 — Use Exploration Findings

Use the pre-gathered exploration findings as your codebase understanding. Do supplementary Glob/Read calls only for specific details not covered.

### Step 3 — Research (if needed)

If the feature involves unfamiliar technology, make up to 3 WebFetch calls.

**Research when:** unfamiliar library, new API integration, uncertain config format.
**Skip when:** you're confident about the domain.

### Step 4 — Make Decisions

If CONTEXT.md contains a `## Chosen Architecture` section, use that approach as your architectural foundation.

Document implementation decisions not already in CONTEXT.md. For each, note the rationale.

If a decision contradicts CONTEXT.md, flag it explicitly.

### Step 5 — Design Tasks

Write 3-12 tasks. Each task must:
- Be atomic — one coherent chunk of work
- Have a specific verify command that proves the task is done
- List the exact files that will be created or modified
- Be ordered so each task builds on the previous

**Task XML format:**
```xml
<task id="1" status="pending" depends="(optional: comma-separated task IDs when dependency isn't simply the previous task)">
  <name>Verb phrase describing what is built</name>
  <files>exact/path/to/file.ts, another/path.ts</files>
  <reference>path/to/similar/existing_code.ts:functionName — closest existing pattern to follow</reference>
  <action>Specific implementation instructions. Include: function names, field names, schema shape, HTTP method + path, expected behavior. Be concrete enough that the builder can implement without guessing.</action>
  <verify>Runnable command that proves completion. Examples:
    - npm test -- --testPathPattern=auth
    - node -e "require('./src/models/user')"
    - grep -q "export function createUser" src/services/user.ts
  </verify>
</task>
```

**Reference field:** For each task, include a `<reference>` pointing to the closest existing code pattern found during exploration. The builder reads this file first and uses it as a template. Omit only if no analogous code exists in the project.

**Task dependencies:** Use `depends` when a task's dependency isn't simply the previous task (e.g., task 5 depends on tasks 1 and 3 but not 4). Omit when tasks are naturally sequential.

**Writing for the builder:** The build step follows instructions literally. Be unambiguous:
- Include literal function signatures
- Include schema shapes with field names and types
- Name specific imports
- Make all design decisions here — never leave a choice for the builder

**Specificity litmus test:** Could a different Claude instance execute this task without asking clarifying questions? If not, add more detail.

| TOO VAGUE | SPECIFIC ENOUGH |
|-----------|-----------------|
| "Add authentication" | "Add JWT auth using jose library, store in httpOnly cookie, 15min expiry. POST /api/auth/login accepts {email, password}, validates with bcrypt against User table, returns 200 + Set-Cookie on success, 401 on failure." |
| "Create the API" | "Create POST /api/projects endpoint in src/routes/projects.ts accepting {name: string, description: string}, validates name length 3-50 chars, inserts via db.projects.create(), returns 201 with project object." |
| "Handle errors" | "Wrap API calls in try/catch in src/services/api.ts. On 4xx/5xx return {error: string}. In src/components/Form.tsx show error via toast notification using existing showToast() from src/utils/toast.ts." |
| "Returns project object" | "Returns 201 with project. On validation: 400 with {error: string}. On duplicate name: 409. On DB error: 500 logged via existing logger." |

**Error path rule:** For tasks at system boundaries (API endpoints, file I/O, DB operations, external APIs), specify error responses in `<action>`: what errors can occur, what status/shape is returned, and whether errors are logged.

**Task ordering:** infrastructure before logic, models before services, services before routes.

**Phasing:** After designing all tasks, assess whether they need phases:
- **≤4 simple tasks:** flat plan, no phases
- **>4 tasks OR complex tasks:** wrap in `<phase>` groups

Phase sizing is judgment-based. General target: 3-5 tasks per phase. Group by natural boundaries: infrastructure → logic → integration → tests.

```xml
<phase id="1" name="Core data models" status="pending">
<task id="1" status="pending">...</task>
<task id="2" status="pending">...</task>
</phase>
```

Phase status: `pending` → `building` → `done`. Task IDs are globally unique across all phases.

**Integration verify:** The last task's `<verify>` must exercise the complete feature path, not just its individual piece. If the feature spans multiple layers (API + UI, or CLI + service), the final verify should test the integrated flow.

**Context-aware phasing:** Each phase should be completable within a single builder context window. If a phase requires reading >15 unique files or has >5 tasks with complex multi-file actions, split it. The builder runs with 40 maxTurns per phase — budget accordingly.

### Step 6 — Self-Check

Before writing, verify each check. Fix any issues.

#### 6.1 — Acceptance Criterion Coverage Map

Build an explicit mapping from each acceptance criterion to its implementing task(s):

```
Criterion: "Users can log in" → Task 3 (POST /api/auth/login)
Criterion: "Invalid credentials show error" → Task 3 (401) + Task 5 (toast)
```

**If any criterion has no task mapping, add a task.**

#### 6.2 — Task Completeness

Every task must have all four fields filled with specifics:
- `name`: Verb phrase
- `files`: Exact paths
- `action`: Implementation details with function signatures, field names, patterns
- `verify`: Runnable shell command

#### 6.3 — Wiring Completeness

Check that artifacts created in one task are consumed in another. A function that exists but is never imported is not done.

#### 6.4 — Verify Quality

Every `<verify>` must be a runnable shell command, not prose.

#### 6.5 — Task Ordering

No task depends on output from a later task.

#### 6.6 — Scope

3-12 tasks total. Fewer = underplanned. More = split the feature.

#### 6.7 — Phase Coherence (if phased)

Each phase is self-contained — no half-finished features mid-phase.

#### 6.8 — Adversarial Review

For each task involving external boundaries (API endpoints, file I/O, DB operations, user input), ask:
- What if this runs twice (idempotency)?
- What if input is null, empty, or malformed?
- What if a dependency (DB, API, file) is unavailable?
- Are there race conditions with concurrent access?
- Any security surface (injection, auth bypass, data exposure)?

Add mitigations to the relevant task's `<action>` if issues are found.

### Step 7 — Write PLAN.md

Write `.planning/features/{name}/PLAN.md`:

```markdown
---
feature: "{name}"
goal: "[Goal derived from CONTEXT.md]"
---

## Exploration Summary

**Similar patterns:** [file:line references to closest existing implementations]
**Architecture:** [module boundaries, layers, entry points relevant to this feature]
**Conventions:** [naming, imports, error handling, test patterns]

## Research Notes

[Findings, or "Domain familiar — no research needed"]

## Decisions

- [Decision]: [rationale]

## Must Deliver

- [Outcome statement mapping to acceptance criterion]

## Acceptance Coverage Map

[The mapping from Step 6.1]

---

<task id="1" status="pending">
  <name>...</name>
  <files>...</files>
  <reference>...</reference>
  <action>...</action>
  <verify>...</verify>
</task>

[more tasks...]

## Risk Notes

- [Task N — what could go wrong and what to do]
```

### Step 8 — Update CONTEXT.md Status

Update the `status` field in CONTEXT.md frontmatter to `planned`.

## Display Results

After writing, display:

```
## PLAN READY

Feature: {name}
Tasks: [N] [in M phases / flat]
Must Deliver: [N items]
Research: [done / skipped]

[List each task name on its own line, grouped by phase if phased]

Next: /ship:plan-verify
```

## What NOT to Do

- **Vague actions.** Never write `<action>Implement the feature</action>`.
- **Scope creep.** Only plan tasks that serve the acceptance criteria.
- **Open decisions.** Never write "choose an appropriate library" — pick one and name it.
- **Verify commands needing a running server without setup.**

$ARGUMENTS
