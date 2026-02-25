# Workflow: verify-phase

This workflow guides Claude through verifying a completed phase. It is invoked by the `/ship:verify-phase [N]` command.

---

## Purpose

Confirm that Phase N's execution actually delivered the roadmap's success criteria — not just that code was written, but that the goals are met.

## Prerequisites

- `.planning/NN-PLAN.md` must exist
- `.planning/NN-SUMMARY.md` must exist (executor must have run)
- `.planning/ROADMAP.md` must exist with success criteria for phase N

## Steps

### Step 1 — Validate prerequisites

Read `.planning/STATE.md`, `.planning/NN-SUMMARY.md`, `.planning/ROADMAP.md`.

Check:
- Does SUMMARY.md exist and show status "complete" (not "partial")?
  - If "partial": warn the user that execution did not complete fully. Verify can still proceed but may find failures.
- Are the success criteria present in ROADMAP.md for this phase?

### Step 2 — Invoke ship-verifier

Invoke the `ship-verifier` agent with the phase number.

> "Invoking ship-verifier for Phase N — [Phase Name]"

The verifier will:
- Check each success criterion from ROADMAP.md
- Scan for anti-patterns (TODOs, stubs, hardcoded values)
- Identify items needing human review
- Write `.planning/NN-VERIFY.md`
- Update STATE.md

### Step 3 — Present verification results

After the verifier returns `## VERIFICATION COMPLETE`, read `.planning/NN-VERIFY.md` and present:

**If PASS:**
```
## Phase N Verified — PASS

All [N] success criteria met.
[If human checks: "Note: [N] items need manual review — see NN-VERIFY.md"]

Phase N is complete. Ready for Phase N+1.
Next: /ship:plan-phase [N+1]
```

**If PARTIAL:**
```
## Phase N Verified — PARTIAL

[N of M] criteria met.

Gaps:
- [Gap 1]: [description]
- [Gap 2]: [description]

Fix tasks have been written to NN-VERIFY.md. The executor will run ONLY these
targeted fixes instead of re-executing the full plan.

Options:
1. Run fix tasks: /ship:execute-phase N (executes only the fix tasks from VERIFY.md)
2. Fix manually and re-verify: /ship:verify-phase N
3. Accept partial and continue: /ship:plan-phase [N+1] (not recommended)
```

**If FAIL:**
```
## Phase N Verified — FAIL

[N of M] criteria met.

Gaps:
[List all gaps]

Fix tasks have been written to NN-VERIFY.md.

Options:
1. Run fix tasks: /ship:execute-phase N (executes only the fix tasks from VERIFY.md)
2. Replan and re-execute: /ship:plan-phase N → /ship:execute-phase N (if gaps suggest plan was insufficient)
```

### Step 4 — Final project check (last phase only)

If this is the last phase in ROADMAP.md and verification passes, run `/ship:complete` automatically (or prompt the user to do so).

---

## Error Handling

**If SUMMARY.md doesn't exist:** Execution hasn't happened. Tell the user to run `/ship:execute-phase N` first.

**If ROADMAP.md has no success criteria for this phase:** This is a gap in the roadmap. The verifier will flag it. Recommend the user adds criteria to ROADMAP.md and re-runs verification.

**If all criteria are NEEDS-HUMAN:** This is a legitimate outcome. Present the human checklist clearly and tell the user to manually verify each item before proceeding.
