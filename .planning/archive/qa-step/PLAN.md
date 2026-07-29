---
feature: "qa-step"
goal: "Add a standalone QA step between build and verify that writes adversarial tests, commits them, and gates on critical/high bugs before verification"
---

## Exploration Summary

**Similar patterns:** The builder agent (`agents/ship-builder.md`) and verifier agent (`agents/ship-verifier.md`) are the closest analogues — both use sonnet model, structured JSON output blocks (`build_result`/`verify_result`), and are invoked by orchestrating skills (`skills/build/SKILL.md`, `skills/verify/SKILL.md`). The verify skill's pattern of pre-gathering `/review` findings and passing them to the verifier is the exact template for how QA findings will feed into the verifier.

**Architecture:** Skills invoke agents via the Agent tool. Agents emit fenced JSON blocks (`build_result`, `verify_result`) parsed by both the orchestrating skill and the `subagent-stop.cjs` hook. The go workflow (`ship/workflows/go.md`) maps statuses to next steps. Resume, status, and help skills each have status tables that need updating. The `scan-features.cjs` utility filters on `status === 'done'` — any non-done status (including `qa-passed`) is automatically included without code changes.

**Conventions:** Agents use kebab-case `.md` files with YAML frontmatter (`name`, `model`, `description`, `tools`, `maxTurns`, `memory`, `skills`). Skills live in `skills/{name}/SKILL.md`. Templates live in `ship/templates/`. Hooks are `.cjs` files with stdin→stdout JSON I/O, wrapped in try/catch, silent on error.

## Research Notes

Domain familiar — no research needed. All integration points are internal to Ship's existing architecture.

## Decisions

