---
name: deviation-rules
description: Use when plan diverges from reality during build execution — provides 3 escalation levels for handling failures
effort: medium
user-invocable: false
---

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

**Action:** Debug systematically, then fix and re-verify. Maximum **3 attempts**. Track each attempt.

**Debugging protocol (before each fix attempt):**
1. **Read the error** — full output, stack trace, exit code. The error message often contains the answer.
2. **Trace the cause** — where does the bad value originate? Follow it backward, not forward.
3. **One fix at a time** — change one thing, re-verify. Never batch multiple fixes.

If verify still fails after the third attempt, escalate to Rule 3.

**If each fix reveals a new problem in a different place:** This is not a single bug — it's an architectural mismatch. Skip directly to Rule 3.

**Do not:** Skip the verify step. Do not proceed to the next task with a broken current task. Do not guess — read the error first.

---

## Rule 3 — Stop and Report

**Trigger:** An architectural conflict, persistent verification failure (3 attempts exhausted), or any issue that requires fundamentally rethinking the approach.

**Action:**
1. Stop execution immediately
2. Leave the feature status as `building` in CONTEXT.md
3. Output `## CHECKPOINT REACHED` with a clear explanation and recommendation

**Signals:**
- Plan assumes REST API but codebase uses GraphQL — replanning needed, not improvisation
- Each fix attempt reveals a new problem in a different place — architectural mismatch
- Fix requires "massive refactoring" to implement — wrong approach, not wrong code
