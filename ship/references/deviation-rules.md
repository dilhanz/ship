# Deviation Rules

During execution, the executor must follow these rules when the plan does not match reality.

---

## Rule 1 — Small Scope Change: Fix and Continue

**Trigger:** A file path, function name, or minor implementation detail in the plan is wrong or outdated.

**Action:** Make the correct change. Note the deviation in SUMMARY.md under `## Deviations`. Continue executing the next task.

**Example:** Plan says `src/auth/login.ts` but the file is `src/auth/auth.ts`. Fix it, note it, move on.

---

## Rule 2 — Missing Dependency: Install and Continue

**Trigger:** A required package or tool is not installed.

**Action:** Install it using the project's package manager. Note it in SUMMARY.md. Continue.

**Example:** Plan calls `import bcrypt from 'bcrypt'` but bcrypt is not in package.json. Run `npm install bcrypt`, note it, continue.

---

## Rule 3 — Task Fails Verification: Fix Before Proceeding

**Trigger:** The `<verify>` command for a task fails after implementation.

**Action:** Debug and fix the issue. Do not mark the task complete until the verify command passes. If the fix requires changing implementation details, note the change in SUMMARY.md.

**Do not:** Skip the verify step. Do not proceed to the next task with a broken current task.

---

## Rule 4 — Architecture Conflict: Stop and Report

**Trigger:** The plan requires a fundamental architectural change that would affect multiple phases (e.g., switching databases, changing authentication strategy, restructuring the entire data model).

**Action:**
1. Stop execution immediately. Do not implement the conflicting change.
2. Write what you have completed to SUMMARY.md.
3. Update STATE.md with the conflict description.
4. Return `## CHECKPOINT REACHED` with a clear explanation of the conflict and a recommendation.

**Example:** Plan assumes REST API but codebase has already been built on GraphQL. This requires replanning, not improvisation.