- **Stage 4 placement in verifier:** QA findings go into a new Stage 4 in the verifier (after PR Review), not replacing any existing stage. Medium/low QA bugs are informational (don't block PASS); critical/high should be rare at verify time since QA gates on them, but if present they block PASS.
- **Verify skill triggers on `qa-passed`:** The verify skill's feature finder changes from `built` to `qa-passed`, enforcing the QA gate. Users cannot skip QA and go directly to verify.
- **QA agent tools match builder:** Read, Write, Edit, Bash, Glob, Grep — same as builder. Needs Write for test files and QA.md, Bash for running tests and git commits.
- **Single `git-commits` skill preload:** QA agent only needs git-commits (for `test(feature): ...` format). No need for deviation-rules or tdd since QA writes its own tests, doesn't follow a task-by-task plan.

## Must Deliver

- New ship-qa agent that auto-discovers test frameworks, writes risk-based tests, commits them, and emits `qa_result` JSON
- New `/ship:qa` skill that orchestrates QA, handles pass/fail status transitions, and appends fix tasks on failure
- New QA.md template for structured QA reports
- Hook validation for `qa_result` in subagent-stop.cjs
- Verifier integration: verify skill reads QA.md, verifier agent processes findings in Stage 4
- Workflow updates: go workflow, resume, status, help all reflect the new `built → qa → qa-passed → verify` flow

## Acceptance Coverage Map

```
Criterion: "New agents/ship-qa.md agent file"                              → Task 2
Criterion: "New skills/qa/SKILL.md skill file"                             → Task 3
Criterion: "New ship/templates/QA.md template"                             → Task 1
Criterion: "QA agent auto-discovers test framework"                        → Task 2 (auto-discovery section)
Criterion: "QA agent writes test files and auto-commits"                   → Task 2 (execution loop + commit protocol)
Criterion: "QA agent performs risk-based category selection"               → Task 2 (risk assessment section)
Criterion: "QA agent produces structured qa_result JSON"                   → Task 2 (output section)
Criterion: "On critical/high bugs: status to plan-verified, fix tasks"     → Task 3 (FAIL handling)
Criterion: "On pass: status to qa-passed"                                  → Task 3 (PASS handling)
Criterion: "Verify skill reads QA.md, passes ## QA Findings to verifier"   → Task 7
Criterion: "Verifier agent processes QA findings in new Stage"             → Task 6
Criterion: "Go workflow updated"                                           → Task 8
Criterion: "Status, resume, help skills updated"                           → Task 9
Criterion: "hooks/subagent-stop.cjs updated for qa_result"                 → Task 4
Criterion: "New status qa-passed works with existing hooks"                → No task needed (scan-features.cjs already includes any non-done status)
```

---

<phase id="1" name="Core QA infrastructure" status="done">

<task id="1" status="done" commit="7252af0">
  <name>Create QA.md report template</name>
  <files>ship/templates/QA.md</files>
  <reference>ship/templates/VERIFY.md — template structure with frontmatter header, tables, and verdict sections</reference>
  <action>
Create `ship/templates/QA.md` with this structure:

```markdown
# QA Report — {feature-name}

**Feature:** {feature-name}
**Tested:** {date}
**Overall Status:** PASS | FAIL

## Test Plan

### Risk Assessment

[Which of the 6 categories (happy path, boundary, negative input, error handling, concurrency, security) are relevant to this feature and why. Categories not relevant should be listed with a brief reason for exclusion.]

### Selected Categories

| Category | Relevant? | Rationale |
|----------|-----------|-----------|
| Happy Path | Yes/No | [Why] |
| Boundary | Yes/No | [Why] |
| Negative Input | Yes/No | [Why] |
| Error Handling | Yes/No | [Why] |
| Concurrency | Yes/No | [Why] |
| Security | Yes/No | [Why] |

## Test Files Written

| # | File | Category | Tests | Commit |
|---|------|----------|-------|--------|
| 1 | [path/to/test.ts] | [category] | [count] | [short-hash] |

(If no tests written: "No test files written — see Exploratory Analysis for findings.")

## Test Results

**Total:** [N] tests | **Passed:** [N] | **Failed:** [N]

[Test command output summary]

## Bug Findings

| # | Severity | Category | Description | File | Evidence |
|---|----------|----------|-------------|------|----------|
| 1 | critical/high/medium/low | [category] | [description] | [file:line] | [test output or analysis] |

(If none: "No bugs found.")

### Severity Definitions

- **Critical:** Data loss, security vulnerability, crash in main flow
- **High:** Feature broken for common use case, silent data corruption
- **Medium:** Edge case failure, poor error message, minor logic error
- **Low:** Code smell, missing validation for unlikely input, style issue

## Exploratory Analysis

[Observations from code review beyond test coverage: potential race conditions, missing error handling, hardcoded values, untested paths. Each item with file:line reference.]

(If clean: "No additional concerns found beyond test coverage.")

## Verdict

**PASS** | **FAIL**

[1-2 sentences explaining the verdict. If FAIL, list the critical/high bugs that caused it.]
```
  </action>
  <verify>test -f ship/templates/QA.md && grep -q "Bug Findings" ship/templates/QA.md && grep -q "Risk Assessment" ship/templates/QA.md && echo "QA template exists with key sections"</verify>
</task>

<task id="2" status="done" commit="b223f47">
  <name>Create ship-qa agent with adversarial testing instructions</name>
  <files>agents/ship-qa.md</files>
  <reference>agents/ship-verifier.md — agent frontmatter pattern (name, model, tools, maxTurns, memory, skills) and structured output format</reference>
  <action>
Create `agents/ship-qa.md` with this exact frontmatter:

```yaml
---
name: ship-qa
model: sonnet
description: Use when a feature build is complete and needs adversarial QA testing — writes tests, commits them, and produces a QA report with bug findings
tools: Read, Write, Edit, Bash, Glob, Grep
maxTurns: 40
memory: project
skills:
  - git-commits
---
```

Body instructions (all sections below):

**Role introduction:**
"You are the Ship QA Engineer — an adversarial tester. Your job is to find bugs that the builder missed by writing targeted tests, running them, and reporting findings. You are not checking whether the feature meets its spec (that's the verifier's job) — you are probing for bugs, edge cases, and failure modes."

**HARD-GATE block:**
"Do NOT write any tests until you have completed the Risk Assessment. Do NOT commit test files until they pass. Do NOT write QA.md until all tests are committed."

**Your Inputs section:**
Agent is invoked with a feature name. Read:
1. `.planning/features/{name}/CONTEXT.md` — understand what was built
2. `.planning/features/{name}/PLAN.md` — understand implementation details, file paths, function signatures

**Step 1 — Auto-Discover Test Framework:**

Scan project root for test framework configuration. Check in this order:
1. `package.json` — look for `scripts.test`, `jest` config, `vitest` config, `mocha` in devDependencies
2. `pyproject.toml` or `setup.cfg` — look for `[tool.pytest]` or `unittest`
3. `Cargo.toml` — Rust projects use `cargo test`
4. `go.mod` — Go projects use `go test`
5. `Makefile` — look for a `test` target

Also scan for existing test files to understand conventions:
- Use Glob with patterns like `**/*.test.*`, `**/*.spec.*`, `**/test_*`, `**/*_test.*`, `tests/**`
- Read 1-2 existing test files to learn: import patterns, assertion style, test structure, file naming, test directory location

If no test framework is found, use the project's language runtime for basic assertions (e.g., `node -e "..."` for JS, `python -c "..."` for Python). Note this in QA.md.

**Step 2 — Risk Assessment:**

Read CONTEXT.md and PLAN.md. For each of the 6 test categories, assess relevance:

1. **Happy Path** — Does the feature have a main flow that should always work? (Usually yes)
2. **Boundary** — Are there numeric limits, string lengths, collection sizes, pagination? 
3. **Negative Input** — Does the feature accept user input that could be malformed, empty, or wrong type?
4. **Error Handling** — Does the feature interact with external systems (DB, API, file system) that could fail?
5. **Concurrency** — Could multiple users/processes hit this code simultaneously? Race conditions possible?
6. **Security** — Does the feature handle auth, user data, file paths, or shell commands? Injection possible?

Select 2-5 categories that are genuinely relevant. Do NOT select categories just for coverage — if the feature is a pure utility function with no I/O, concurrency and security are likely irrelevant.

**Step 3 — Write Tests:**

For each selected category, write test files:

- Place tests alongside existing test files (follow the project's convention discovered in Step 1)
- Name files following the project's test naming convention (e.g., `*.test.ts`, `test_*.py`)
- Write focused, specific tests — each test should probe one edge case or failure mode
- Include descriptive test names that explain what is being tested
- Test the actual implementation (import/require real modules), not mocked versions

Test writing priorities per category:
- **Happy Path:** Test the primary flow with valid inputs. Verify return values/side effects match expectations.
- **Boundary:** Test min/max values, empty collections, single-element collections, very large inputs, off-by-one.
- **Negative Input:** Test null, undefined, empty string, wrong types, malformed data, SQL/XSS payloads if applicable.
- **Error Handling:** Test what happens when dependencies fail — mock only external boundaries (network, file system), not internal code.
- **Concurrency:** Test parallel execution, check for race conditions with Promise.all or threading equivalents.
- **Security:** Test path traversal, injection, auth bypass, privilege escalation if applicable.

**Step 4 — Run Tests:**

Run all written tests using the discovered test framework command. Capture full output.

If tests fail:
- Distinguish between "test found a real bug" vs "test itself is wrong"
- If the test is wrong (bad import, wrong API usage), fix the test and re-run
- If the test reveals a real bug, record it as a bug finding
- Max 3 fix-and-retry cycles per test file

**Step 5 — Commit Test Files:**

For each test file that passes, commit it atomically:
```bash
git add <test-file-path>
git commit -m "test({feature-name}): <description of what the test covers>"
```

Follow the commit conventions from the preloaded `git-commits` skill. Stage only the test file(s), never `git add .`.

**Step 6 — Exploratory Analysis:**

After writing and committing tests, do a code review pass on the feature's changed files:
- Read each file listed in PLAN.md's `<files>` elements
- Look for: unhandled error paths, hardcoded values, missing input validation, potential null/undefined access, resource leaks, TODOs/FIXMEs left behind
- Note findings with file:line references
- These findings go into the Exploratory Analysis section of QA.md, not as test failures

**Step 7 — Write QA.md:**

Read the template from `${CLAUDE_PLUGIN_ROOT}/ship/templates/QA.md`. Write `.planning/features/{name}/QA.md` following the template structure. Fill in all sections with actual data from your testing.

**Step 8 — Determine Verdict:**

- **PASS:** No critical or high severity bugs. All written tests pass. Medium/low findings are acceptable.
- **FAIL:** One or more critical or high severity bugs found. These must be fixed before verification.

**Forbidden Responses section:**
- "The code looks correct" — write a test that proves it
- "This edge case is unlikely" — unlikely bugs are still bugs; if the category is selected, test it
- "Tests are passing" — without showing the test command output and exit code
- "I'll skip testing this because the builder already verified it" — builder verified happy path per task; you test what the builder didn't

**Rationalization Table:**

| Thought | Why It's Wrong |
|---------|---------------|
| "The builder's verify commands already tested this" | Builder verifies each task in isolation. You test cross-cutting concerns, edge cases, and failure modes the builder never checked. |
| "Writing tests for this simple code is overkill" | Simple code with subtle bugs causes the worst production incidents. Test it. |
| "I should skip concurrency testing — it's too hard to test reliably" | If you selected the category, write the test. Flaky evidence of a race condition is better than no evidence. |
| "No bugs found, so I'll just mark PASS" | Did you actually write and run tests? An empty QA pass is not a pass. |
| "Let me fix this bug I found" | You are QA, not a builder. Report bugs; don't fix code. Only fix your own test files. |

**What You Do NOT Do section:**
- Do NOT modify the feature's source code — only write test files
- Do NOT update CONTEXT.md status — the orchestrating skill handles that
- Do NOT modify PLAN.md — the orchestrating skill appends fix tasks if needed
- Do NOT run `git add .` — stage only your test files

**Output section:**

After writing QA.md, emit a `QA_RESULT` JSON block. Wrap in a fenced code block tagged `qa_result`:

````
```qa_result
{
  "feature": "{name}",
  "status": "PASS" | "FAIL",
  "tests_written": {number},
  "tests_passed": {number},
  "tests_failed": {number},
  "test_files": ["{path}", ...],
  "commits": ["{short-hash}", ...],
  "bugs": [
    {
      "id": {number},
      "severity": "critical" | "high" | "medium" | "low",
      "category": "happy-path" | "boundary" | "negative" | "error-handling" | "concurrency" | "security",
      "description": "{what is wrong}",
      "file": "{file:line}",
      "evidence": "{test name or analysis that found it}"
    }
  ]
}
```
````

Status definitions:
- **PASS** — No critical or high severity bugs. All committed tests pass. Medium/low bugs may exist but are non-blocking.
- **FAIL** — One or more critical or high severity bugs found. Feature needs fixes before verification.
  </action>
  <verify>test -f agents/ship-qa.md && grep -q "name: ship-qa" agents/ship-qa.md && grep -q "qa_result" agents/ship-qa.md && grep -q "maxTurns: 40" agents/ship-qa.md && echo "ship-qa agent exists with correct frontmatter and output format"</verify>
</task>

<task id="3" status="done" commit="9dbbc48">
  <name>Create qa skill with orchestration and status handling</name>
  <files>skills/qa/SKILL.md</files>
  <reference>skills/verify/SKILL.md — skill orchestration pattern (find feature, invoke agent, parse result, update status, display)</reference>
  <action>
Create `skills/qa/SKILL.md` with this exact frontmatter:

```yaml
---
name: ship:qa
description: Use when a feature build is complete and needs adversarial QA testing before verification
effort: high
allowed-tools: Read, Write, Edit, Agent, Glob, Bash
argument-hint: "[feature-name]"
---
```

Body instructions:

**Section 1 — "Run QA on the active feature's implementation."**

**Section 2 — Find Active Feature:**

Same pattern as verify skill:
1. If `$ARGUMENTS` is provided, use it as the feature name
2. Otherwise, use injected feature state to identify the feature with status `built`
3. If no injected state, fall back to scanning `.planning/features/*/CONTEXT.md`
4. If multiple candidates, list them and pick the most recent
5. If no candidates, report "no features found with status `built`. Run `/ship:build` first."

Include the standard header: "Feature state is injected by hooks at session start and after compaction — check conversation context for 'SHIP ACTIVE FEATURES' or 'SHIP FEATURE STATE' blocks first."

**Section 3 — Run QA:**

Use the Agent tool to invoke the `ship-qa` agent with this prompt:

```
QA feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

Follow your instructions: auto-discover the test framework, assess risk categories,
write and run tests, commit test files, write QA.md, and emit your qa_result JSON block.
```

**Section 4 — Display Results:**

After the QA agent completes, extract the `qa_result` JSON block from its output. Look for a fenced code block tagged `qa_result` and parse the JSON inside it.

Also read `.planning/features/{name}/QA.md` for the full report.

Display to the user using the JSON fields:

```
## QA COMPLETE

Feature: {result.feature}
Status: {result.status}

Tests: {result.tests_written} written, {result.tests_passed} passed, {result.tests_failed} failed
Test files: {result.test_files joined with ", "}
Commits: {result.commits joined with ", "}

[If result.bugs is non-empty:]
Bugs found:
- [{severity}] {description} ({file}) — {evidence}

[If result.status is "PASS":] QA passed! Next: /ship:verify
[If result.status is "FAIL":] QA found critical/high bugs. Fix tasks added to PLAN.md. Next: /ship:build
```

**Section 5 — Handle Result:**

**If status is "PASS":**
1. Update CONTEXT.md frontmatter to `status: qa-passed`
2. Display the success message above

**If status is "FAIL":**
1. Update CONTEXT.md frontmatter to `status: plan-verified`
2. Extract all bugs with severity "critical" or "high" from the `bugs` array
3. For each critical/high bug, append a fix task to PLAN.md in this format:

```xml
<task id="{next-id}" status="pending">
  <name>Fix: {bug description}</name>
  <files>{bug file path}</files>
  <action>Fix the {severity} bug found by QA: {bug description}.
Evidence: {bug evidence}.
Ensure the fix addresses the root cause, not just the symptom.</action>
  <verify>{test command that exercises the fix — use the test file that found the bug}</verify>
</task>
```

Task IDs should continue from the highest existing task ID in PLAN.md. If the plan is phased, add a new phase:

```xml
<phase id="{next-phase-id}" name="QA fixes" status="pending">
{fix tasks here}
</phase>
```

3. Display the failure message above

End the file with `$ARGUMENTS` on its own line.
  </action>
  <verify>test -f skills/qa/SKILL.md && grep -q "name: ship:qa" skills/qa/SKILL.md && grep -q "qa_result" skills/qa/SKILL.md && grep -q "qa-passed" skills/qa/SKILL.md && grep -q "plan-verified" skills/qa/SKILL.md && echo "qa skill exists with correct orchestration"</verify>
</task>

</phase>

<phase id="2" name="Hook and verification integration" status="done">

<task id="4" status="done" commit="43d9468">
  <name>Update subagent-stop hook to validate qa_result from ship-qa agent</name>
  <files>hooks/subagent-stop.cjs</files>
  <reference>hooks/subagent-stop.cjs:13-55 — extractBuildResult function pattern for fenced JSON block parsing</reference>
  <action>
Modify `hooks/subagent-stop.cjs` to also validate the `ship-qa` agent's output:

1. Add a second valid statuses constant for QA:
```js
const QA_VALID_STATUSES = ['PASS', 'FAIL'];
```

2. Add a new function `extractQaResult(text)` modeled on `extractBuildResult`:
   - Match fenced `qa_result` block: regex `/```qa_result\s*\n([\s\S]*?)```/`
   - Parse JSON, validate `status` field is in `QA_VALID_STATUSES`
   - Fallback: try raw JSON with `"status"` field matching QA statuses (same balanced-brace approach)
   - Return parsed object or null

3. In the main `process.stdin.on('end')` handler, update the agent name check:
   - Change `if (!data.agent_name || data.agent_name !== 'ship-builder')` to:
   ```js
   if (!data.agent_name || !['ship-builder', 'ship-qa'].includes(data.agent_name)) {
     process.exit(0);
   }
   ```

4. Branch based on agent name:
   - If `data.agent_name === 'ship-builder'`: use existing `extractBuildResult` logic (no change)
   - If `data.agent_name === 'ship-qa'`: use new `extractQaResult` logic
   - On valid result: `process.exit(0)`
   - On missing/invalid result: inject recovery message similar to builder but referencing QA:
   ```
   'QA AGENT STOPPED WITHOUT VALID RESULT. ' +
   'The QA agent did not emit a valid qa_result JSON block with an expected status ' +
   '(PASS, FAIL). ' +
   'This likely means the QA agent hit its turn limit or encountered an error. ' +
   'Last output fragment:\n' + truncated + '\n\n' +
   'RECOVERY: Check if .planning/features/{name}/QA.md was written for partial results. ' +
   'Consider re-invoking the QA agent.'
   ```

Maintain the existing try/catch + silent exit pattern. No new dependencies.
  </action>
  <verify>node -e "const m = require('./hooks/subagent-stop.cjs'); console.log('module loaded')" 2>&1; grep -q "ship-qa" hooks/subagent-stop.cjs && grep -q "qa_result" hooks/subagent-stop.cjs && grep -q "QA_VALID_STATUSES" hooks/subagent-stop.cjs && echo "hook updated with QA support"</verify>
</task>

<task id="5" status="done" commit="8de3fd6">
  <name>Update VERIFY.md template with Stage 4 for QA findings</name>
  <files>ship/templates/VERIFY.md</files>
  <reference>ship/templates/VERIFY.md:29-47 — Stage 3 section pattern for external findings integration</reference>
  <action>
Add a Stage 4 section to `ship/templates/VERIFY.md` after the existing Stage 3 section (before "## Human Checks Required").

Insert this block after the `### PR Review Summary` section:

```markdown
## Stage 4 — QA Findings (from /ship:qa)

[Always populated from the QA agent's QA.md report. QA testing was performed by the ship-qa agent before verification.]

### Test Coverage

- **Tests written:** [N]
- **Tests passed:** [N] / [N]
- **Categories tested:** [list of categories from QA.md]

### Bug Findings

| # | Severity | Category | Description | File | Status |
|---|----------|----------|-------------|------|--------|
| 1 | critical/high/medium/low | [category] | [description] | [file:line] | [Open/Fixed] |

(If none: "No bugs found during QA.")

### QA Summary

- **Critical bugs:** [N]
- **High bugs:** [N]
- **Medium bugs:** [N] (noted, non-blocking)
- **Low bugs:** [N] (noted, non-blocking)
- **Verdict:** QA [PASS/FAIL]
```

No other changes to the template. Existing Stage 1, 2, 3, Human Checks, Gaps, Fix Tasks, and Recommendation sections remain unchanged.
  </action>
  <verify>grep -q "Stage 4" ship/templates/VERIFY.md && grep -q "QA Findings" ship/templates/VERIFY.md && grep -q "Stage 1" ship/templates/VERIFY.md && grep -q "Stage 3" ship/templates/VERIFY.md && echo "VERIFY template has all 4 stages"</verify>
</task>

<task id="6" status="done" commit="966b7b9">
  <name>Update verifier agent to process QA findings in Stage 4</name>
  <files>agents/ship-verifier.md</files>
  <reference>agents/ship-verifier.md:148-167 — Stage 3 pattern for processing external findings and applying to verdict</reference>
  <action>
Modify `agents/ship-verifier.md` to add Stage 4 processing:

1. **Update "Your Inputs" section** (line ~20): Add instruction to check prompt for `## QA Findings` section alongside `/review Findings`.

2. **Add Stage 4 section** after Stage 3 (after line ~167, before "### Determine Overall Status"):

```markdown
### Stage 4 — QA Findings (from /ship:qa)

This stage writes QA findings into VERIFY.md. The QA testing was performed by the ship-qa agent before you were invoked — you do not perform your own QA testing.

#### Step 4.1 — Extract QA Findings

Check your prompt for the `## QA Findings` section. If present:
- Parse bug findings with their severity (critical/high/medium/low), category, description, file, and evidence
- Parse test coverage numbers (tests written, passed, failed)
- Write them into the Stage 4 section of VERIFY.md using the findings table format
- Preserve the original severity classifications from QA

If no QA findings section is present in your prompt, write "No QA findings provided — QA was not run." in the Stage 4 section.

If the QA findings section indicates PASS with no bugs, write "QA passed — no bugs found. [N] tests written, all passing." in the Stage 4 section.

#### Step 4.2 — Apply to Verdict

QA findings affect the verdict based on severity:
- **Critical** QA bugs block PASS (set status to FAIL)
- **High** QA bugs block PASS (set status to PARTIAL if all Stage 1 criteria passed, FAIL otherwise)
- **Medium/Low** QA bugs are noted but do not block PASS
```

3. **Update "Determine Overall Status" section** to include Stage 4:

Update the three status definitions to reference Stage 4:
- **PASS:** All acceptance criteria verified (Stage 1) AND no CRITICAL or WARNING /review findings (Stage 3) AND no critical or high QA bugs (Stage 4)
- **PARTIAL:** Some acceptance criteria pass but some fail, OR all criteria pass but WARNING /review findings exist, OR all criteria pass but high QA bugs exist
- **FAIL:** Multiple acceptance criteria fail OR CRITICAL /review findings OR critical QA bugs

4. **Update Step 4 → Step 5 (Write VERIFY.md):** Renumber the existing "Step 4 — Write VERIFY.md" to "Step 5 — Write VERIFY.md". Add instruction to fill in Stage 4 from QA findings passed in the prompt. Mention that the Stage 4 section (QA Findings) is ALWAYS filled in from QA findings — same pattern as Stage 3.

5. **Update Step 5 → Step 6 (Update Status):** Renumber existing "Step 5 — Update Status" to "Step 6 — Update Status". No logic change needed — the status update rules remain the same (PASS → done, PARTIAL/FAIL → plan-verified + fix tasks).

6. **Update verify_result JSON block:** Add a `qa_findings` field to the output JSON:
```json
{
  "feature": "{name}",
  "status": "PASS" | "PARTIAL" | "FAIL",
  "criteria_passed": {number},
  "criteria_total": {number},
  "anti_patterns": {number},
  "review_findings": {
    "critical": {number},
    "warnings": {number},
    "suggestions": {number}
  },
  "qa_findings": {
    "critical": {number},
    "high": {number},
    "medium": {number},
    "low": {number},
    "tests_written": {number}
  },
  "human_checks": {number},
  "gaps": ["{description}", ...] | [],
  "pr_findings": [{"severity": "CRITICAL"|"WARNING", "description": "{text}"}, ...] | []
}
```

7. **Add to Rationalization Table:**
```
| "QA already passed, so I don't need to check QA findings" | QA passed means no critical/high bugs. Medium/low bugs still exist and should be documented in VERIFY.md for completeness. |
```
  </action>
  <verify>grep -q "Stage 4" agents/ship-verifier.md && grep -q "QA Findings" agents/ship-verifier.md && grep -q "qa_findings" agents/ship-verifier.md && grep -q "Step 4.1" agents/ship-verifier.md && echo "verifier agent has Stage 4 QA processing"</verify>
</task>

<task id="7" status="done" commit="d82d680">
  <name>Update verify skill to read QA.md and pass findings to verifier</name>
  <files>skills/verify/SKILL.md</files>
  <reference>skills/verify/SKILL.md:22-29 — pattern for pre-gathering /review findings and passing to verifier agent</reference>
  <action>
Modify `skills/verify/SKILL.md`:

1. **Update "Find Active Feature" section** (line ~16): Change step 2 from looking for status `built` to status `qa-passed`:
```
2. Otherwise, use injected feature state to identify the feature with status `qa-passed`
```

2. **Add "Gather QA Findings" section** between "Run Code Review" and "Run Verification":

```markdown
## Gather QA Findings

Read `.planning/features/{name}/QA.md` if it exists. Extract:
- Test coverage numbers (tests written, passed, failed)
- Bug findings table with severity, category, description, file, evidence
- QA verdict (PASS/FAIL)

Format as a `## QA Findings` section preserving all findings. If QA.md doesn't exist, write `## QA Findings\n\nNo QA report found — QA was not run.`
```

3. **Update "Run Verification" section** — update the agent prompt to include QA findings:

```
Verify feature: {name}

Read:
- .planning/features/{name}/CONTEXT.md
- .planning/features/{name}/PLAN.md

## /review Findings (pre-gathered for Stage 3)

{paste the /review findings here}

## QA Findings (pre-gathered for Stage 4)

{paste the QA findings here}

Follow your verification instructions. For Stage 3, write the /review findings above
into VERIFY.md's Stage 3 section. For Stage 4, write the QA findings above into
VERIFY.md's Stage 4 section. Both CRITICAL and WARNING /review findings block a PASS verdict.
Critical and high QA bugs also block a PASS verdict.
Stage 1 and Stage 2 remain fully independent — do not use review or QA findings for those.
```

4. **Update "Display Results" section** — add QA findings line to the display:

After the PR Review line, add:
```
QA: {result.qa_findings.critical} critical / {result.qa_findings.high} high / {result.qa_findings.medium} medium / {result.qa_findings.low} low ({result.qa_findings.tests_written} tests)
```
  </action>
  <verify>grep -q "qa-passed" skills/verify/SKILL.md && grep -q "QA Findings" skills/verify/SKILL.md && grep -q "QA.md" skills/verify/SKILL.md && grep -q "Stage 4" skills/verify/SKILL.md && echo "verify skill reads QA.md and passes findings to verifier"</verify>
</task>

</phase>

<phase id="3" name="Workflow and navigation updates" status="done">

<task id="8" status="done" commit="d980469">
  <name>Update go workflow with QA step in status flow</name>
  <files>ship/workflows/go.md</files>
  <reference>ship/workflows/go.md:16-26 — status-to-next-step table and execution logic</reference>
  <action>
Modify `ship/workflows/go.md`:

1. **Update the status table** in "### 2. Determine Next Step" to insert QA:

```markdown
| Status | Next Step |
|--------|-----------|
| `brainstormed` | Run plan (invoke /ship:plan skill) |
| `planned` | Run plan-verify (invoke /ship:plan-verify skill) |
| `plan-verified` | Run build (follow /ship:build skill instructions) |
| `building` | Resume build (follow /ship:build skill instructions — skip completed tasks) |
| `built` | Run QA (invoke /ship:qa skill) |
| `qa-passed` | Run verify (invoke /ship:verify skill) |
| `done` | Run finish (invoke /ship:finish skill) |
```

2. **Update "### 3. Execute Remaining Steps"** — change the sequence:

```markdown
Run each remaining step in sequence: **plan → plan-verify → build → qa → verify → finish**
```

3. **Add QA handling** after the "Phase-aware building" paragraph and before "Plan verification":

```markdown
**QA handling:** When QA completes, check the result:
- If PASS (status set to `qa-passed`): continue to verify
- If FAIL (status reset to `plan-verified`, fix tasks appended): stop and report — the user should review the fix tasks and run `/ship:build` to fix the bugs, then QA will run again
```

4. **Update stop conditions** to include QA failure:

Add a new bullet:
```
- QA returns FAIL (critical/high bugs found — fix tasks written, needs rebuild)
```
  </action>
  <verify>grep -q "qa-passed" ship/workflows/go.md && grep -q "/ship:qa" ship/workflows/go.md && grep -q "qa → verify" ship/workflows/go.md && echo "go workflow includes QA step"</verify>
</task>

<task id="9" status="done" commit="f6ef68e">
  <name>Update resume, status, and help skills with QA step</name>
  <files>skills/resume/SKILL.md, skills/status/SKILL.md, skills/help/SKILL.md</files>
  <reference>skills/resume/SKILL.md:17-26 — status-to-action table pattern</reference>
  <action>
**Update `skills/resume/SKILL.md`:**

Update the status-to-action table to insert QA entries:

```markdown
| Status | Action |
|--------|--------|
| `brainstormed` | Run `/ship:plan` |
| `planned` | Run `/ship:plan-verify` |
| `plan-verified` | Run `/ship:build` |
| `building` | Run `/ship:build` (will resume from last completed task) |
| `built` | Run `/ship:qa` |
| `qa-passed` | Run `/ship:verify` |
| `done` | Tell the user this feature is complete |
```

The key change: `built` now maps to `/ship:qa` instead of `/ship:verify`, and `qa-passed` maps to `/ship:verify`.

**Update `skills/status/SKILL.md`:**

Update the "Next step" section to include QA:

```markdown
   - `brainstormed` → "Next: `/ship:plan` to create the implementation plan"
   - `planned` → "Next: `/ship:plan-verify` to verify the plan against the codebase"
   - `plan-verified` → "Next: `/ship:build` to start building"
   - `building` → "Next: `/ship:build` to continue building (or `/ship:resume` in a new session)"
   - `built` → "Next: `/ship:qa` to run adversarial QA testing"
   - `qa-passed` → "Next: `/ship:verify` to verify acceptance criteria"
   - `done` → "Feature complete! Start something new with `/ship:start`"
```

The key change: `built` now suggests `/ship:qa` instead of `/ship:verify`, and `qa-passed` is a new entry.

**Update `skills/help/SKILL.md`:**

1. Update the Commands section to add `/ship:qa`:

```
  /ship:build          Execute the plan with atomic commits
  /ship:qa             Run adversarial QA testing (writes tests, finds bugs)
  /ship:verify         Verify implementation against acceptance criteria
```

2. Update the Flow section:

```
Flow:
  start → [design →] plan → plan-verify → build → qa → verify → finish
  (or just: start → go → finish)
```

3. Update the Feature directory section to add QA.md:

```
Feature directory: .planning/features/{name}/
  CONTEXT.md   Brainstorm output (problem, decisions, acceptance criteria)
  PLAN.md      Implementation plan with tasks
  QA.md        QA report (test plan, bugs, verdict)
  VERIFY.md    Verification report
```
  </action>
  <verify>grep -q "/ship:qa" skills/resume/SKILL.md && grep -q "qa-passed" skills/resume/SKILL.md && grep -q "/ship:qa" skills/status/SKILL.md && grep -q "qa-passed" skills/status/SKILL.md && grep -q "/ship:qa" skills/help/SKILL.md && grep -q "qa → verify" skills/help/SKILL.md && grep -q "QA.md" skills/help/SKILL.md && echo "all navigation skills updated with QA step"</verify>
</task>

</phase>

## Risk Notes

- **Task 2 — Agent instruction quality:** The ship-qa agent instructions are the most complex deliverable. If the agent produces poor tests or fails to auto-discover the test framework, the entire QA step provides no value. Mitigation: the agent follows the same structured approach as the builder/verifier with hard gates and forbidden responses.
- **Task 4 — Hook backward compatibility:** The subagent-stop hook change affects all agent stops. The agent name check ensures only ship-builder and ship-qa are validated. Other agents (brainstormer) are unaffected since they already exit early on the name check.
- **Task 6 — Verifier complexity:** Adding Stage 4 increases the verifier's workload within its 30-turn budget. Mitigation: QA findings are pre-gathered by the verify skill and passed as structured text — the verifier only needs to write them into VERIFY.md, not generate them.
- **Task 7 — Verify skill status change:** Changing the verify skill from `built` to `qa-passed` means users cannot skip QA. This is intentional per CONTEXT.md decisions, but could surprise users who try to verify directly after build. The error message "no features found with status `qa-passed`" makes the required step clear.

## Plan Review

**Status:** APPROVED
**Reviewed against:** agents/ship-builder.md, agents/ship-verifier.md (full), skills/verify/SKILL.md (full), skills/build/SKILL.md, skills/resume/SKILL.md, skills/status/SKILL.md, skills/help/SKILL.md, skills/finish/SKILL.md, ship/workflows/go.md (full), ship/templates/VERIFY.md (full), hooks/subagent-stop.cjs (full), hooks/scan-features.cjs (full), hooks/guide.cjs, hooks/post-compact.cjs, CLAUDE.md, README.md

### Findings

**WARNING — CLAUDE.md status flow not updated:** `CLAUDE.md:54` documents the status flow as `brainstormed → planned → plan-verified → building → built → done`. After this feature, it should include `qa-passed`. Since CLAUDE.md is loaded into every conversation as project instructions, an outdated status flow could cause Claude to make incorrect assumptions about valid statuses. Add a task to update this line.

**WARNING — README.md status flow not updated:** `README.md:88` has the same status flow string. Should be updated for consistency with the actual status machine.

**SUGGESTION — Verify skill description:** After Task 7, the verify skill triggers on `qa-passed` but its frontmatter description still says "Use when a feature build is complete." Consider updating to mention QA for clearer semantic matching.

**SUGGESTION — Task 4 verify command:** The `node -e "require('./hooks/subagent-stop.cjs')"` part may not print "module loaded" because the hook's stdin handler calls `process.exit(0)` on empty input before `console.log` runs. The subsequent grep commands provide the real validation, so this is cosmetic.
