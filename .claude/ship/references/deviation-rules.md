# Deviation Rules

During build execution, follow these rules when the plan does not match reality.

---

## Rule 1 — Fix and Continue

**Trigger:** A file path, function name, minor implementation detail, or missing dependency in the plan is wrong or outdated.

**Action:** Make the correct change (fix the path, install the dependency, adjust the detail). Continue executing the next task.

**Examples:**
- Plan says `src/auth/login.ts` but the file is `src/auth/auth.ts` — fix it, move on.
- Plan calls `import bcrypt` but bcrypt isn't installed — install it, move on.

---

## Rule 2 — Fix with Limits

**Trigger:** The `<verify>` command for a task fails after implementation.

**Action:** Debug and fix the issue, then re-run the verify command. Maximum **3 attempts**. Track each attempt. If verify still fails after the third attempt, escalate to Rule 3.

**Do not:** Skip the verify step. Do not proceed to the next task with a broken current task.

---

## Rule 3 — Stop and Report

**Trigger:** An architectural conflict, persistent verification failure (3 attempts exhausted), or any issue that requires fundamentally rethinking the approach.

**Action:**
1. Stop execution immediately
2. Leave the feature status as `building` in CONTEXT.md
3. Output `## CHECKPOINT REACHED` with a clear explanation and recommendation

**Example:** Plan assumes REST API but codebase uses GraphQL. This requires replanning, not improvisation.
