---
feature: "pipeline-rigor"
goal: "Tighten Ship's brainstorm/QA/verify pipeline: adaptive NFR probing, git-diff-based QA review, INCONCLUSIVE verdict with --accept-inconclusive override, new qa-failed status, and consolidated anti-pattern scan ownership"
---

## Exploration Summary

**Similar patterns:**
- AskUserQuestion structure: `agents/ship-brainstormer.md:68-91` (literal multi-question call with options array)
- Auto-discovery via signal files: `agents/ship-qa.md:24-31` (reads package.json/pyproject.toml/Cargo.toml/go.mod/Makefile to pick test framework) — same pattern reused for NFR signal detection
- Fenced JSON result blocks: `build_result` / `qa_result` / `verify_result` validated by `hooks/subagent-stop.cjs:7-96`
- Status-routing tables: `skills/resume/SKILL.md:19-27`, `skills/status/SKILL.md:46-53`, `ship/workflows/go.md:19-27` (status → next-command)
- Fix-task append on QA fail: `skills/qa/SKILL.md:68-90` (current logic — appends XML fix tasks under a "QA fixes" phase)
- Rationalization Table + Forbidden Responses pattern: present in all four agents (brainstormer:17-28, verifier:218-238 etc.)

**Architecture:**
- Source repo layout: `agents/*.md`, `skills/*/SKILL.md`, `hooks/*.cjs`, `ship/templates/*.md`, `ship/workflows/go.md`. The `.claude/` directory is a legacy install snapshot — DO NOT edit (deprecated, plugin system uses source files directly).
- Status enum is implicit (no validation code) — canonical reference is `CLAUDE.md:55`. Skills that route on status: resume, status, finish, qa, plan, plan-verify, build, verify. Workflow: `ship/workflows/go.md`. Hooks that read status: `hooks/scan-features.cjs:44` (filters `done`).
- Subagent-stop hook validates `ship-builder` and `ship-qa` result blocks only; `ship-verifier` is NOT validated by the hook (so adding INCONCLUSIVE to verify_result status enum requires no hook change).
- Plugin path: `.claude-plugin/plugin.json` declares manifest; source files at repo root are what the plugin system installs.

**Conventions:**
- Agent frontmatter: `name`, `model` (opus|sonnet), `description` (Use when…), `tools`, `maxTurns`, optional `memory: project`, optional `skills:` (preloaded). Brainstormer uses opus + 50 turns; QA/verifier use sonnet + 40/30 turns.
- Skill frontmatter: `name: ship:{slug}`, `description: Use when…`, `effort`, `allowed-tools`, optional `argument-hint`.
- Result blocks: fenced ` ```{type} ... ``` ` with JSON inside. Subagent-stop matches against `VALID_STATUSES` arrays.
- Tests: `node --test`, files in `tests/`, spawn hooks via child_process for hook tests, plain assertion-based file-content tests work for prompt-content checks.
- Commit messages for Ship-internal work with a Ship feature scope: `feat(pipeline-rigor): …`. Atomic — one file (or one logical change) per commit; safety-gate hook blocks `git add .`.

## Research Notes

Domain familiar — no additional research needed. The internal audit and external trends survey done earlier in this conversation produced citation-quality findings for every change in this plan. GitHub issue #29849 (confirmation bias in iterative adversarial QC loops) is the empirical basis for the INCONCLUSIVE / git-diff-source-of-truth changes.

## Decisions

