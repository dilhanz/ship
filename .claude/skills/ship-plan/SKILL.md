---
name: ship-plan
description: Create an implementation plan for the active feature from its CONTEXT.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, WebFetch, AskUserQuestion
argument-hint: "[feature-name]"
---

Create an implementation plan for the active feature.

## Find Active Feature

1. Look in `.planning/features/` for feature directories
2. Read each `CONTEXT.md` and check the `status` field
3. Find the feature with status `brainstormed` or `planned` (replanning)
4. If `$ARGUMENTS` is provided, use it as the feature name
5. If multiple candidates exist, list them and pick the most recent
6. If no candidates exist, report that no plannable features were found

## Pre-Planning Exploration

Launch 3 parallel exploration sub-agents using the Agent tool. Run all three simultaneously in a single response:

**Agent 1 — Similar Features:**
```
Explore the codebase and find features or patterns similar to this feature idea: {summary from CONTEXT.md}.
Use Glob, Read, and Grep to find analogous implementations. Report:
- File paths of similar implementations
- Patterns used (naming, structure, abstractions)
- Key function signatures and conventions
- How similar features integrate with the rest of the codebase
Be concise. Max 500 words.
```

**Agent 2 — Architecture Map:**
```
Map the architecture relevant to this feature: {summary from CONTEXT.md}.
Use Glob, Read, and Grep to identify:
- Module boundaries and directory structure in the relevant area
- Abstraction layers (models, services, routes, components, etc.)
- Entry points and integration patterns
- Dependencies between modules
Be concise. Max 500 words.
```

**Agent 3 — Codebase Conventions:**
```
Survey coding conventions in this project. Read 3-5 representative source files.
Report:
- File naming style (camelCase, kebab-case, PascalCase)
- Import patterns (relative vs alias, default vs named exports)
- Error handling conventions
- Test file locations and framework
- File extension conventions
- Any linting/formatting config (eslint, prettier, tsconfig)
Be concise. Max 500 words.
```

Collect the output from all three agents into an `## Exploration Findings` block.

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
<task id="1" status="pending">
  <name>Verb phrase describing what is built</name>
  <files>exact/path/to/file.ts, another/path.ts</files>
  <action>Specific implementation instructions. Include: function names, field names, schema shape, HTTP method + path, expected behavior. Be concrete enough that the builder can implement without guessing.</action>
  <verify>Runnable command that proves completion. Examples:
    - npm test -- --testPathPattern=auth
    - node -e "require('./src/models/user')"
    - grep -q "export function createUser" src/services/user.ts
  </verify>
</task>
```

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

### Step 7 — Write PLAN.md

Write `.planning/features/{name}/PLAN.md`:

```markdown
---
feature: "{name}"
goal: "[Goal derived from CONTEXT.md]"
---

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

Next: /ship-plan-verify
```

## What NOT to Do

- **Vague actions.** Never write `<action>Implement the feature</action>`.
- **Scope creep.** Only plan tasks that serve the acceptance criteria.
- **Open decisions.** Never write "choose an appropriate library" — pick one and name it.
- **Verify commands needing a running server without setup.**

$ARGUMENTS
