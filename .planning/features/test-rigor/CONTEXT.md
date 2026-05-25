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