- **Edit source repo files only.** `.claude/` is legacy and won't be touched. Plugin system reads from source repo paths (`agents/`, `skills/`, `hooks/`, `ship/templates/`, `ship/workflows/`, `CLAUDE.md`).
- **Subagent-stop hook unchanged.** It validates only ship-builder and ship-qa today; ship-verifier emits its result block but the hook doesn't validate it. Adding INCONCLUSIVE to the verifier's JSON enum needs no hook change. (Future feature could harden this.)
- **NFR signal set is fixed and minimal:** Dockerfile, docker-compose.{yml,yaml}, .github/workflows/*.yml, kubernetes/*.yaml, terraform/*.tf, Procfile, package.json with `scripts.start` or `bin`. Brainstormer uses `Glob` to detect; presence of *any* triggers NFR probing.
- **NFR probe asks 2-3 questions, never more.** Quality > quantity. Questions are conditional on which signals were found (e.g., docker-compose → ask about observability/rollout; pure CLI → skip rollout).
- **`git diff` base is `main` with `master` fallback.** QA runs `git merge-base HEAD main 2>/dev/null || git merge-base HEAD master`. If both fail, QA falls back to PLAN.md `<files>` and notes the degradation in QA.md.
- **Verifier INCONCLUSIVE rule:** A criterion is INCONCLUSIVE iff the planner did not supply a runnable `<verify>` command for it AND the verifier could only gather grep-based evidence. A criterion with a real `<verify>` command is always PASS or FAIL — never INCONCLUSIVE.
- **Overall VERIFY status logic:** PASS = all criteria PASS + Stage 2/3/4 clean. PARTIAL = ≥1 criterion FAIL or Stage 2/3/4 warnings, no INCONCLUSIVE. **INCONCLUSIVE = ≥1 criterion INCONCLUSIVE AND zero FAIL** (FAIL dominates: if anything is FAIL, status is FAIL/PARTIAL regardless of INCONCLUSIVEs).
- **`--accept-inconclusive` requires a non-empty reason.** Format: `/ship:finish --accept-inconclusive "reason text"`. Reason is appended to a new `## Inconclusive Override` section in VERIFY.md with the user identity (`git config user.email`) and ISO timestamp.
- **`qa-failed` routing.** New status; `/ship:resume` and `/ship:status` route to `/ship:build`. `/ship:go` workflow goes `qa-failed → /ship:build → /ship:qa` (skips plan-verify). Original task done-marks are preserved; only the appended "QA fixes" phase has pending tasks.
- **Verifier scan dedup contract.** Verifier reads `QA.md` if present; extracts anti-pattern findings from its Exploratory Analysis section; records them in Stage 2.1 of VERIFY.md WITHOUT re-grepping. If QA.md is missing (e.g., user ran `/ship:verify` directly), verifier falls back to the current grep behaviour for backward compatibility.
- **Test framework: `node --test`**, file-content assertions only (no execution of skills/agents inside tests). Tests assert that prompt files contain the required new behaviour text — same approach as the existing hook tests use for content shape.
- **Dogfood feature is a frozen exemplar.** `.planning/features/test-rigor/CONTEXT.md` exists as a reference spec but is NOT auto-walked through the pipeline by the build. The walk-through is a post-merge human-driven verification step; if it can't be auto-verified, `/ship:verify` will emit INCONCLUSIVE for that criterion — and the user accepts via `--accept-inconclusive "exemplar verified manually"`. Beautifully self-demonstrating.

## Must Deliver

- Brainstormer adaptively probes NFRs based on infra-signal detection.
- QA agent uses `git diff` as source of truth for files reviewed.
- Verifier emits per-criterion verdicts including INCONCLUSIVE; verifier reads QA.md instead of re-scanning.
- New `qa-failed` status with first-class handling in resume/status/finish/go.
- `/ship:finish` blocks INCONCLUSIVE unless `--accept-inconclusive "reason"` is provided.
- VERIFY.md template restructured for per-criterion verdicts + override recording.
- Documentation (CLAUDE.md, /ship:help) reflects new behaviour.
- Synthetic `test-rigor` exemplar fixture committed.
- Regression tests under `tests/pipeline-rigor.test.js` covering all surface changes.

## Acceptance Coverage Map

| Criterion | Implementing Task(s) |
|-----------|---------------------|
| Brainstormer asks ≥2 NFR questions when infra signals present | Task 6 |
| Brainstormer skips NFR questions when no infra signals | Task 6 |
| QA.md cites files from `git diff merge-base..HEAD` | Task 7 |
| Verifier emits INCONCLUSIVE for criteria with no runnable verify | Task 8 |
| `/ship:finish` blocks INCONCLUSIVE unless `--accept-inconclusive` passed | Task 9 (template) + Task 10 (finish skill) |
| QA FAIL → status `qa-failed` (not `plan-verified`); original task marks preserved | Task 2 |
| `/ship:resume` routes `qa-failed` → `/ship:build` (skips plan-verify) | Task 3 |
| `/ship:status` displays `qa-failed` as first-class | Task 4 |
| Verifier reads QA.md (no re-scan) when QA.md exists | Task 8 |
| In-flight features (`qa-step`, `plugin-distribution`) keep old semantics | Task 14 (sanity-grep verification, no code change) |
| Synthetic `test-rigor` exemplar feature exists | Task 13 |
| CLAUDE.md status flow + /ship:help updated | Task 1 + Task 11 |
| Regression tests cover all surface changes | Task 12 |

## Risk Notes

- Task 8 (verifier rewrite) is the largest single edit — ~50-line region replacing Stages 1 and 2 logic. Risk of breaking existing PASS/FAIL behaviour. Mitigation: Task 12 tests assert old PASS/FAIL paths still work alongside new INCONCLUSIVE.
- Task 6 (brainstormer NFR probe) inserts a new phase between existing Phase 2 and 4 — risk of disrupting the conversational flow. Mitigation: explicit "only if signals detected" gate keeps it skippable for simple features.
- Task 10 (finish skill argument parsing) needs to coexist with the existing `$ARGUMENTS` → feature-name parsing. Risk of misparsing if user supplies both `<feature-name> --accept-inconclusive "reason"`. Mitigation: parse flag first, treat remainder as feature name; reason text is quoted.
- The dogfood exemplar (Task 13) is a fixture only — NOT exercised end-to-end during build. The "walked through" acceptance criterion will likely come back INCONCLUSIVE from /ship:verify (since there's no runnable verify command for "feature walked through the pipeline manually"). This is by design — it dogfoods the INCONCLUSIVE-with-override flow.

---

<phase id="1" name="Status plumbing (qa-failed surface)" status="pending">

<task id="1" status="pending">
  <name>Update CLAUDE.md status flow to include qa-failed</name>
  <files>CLAUDE.md</files>
  <reference>CLAUDE.md:55 — current status flow line</reference>
  <action>Replace line 55 with: `Status tracked in CONTEXT.md frontmatter: \`brainstormed\` → \`planned\` → \`plan-verified\` → \`building\` → \`built\` → \`qa-passed\` → \`done\`. If QA fails: `built` → \`qa-failed\` → (rebuild via /ship:build) → \`built\` → /ship:qa retried.` No other CLAUDE.md edits needed in this task.</action>
  <verify>grep -q "qa-failed" CLAUDE.md && grep -q "rebuild via /ship:build" CLAUDE.md</verify>
</task>

<task id="2" status="pending">
  <name>Set qa-failed status on QA FAIL in /ship:qa skill</name>
  <files>skills/qa/SKILL.md</files>
  <reference>skills/qa/SKILL.md:62-92 — current "Handle Result" section</reference>
  <action>In the "Handle Result" section, under `**If status is "FAIL":**`, change step 1 from `Update CONTEXT.md frontmatter to \`status: plan-verified\`` to `Update CONTEXT.md frontmatter to \`status: qa-failed\`. Do NOT clear any existing task done-marks in PLAN.md; only append the new "QA fixes" phase as already specified.` Also update line ~59 in the display block: change `[If result.status is "FAIL":] QA found critical/high bugs. Fix tasks added to PLAN.md. Next: /ship:build` to keep that text (it's already correct) and confirm the `Next: /ship:build` guidance points to the new qa-failed flow.</action>
  <verify>grep -q "status: qa-failed" skills/qa/SKILL.md && ! grep -q "status: plan-verified" skills/qa/SKILL.md</verify>
</task>

<task id="3" status="pending">
  <name>Add qa-failed routing to /ship:resume skill</name>
  <files>skills/resume/SKILL.md</files>
  <reference>skills/resume/SKILL.md:19-27 — current Status → Action table</reference>
  <action>In the status-routing table, add a new row between `qa-passed` and `done`: `| \`qa-failed\` | Run \`/ship:build\` (QA found bugs; fix tasks were appended to PLAN.md; skips plan-verify) |`. Do not change other rows.</action>
  <verify>grep -q "qa-failed" skills/resume/SKILL.md && grep -q "skips plan-verify" skills/resume/SKILL.md</verify>
</task>

<task id="4" status="pending">
  <name>Add qa-failed display + next-step to /ship:status skill</name>
  <files>skills/status/SKILL.md</files>
  <reference>skills/status/SKILL.md:46-53 — current "Next step" list</reference>
  <action>In the "Next step" bullet list, add a new bullet between `qa-passed` and `done`: `- \`qa-failed\` → "Next: \`/ship:build\` to fix bugs found by QA (fix tasks appended to PLAN.md)"`. No other status/SKILL.md changes.</action>
  <verify>grep -q "qa-failed" skills/status/SKILL.md && grep -q "fix bugs found by QA" skills/status/SKILL.md</verify>
</task>

<task id="5" status="pending">
  <name>Update /ship:go workflow to handle qa-failed</name>
  <files>ship/workflows/go.md</files>
  <reference>ship/workflows/go.md:19-27 (status table), 37-39 (QA handling block)</reference>
  <action>Two edits in this file:
  1. In the Status → Next Step table (lines 19-27), add a new row between `qa-passed` and `done`: `| \`qa-failed\` | Resume build (invoke /ship:build skill), then re-run /ship:qa |`.
  2. In the "QA handling" block (line 38-39), change `If FAIL (status reset to \`plan-verified\`, fix tasks appended)` to `If FAIL (status set to \`qa-failed\`, fix tasks appended)`. Update the next-action sentence to: `the user should review the fix tasks and run \`/ship:build\` to implement them; QA will run again automatically when /ship:go resumes.`</action>
  <verify>grep -q "qa-failed" ship/workflows/go.md && ! grep -q "status reset to .plan-verified." ship/workflows/go.md</verify>
</task>

</phase>

<phase id="2" name="Agent behaviour upgrades" status="pending">

<task id="6" status="pending">
  <name>Add adaptive NFR probe to ship-brainstormer agent</name>
  <files>agents/ship-brainstormer.md</files>
  <reference>agents/ship-brainstormer.md:38-58 — Phase 1 (Read the Codebase) + Phase 2 (Understand the Problem). Signal-detection pattern modelled on agents/ship-qa.md:24-31 (test framework auto-discovery).</reference>
  <action>Two insertions:

  1. Extend Phase 1 (after line 44, before Phase 2). Add a new sub-step "Detect Infrastructure Signals":
  ```
  Use Glob to detect whether this project ships to production/runtime infrastructure. Look for ANY of:
  - `Dockerfile` or `docker-compose.{yml,yaml}` (containerised service)
  - `.github/workflows/*.{yml,yaml}` (CI/CD pipeline)
  - `kubernetes/*.{yml,yaml}` or `k8s/*.{yml,yaml}` (K8s deployment)
  - `terraform/*.tf` or `*.tfvars` (IaC)
  - `Procfile` (Heroku-style)
  - `package.json` with `scripts.start` or a `bin` field (Node service/CLI)

  Record which signals were found. If at least one is present → set `INFRA_DETECTED = true`. Otherwise → `INFRA_DETECTED = false`. This flag controls whether to run the NFR probe in Phase 2.
  ```

  2. In Phase 2 (after the existing scope/edge questions, before Phase 3), add a new sub-section "NFR Probing (conditional)":
  ```
  If `INFRA_DETECTED = false`: skip this entire sub-section. Pure libraries and exploratory scripts don't need rollout/observability probing.

  If `INFRA_DETECTED = true`: ask 2-3 questions covering the NFR dimensions most relevant to the signals you detected. Pick from this menu — do NOT ask all five:

  - **Performance / scale:** Expected request volume? Latency budget? Throughput limits?
  - **Observability / telemetry:** What needs to be logged, traced, or alerted on?
  - **Rollout / migration / feature flag:** Phased rollout? Data migration? Kill switch?
  - **Security / data:** Auth needed? PII handled? Compliance constraints?
  - **Error handling / resilience:** What happens on dependency failure? Retry strategy? Idempotency?

  Routing hints:
  - If a `Dockerfile` or `kubernetes/` was found → prioritise rollout + observability.
  - If `.github/workflows/` was found → prioritise security (secrets, supply chain).
  - If `package.json` with `bin` only (CLI tool) → prioritise error handling; SKIP rollout/observability.
  - If `terraform/` was found → prioritise rollout + security.

  Use `AskUserQuestion` with the same structure as your other questions (2-4 options per question). Capture answers in CONTEXT.md's `## Decisions` section as `**NFR — {dimension}:** [decision]: [rationale]`.
  ```

  3. Add ONE new row to the Rationalization Table (around line 28):
  ```
  | "This is just a library / CLI, NFRs don't apply" | Only true when NO infra signals exist. If `Dockerfile` / `workflows` / `kubernetes` are present, NFRs apply — even a "simple" feature can break observability or rollout. The detection step decides; don't pre-empt it. |
  ```
  </action>
  <verify>grep -q "NFR Probing" agents/ship-brainstormer.md && grep -q "INFRA_DETECTED" agents/ship-brainstormer.md && grep -q "Dockerfile" agents/ship-brainstormer.md</verify>
</task>

<task id="7" status="pending">
  <name>Make ship-qa agent use git diff as source of truth + own scan</name>
  <files>agents/ship-qa.md</files>
  <reference>agents/ship-qa.md:90-97 — current Step 6 (Exploratory Analysis) reads `PLAN.md's <files> elements`. Pattern for git command execution: existing `git status` / `git commit` usage elsewhere in the file.</reference>
  <action>Three edits:

  1. Insert a new step BEFORE current Step 6, numbered "Step 5.5 — Discover Changed Files". Content:
  ```
  Before reviewing code, determine which files actually changed in this feature's commits. Run:

  ```bash
  # Find merge base with main (fall back to master, then HEAD~ as last resort)
  BASE=$(git merge-base HEAD main 2>/dev/null \
       || git merge-base HEAD master 2>/dev/null \
       || git rev-parse HEAD~1)
  git diff --name-only "$BASE"..HEAD
  ```

  Record the file list. This is the authoritative set of files to review — not `PLAN.md`'s `<files>` (which can be stale if the builder deviated from the plan).

  If the git command fails entirely (no main/master, shallow clone, etc.), fall back to `PLAN.md`'s `<files>` and add a note in QA.md's Exploratory Analysis section: "Fell back to PLAN.md file list — git diff unavailable."
  ```

  2. Rewrite Step 6 (Exploratory Analysis). Replace lines 90-97 with:
  ```
  ## Step 6 — Exploratory Analysis

  Using the file list from Step 5.5 (or fallback), do a code-review pass:
  - Read each changed file
  - Look for: unhandled error paths, hardcoded values, missing input validation, potential null/undefined access, resource leaks, TODOs/FIXMEs/HACK/XXX/placeholder/stub/not-implemented markers, empty function bodies
  - Note findings with file:line references

  These findings are this feature's ONLY anti-pattern scan. The verifier will read your QA.md instead of running its own grep — do not be lazy here.

  Findings go into QA.md's Exploratory Analysis section. QA.md must also include a "Reviewed files (from git diff)" subsection listing every file you reviewed, so the verifier can see what was covered.
  ```

  3. Add ONE new row to the Rationalization Table (around line 124):
  ```
  | "I'll just trust PLAN.md's file list" | The builder may have deviated. Run `git diff` first. Stale plan ≠ ground truth. |
  ```
  </action>
  <verify>grep -q "merge-base HEAD main" agents/ship-qa.md && grep -q "Reviewed files (from git diff)" agents/ship-qa.md && grep -q "fall back to" agents/ship-qa.md</verify>
</task>

<task id="8" status="pending">
  <name>Add INCONCLUSIVE verdict + read-QA.md to ship-verifier agent</name>
  <files>agents/ship-verifier.md</files>
  <reference>agents/ship-verifier.md:120-141 (Step 1.3 + Stage 2.1), 196-216 (Determine Overall Status + Step 6), 240-269 (verify_result JSON schema), 218-238 (Forbidden Responses + Rationalization Table)</reference>
  <action>Five edits:

  1. **Rewrite Step 1.3 (line 123-125)** to support INCONCLUSIVE:
  ```
  #### Step 1.3 — Spec Compliance Verdict

  For each acceptance criterion, record one of three verdicts:
  - **PASS** — A runnable `<verify>` command was found and executed successfully; output proves the criterion is met.
  - **FAIL** — A runnable `<verify>` command was found and executed; output shows the criterion is NOT met.
  - **INCONCLUSIVE** — No runnable `<verify>` command exists for this criterion (or the only available evidence is `grep`-based file-existence). The verifier CANNOT upgrade grep-only evidence to PASS. Mark INCONCLUSIVE and continue — the user resolves this via `/ship:finish --accept-inconclusive "reason"` if they accept the gap.

  If ANY criterion is FAIL, skip Stage 2 (existing behaviour). INCONCLUSIVE alone does NOT skip Stage 2 — only FAIL does.
  ```

  2. **Replace Step 2.1 anti-pattern scan (line 131-141)** with QA.md read:
  ```
  #### Step 2.1 — Anti-Pattern Scan (from QA)

  Check whether `.planning/features/{name}/QA.md` exists for this feature.

  - **If QA.md exists:** Read its "Exploratory Analysis" section. Extract every anti-pattern finding (TODO/FIXME/HACK/XXX/placeholder/stub/not-implemented, empty function bodies, hardcoded values, etc.) and record them in Stage 2 of VERIFY.md verbatim. DO NOT re-grep. QA is the authoritative scanner for this feature.
  - **If QA.md does NOT exist** (e.g., /ship:verify was invoked directly without /ship:qa): fall back to the legacy grep behaviour — search the feature's changed files for `TODO, FIXME, HACK, XXX, placeholder, stub, not implemented`, empty function bodies, hardcoded values, and broken imports. Record findings in Stage 2. Note in Stage 2: "QA.md absent — verifier performed fallback grep scan."
  ```

  3. **Rewrite "Determine Overall Status" (line 196-200)** to add INCONCLUSIVE:
  ```
  ### Determine Overall Status

  Apply in this priority order (first match wins):
  - **FAIL:** Any criterion FAIL, OR CRITICAL /review findings, OR critical QA bugs. (FAIL dominates.)
  - **PARTIAL:** No criterion FAIL but WARNING /review findings exist, OR high QA bugs exist, OR a mix where Stage 1 has FAILs but some other criteria pass.
  - **INCONCLUSIVE:** No FAIL anywhere, BUT at least one criterion is INCONCLUSIVE. (Honest signal that not everything was verified.)
  - **PASS:** All criteria PASS, no INCONCLUSIVE, no CRITICAL/WARNING findings, no critical/high QA bugs.
  ```

  4. **Update Step 6 (line 212-216)** to handle INCONCLUSIVE status. ONLY add the INCONCLUSIVE case; leave PARTIAL/FAIL behaviour unchanged (out of CONTEXT.md scope):
  ```
  ### Step 6 — Update Status

  Update CONTEXT.md frontmatter:
  - If PASS: set `status: done`
  - If INCONCLUSIVE: set `status: done` (the override gate is in /ship:finish — verifier's job ends here; the INCONCLUSIVE state is recorded in VERIFY.md)
  - If PARTIAL/FAIL: set `status: plan-verified` (existing behaviour, unchanged), and append Fix Tasks to PLAN.md for all CRITICAL and WARNING findings.
  ```

  5. **Update verify_result JSON schema (line 240-268)** to add INCONCLUSIVE and per-criterion verdicts:
  ```
  ```verify_result
  {
    "feature": "{name}",
    "status": "PASS" | "PARTIAL" | "FAIL" | "INCONCLUSIVE",
    "criteria_passed": {number},
    "criteria_failed": {number},
    "criteria_inconclusive": {number},
    "criteria_total": {number},
    "criteria_verdicts": [
      {"criterion": "{text}", "verdict": "PASS" | "FAIL" | "INCONCLUSIVE", "evidence": "{command or grep output}"}
    ],
    "anti_patterns": {number},
    "review_findings": {"critical": {n}, "warnings": {n}, "suggestions": {n}},
    "qa_findings": {"critical": {n}, "high": {n}, "medium": {n}, "low": {n}, "tests_written": {n}},
    "human_checks": {number},
    "gaps": ["{description}", ...] | [],
    "pr_findings": [{"severity": "CRITICAL"|"WARNING", "description": "{text}"}, ...] | []
  }
  ```
  ```

  6. **Add to Forbidden Responses** (after line 225):
  ```
  - "I'll mark this PASS because the file exists" — file existence is not behaviour. If no runnable <verify> exists, the verdict is INCONCLUSIVE.
  - "I'll re-grep for TODOs to be safe" — when QA.md is present, you read it. Don't duplicate work.
  ```

  7. **Add to Rationalization Table** (after line 238):
  ```
  | "No <verify> command, but the code looks right — I'll PASS this" | Grep-finding an import is not proof the feature works. Mark INCONCLUSIVE; the operator can accept via --accept-inconclusive if they verified manually. |
  | "QA.md exists but I'll grep anyway, just in case" | Duplicate work means contradictory verdicts. QA owns the anti-pattern scan; you incorporate its findings. |
  ```
  </action>
  <verify>grep -q "INCONCLUSIVE" agents/ship-verifier.md && grep -q "QA.md exists" agents/ship-verifier.md && grep -q "criteria_verdicts" agents/ship-verifier.md && grep -q "criteria_inconclusive" agents/ship-verifier.md</verify>
</task>

</phase>

<phase id="3" name="Template + skill UX (override flow)" status="pending">

<task id="9" status="pending">
  <name>Update VERIFY.md template for per-criterion verdicts and override section</name>
  <files>ship/templates/VERIFY.md</files>
  <reference>ship/templates/VERIFY.md:1-105 (entire template — touches frontmatter, Stage 1 table, end-of-file structure)</reference>
  <action>Three edits to the template:

  1. **Frontmatter status enum** (line ~3): change `status: PASS | PARTIAL | FAIL` to `status: PASS | PARTIAL | FAIL | INCONCLUSIVE`.

  2. **Stage 1 table header** (around line 9-11): change from `| Criterion | Status | Evidence |` to `| Criterion | Verdict | Evidence |`. Add a one-line note above the table: `Per-criterion verdict ∈ {PASS, FAIL, INCONCLUSIVE}. INCONCLUSIVE means no runnable verify command was available.`

  3. **Append a new section** at the end of the template (after the Recommendation block):
  ```
  ## Inconclusive Override

  <!-- This section is populated by /ship:finish --accept-inconclusive "reason".
       It is empty if no override was applied. -->

  - **Override applied:** {yes | no}
  - **Reason:** {operator-supplied reason if applied, otherwise N/A}
  - **Operator:** {git config user.email at time of override}
  - **Timestamp:** {ISO 8601 timestamp}
  ```
  </action>
  <verify>grep -q "INCONCLUSIVE" ship/templates/VERIFY.md && grep -q "Inconclusive Override" ship/templates/VERIFY.md && grep -q "| Verdict |" ship/templates/VERIFY.md</verify>
</task>

<task id="10" status="pending">
  <name>Add --accept-inconclusive flag handling to /ship:finish skill</name>
  <files>skills/finish/SKILL.md</files>
  <reference>skills/finish/SKILL.md:1-7 (frontmatter), 9-19 (Find Active Feature), 20-29 (Prerequisites). Argument parsing pattern: existing `$ARGUMENTS` handling at line 15.</reference>
  <action>Four edits:

  1. **Update frontmatter argument-hint** (line 6): change from `argument-hint: "[feature-name]"` to `argument-hint: "[feature-name] [--accept-inconclusive \"reason\"]"`.

  2. **Add new section "Parse Arguments"** immediately after the frontmatter (before "Find Active Feature"):
  ```
  ## Parse Arguments

  Parse `$ARGUMENTS` (a single string) into two components:
  - `--accept-inconclusive "reason"` — if this flag appears anywhere in the string, set `ACCEPT_INCONCLUSIVE = true` and extract the quoted reason text (everything between the matching `"`s after the flag).
  - Remaining tokens (after removing the flag + reason) — treat as feature name.

  If `--accept-inconclusive` appears WITHOUT a quoted reason, abort and tell the user: `--accept-inconclusive requires a non-empty reason in quotes. Example: /ship:finish my-feature --accept-inconclusive "manually verified end-to-end on staging"`.

  If `ACCEPT_INCONCLUSIVE = false`, behave as before.
  ```

  3. **Add new section "Check INCONCLUSIVE Verdicts"** immediately AFTER "Find Active Feature" and BEFORE "Prerequisites":
  ```
  ## Check INCONCLUSIVE Verdicts

  Read `.planning/features/{name}/VERIFY.md`. Search for any of:
  - `status: INCONCLUSIVE` in the frontmatter, OR
  - Any row in the Stage 1 table with verdict `INCONCLUSIVE`.

  If found:
  - **If `ACCEPT_INCONCLUSIVE = false`:** Display:
    ```
    Cannot finish — VERIFY.md contains INCONCLUSIVE verdicts:
    {list each INCONCLUSIVE criterion}

    Options:
    1. Add runnable <verify> commands to PLAN.md for the inconclusive criteria, then re-run /ship:verify.
    2. Override with: /ship:finish {name} --accept-inconclusive "reason for manual acceptance"
    ```
    Stop. Do not proceed to Prerequisites.
  - **If `ACCEPT_INCONCLUSIVE = true`:** Append the override record to VERIFY.md's `## Inconclusive Override` section:
    - Set `Override applied: yes`
    - Set `Reason: {the reason text}`
    - Set `Operator: $(git config user.email || echo unknown)`
    - Set `Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)`
    Then continue to Prerequisites.

  If VERIFY.md has no INCONCLUSIVE markers, proceed directly to Prerequisites.
  ```

  4. No other edits needed to finish/SKILL.md — the existing Prerequisites → Present Options → Execute Choice → Archive flow already handles `status: done` correctly. INCONCLUSIVE features are already at `status: done` per Task 8's Step 6 update (verifier now sets `done` even for INCONCLUSIVE).
  </action>
  <verify>grep -q "ACCEPT_INCONCLUSIVE" skills/finish/SKILL.md && grep -q -- "--accept-inconclusive" skills/finish/SKILL.md && grep -q "git config user.email" skills/finish/SKILL.md</verify>
</task>

<task id="11" status="pending">
  <name>Document INCONCLUSIVE + override + qa-failed in /ship:help</name>
  <files>skills/help/SKILL.md</files>
  <reference>skills/help/SKILL.md:1-40 — current command-reference body. Format pattern: section headed by `Commands:` with one-line-per-command descriptions, then a `Flow:` block.</reference>
  <action>Three small edits in the help reference text:

  1. In the `Commands:` block, after the `/ship:verify` line, add: `                       Per-criterion verdicts: PASS / FAIL / INCONCLUSIVE (no runnable verify command).` Indentation matches existing wrapped lines.

  2. In the `Commands:` block, after the `/ship:finish` line, add: `                       Use --accept-inconclusive "reason" to override INCONCLUSIVE verdicts.`

  3. Replace the `Flow:` line block with:
  ```
  Flow:
    start → [design →] plan → plan-verify → build → qa → verify → finish
            (or just: start → go → finish)

    On QA FAIL: status → qa-failed; resume runs build → qa-retry (skips plan-verify).
    On INCONCLUSIVE: /ship:finish requires --accept-inconclusive "reason" to proceed.
  ```
  </action>
  <verify>grep -q "INCONCLUSIVE" skills/help/SKILL.md && grep -q -- "--accept-inconclusive" skills/help/SKILL.md && grep -q "qa-failed" skills/help/SKILL.md</verify>
</task>

</phase>

<phase id="4" name="Dogfood fixture + regression tests" status="pending">

<task id="12" status="pending">
  <name>Create regression tests for all pipeline-rigor surface changes</name>
  <files>tests/pipeline-rigor.test.js</files>
  <reference>tests/subagent-stop.test.js — structure for node:test + node:assert/strict; file-content assertion style used throughout the existing Ship tests.</reference>
  <action>Create a new test file at `tests/pipeline-rigor.test.js`. Use only Node built-ins: `node:test`, `node:assert/strict`, `node:fs`, `node:path`. The file should contain one `describe` block "pipeline-rigor surface" with the following `it()` cases (each reads the relevant source file via `fs.readFileSync` and asserts text presence using `assert.match` or `assert.ok` with `includes`):

  - `CLAUDE.md documents qa-failed status transition` — asserts CLAUDE.md contains both `qa-failed` and `rebuild via /ship:build`.
  - `skills/qa/SKILL.md sets status to qa-failed on FAIL` — asserts file contains `status: qa-failed` and does NOT contain a literal `status: plan-verified` line (sanity check).
  - `skills/resume/SKILL.md routes qa-failed to /ship:build` — asserts presence of a table row with `qa-failed` and `/ship:build`.
  - `skills/status/SKILL.md displays qa-failed first-class` — asserts the bullet `\`qa-failed\` →` exists with `/ship:build`.
  - `ship/workflows/go.md handles qa-failed` — asserts presence of `qa-failed` table row and the updated QA-handling block phrase `status set to \`qa-failed\``.
  - `agents/ship-brainstormer.md has NFR probe with infra signal detection` — asserts presence of `INFRA_DETECTED`, `Dockerfile`, `kubernetes`, `NFR Probing`, `package.json with`, AND the new rationalization-table row containing `"This is just a library / CLI, NFRs don't apply"`.
  - `agents/ship-qa.md uses git merge-base for diff` — asserts presence of `git merge-base HEAD main`, `fall back to`, `Reviewed files (from git diff)`.
  - `agents/ship-verifier.md has INCONCLUSIVE verdict logic` — asserts presence of `INCONCLUSIVE`, `criteria_verdicts`, `criteria_inconclusive`, `QA.md exists`, the new Forbidden Response phrase, and the new rationalization-table row about `--accept-inconclusive`.
  - `ship/templates/VERIFY.md supports INCONCLUSIVE + override section` — asserts presence of `INCONCLUSIVE` in frontmatter enum, the `| Verdict |` header, and the `## Inconclusive Override` section.
  - `skills/finish/SKILL.md parses --accept-inconclusive` — asserts presence of `ACCEPT_INCONCLUSIVE`, `--accept-inconclusive`, `git config user.email`, and the error message about needing a quoted reason.
  - `skills/help/SKILL.md documents new behaviour` — asserts presence of `INCONCLUSIVE`, `--accept-inconclusive`, and `qa-failed`.

  Each test should compute the file path relative to `__dirname/..` (the repo root) for portability. No mocks; pure file-content reads.
  </action>
  <verify>node --test tests/pipeline-rigor.test.js</verify>
</task>

<task id="13" status="pending">
  <name>Create test-rigor exemplar fixture</name>
  <files>.planning/features/test-rigor/CONTEXT.md, .planning/features/test-rigor/README.md</files>
  <reference>.planning/features/qa-step/CONTEXT.md (structure of a real Ship CONTEXT.md). For deliberate INCONCLUSIVE: include criteria with no runnable verify (a manual UX check).</reference>
  <action>Create two files:

  **`.planning/features/test-rigor/CONTEXT.md`**:
  ```
  ---
  feature: "test-rigor"
  status: brainstormed
  created: "2026-05-25"
  exemplar: true
  ---

  ## Problem

  EXEMPLAR — DO NOT BUILD. This is a frozen reference feature created by pipeline-rigor to demonstrate the upgraded pipeline (adaptive NFR probe, git-diff QA, INCONCLUSIVE verdict, qa-failed status, --accept-inconclusive override). It exists so future operators can read a complete CONTEXT.md that exercises every new behaviour.

  ## Solution

  Add a hypothetical `/ship:doctor` skill that prints a one-screen health summary of the Ship installation (plugin version, hook registration, feature counts, last-run timestamps). Pure read-only. Useful for diagnostics when Ship feels broken.

  ## Decisions

  - **NFR — observability:** /ship:doctor itself is the observability tooling; no telemetry of its own runs needed. Why: it's a CLI diagnostic. (Adaptive NFR probe should detect this is a CLI tool and ASK about error handling, SKIP rollout/observability questions.)
  - **NFR — error handling:** Doctor must never throw; degrade gracefully if individual checks fail. Why: a diagnostic that breaks when there's a problem is worse than no diagnostic.
  - **Scope cut:** No remediation actions, only reporting.

  ## Acceptance Criteria

  - [ ] `/ship:doctor` skill file exists at `skills/doctor/SKILL.md` with valid frontmatter.
  - [ ] Skill body documents at least 4 checks (plugin version, hook count, feature count, plugin-data writable).
  - [ ] Skill is auto-discoverable from a Claude Code session (visible via standard plugin loading).
  - [ ] Output is human-readable and fits in ~25 lines.

  ## Scope

  **In scope:**
  - Skill file definition with frontmatter and body.
  - Documented checks (no implementation; this is a doc-only exemplar).

  **Out of scope:**
  - Any actual code that runs checks.
  - Remediation logic.
  - Integration with the Ship plugin manifest (this feature is never built).

  ## Research Notes

  No research — exemplar fixture.

  ## Why this exemplar exists

  - **NFR probe demo:** The "NFR — error handling" decision shows adaptive NFR probing in action. A CLI-only feature SKIPS rollout/observability but PROBES error handling.
  - **INCONCLUSIVE demo:** Acceptance criterion "Skill is auto-discoverable from a Claude Code session" has no runnable verify command (it requires a live Claude Code session). A verifier following pipeline-rigor will mark this INCONCLUSIVE, demonstrating the new verdict path.
  - **--accept-inconclusive demo:** To finish this feature (hypothetically), an operator runs `/ship:finish test-rigor --accept-inconclusive "verified manually in a Claude Code session"`. That records the override in VERIFY.md.

  This feature is NEVER built or finished. It is read-only documentation.
  ```

  **`.planning/features/test-rigor/README.md`**:
  ```
  # test-rigor (exemplar — DO NOT BUILD)

  This feature directory is a frozen exemplar created by the pipeline-rigor feature. It exists to show, in one place, what a CONTEXT.md looks like when the new pipeline behaviours are exercised:

  - Adaptive NFR probing (CLI-flavoured: skip rollout/observability, probe error handling).
  - INCONCLUSIVE verdict on criteria that lack runnable verify commands.
  - --accept-inconclusive operator override.
  - The qa-failed status (referenced but not exercised here).

  **Do not run `/ship:plan`, `/ship:build`, or any other Ship command on this feature.** Skills that scan `.planning/features/*` should treat the `exemplar: true` frontmatter field as a marker to skip — though enforcing that skip is OUT OF SCOPE for pipeline-rigor and may be a follow-up feature.

  If you accidentally start a build, abort and revert.
  ```
  </action>
  <verify>test -f .planning/features/test-rigor/CONTEXT.md && test -f .planning/features/test-rigor/README.md && grep -q "exemplar: true" .planning/features/test-rigor/CONTEXT.md && grep -q "DO NOT BUILD" .planning/features/test-rigor/README.md</verify>
</task>

<task id="14" status="pending" depends="1,2,3,4,5,6,7,8,9,10,11">
  <name>Final integration grep — confirm qa-failed routings are consistent and no stale plan-verified rollback references remain</name>
  <files>(no file edits — verification only; if drift detected, fix on the spot in the relevant file)</files>
  <reference>All status-routing files modified in phase 1 + the verifier agent from task 8.</reference>
  <action>Run these cross-cutting consistency checks and fix any drift found:

  1. Confirm `qa-failed` is referenced in every status-routing surface:
     ```
     for f in CLAUDE.md skills/qa/SKILL.md skills/resume/SKILL.md skills/status/SKILL.md ship/workflows/go.md skills/help/SKILL.md; do
       grep -l "qa-failed" "$f" >/dev/null || echo "MISSING qa-failed in: $f"
     done
     ```
     Output should be empty. If any file shows MISSING, edit that file to add the appropriate reference (consistent with phase 1 tasks).

  2. Confirm no skill still rolls back QA FAIL to `plan-verified`:
     ```
     grep -n "plan-verified" skills/qa/SKILL.md
     ```
     Output should be empty (the qa skill no longer sets plan-verified). If a line remains, remove it.

  3. Confirm verifier writes INCONCLUSIVE only when justified (presence check, not behaviour check — covered by task 12 tests):
     ```
     grep -c "INCONCLUSIVE" agents/ship-verifier.md
     ```
     Should be ≥ 6 (Step 1.3 definition, status priority block, Step 6, JSON schema, Forbidden Responses, Rationalization Table).

  4. Confirm `.claude/` directory was NOT touched in this build (legacy, deprecated):
     ```
     git status --short .claude/ 2>/dev/null
     ```
     Output should be empty.

  5. Run the full regression test from task 12 ONE MORE TIME to confirm no late-phase drift:
     ```
     node --test tests/pipeline-rigor.test.js
     ```
     Must exit 0.

  This task is a fence — it does NOT modify files unless drift is found. If drift exists, fix it before marking this task done.
  </action>
  <verify>node --test tests/pipeline-rigor.test.js && [ -z "$(grep -L 'qa-failed' CLAUDE.md skills/qa/SKILL.md skills/resume/SKILL.md skills/status/SKILL.md ship/workflows/go.md skills/help/SKILL.md)" ] && [ -z "$(git status --short .claude/ 2>/dev/null)" ]</verify>
</task>

</phase>

## Plan Review

**Status:** APPROVED
**Reviewed against:** CLAUDE.md, agents/{ship-brainstormer,ship-qa,ship-verifier}.md, skills/{qa,resume,status,finish,help}/SKILL.md, ship/workflows/go.md, ship/templates/VERIFY.md, hooks/{scan-features.cjs,subagent-stop.cjs} surface, tests/subagent-stop.test.js (as reference for test structure), .planning/features/ layout, node v25 availability and `git merge-base` reachability.

### Findings

**Warnings:**

1. **Task 8 scope-creep fixed in-review.** Original action expanded verifier PARTIAL/FAIL rollback to set `qa-failed` when QA.md existed; this was out of CONTEXT.md scope. Reviewer edited the task 8 action to leave PARTIAL/FAIL → `plan-verified` unchanged; ONLY the new INCONCLUSIVE case is added in Step 6. The edit is committed to PLAN.md before build.

2. **test-rigor fixture surface noise.** Task 13 creates `.planning/features/test-rigor/` at `status: brainstormed`. This will appear in `/ship:status` and `/ship:resume` permanently. The README and `exemplar: true` frontmatter field document the intent, but nothing enforces a skip — future feature could update `hooks/scan-features.cjs` to filter exemplar features. Out of scope here; trade-off explicitly accepted in CONTEXT.md.

3. **INCONCLUSIVE invisible to /ship:status and /ship:resume.** Verifier sets `status: done` for INCONCLUSIVE features (per Task 8 Step 6). /ship:status will show them as `done`; only `/ship:finish` enforces the override gate (via VERIFY.md content inspection). Consistent with the existing done-routing flow, but a future feature could add INCONCLUSIVE awareness to /ship:status and /ship:resume surfaces.

**Suggestions:**

4. **Task 7 Step 5.5 placement.** `git diff` runs AFTER QA commits its own test files (Step 5), so QA reviews its own tests alongside feature code. Functionally fine and arguably useful (catches test-file anti-patterns), but consider running diff before committing tests for a cleaner feature-only view. Builder may adjust placement if convenient.

5. **Task 13 `exemplar: true` field is documentation-only.** Nothing reads it today. Future feature could update `hooks/scan-features.cjs:44` to filter exemplars alongside `done`. Acknowledged out-of-scope.

6. **Task 14 grep portability.** `grep -L` works on macOS/Linux BSD grep and GNU grep alike, but the long form `grep --files-without-match` is more portable to obscure POSIX environments. Optional refinement at build time.

**No CRITICAL findings.** Plan is structurally sound and ready to build.

