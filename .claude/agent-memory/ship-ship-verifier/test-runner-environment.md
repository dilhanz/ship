---
name: test-runner-environment
description: Running Ship's test suite on this machine — the two invocation traps (node --test tests/, and missing timeout) that silently waste a verification round
metadata:
  type: project
---

Two environment facts about running Ship's suite on this machine (Node v25.8.1, macOS).

**1. `node --test tests/` errors with MODULE_NOT_FOUND.** The bare directory argument is resolved as a module entrypoint, so it fails before running a single test. Use the CI form `node --test tests/*.test.js` (what `.github/workflows/release.yml` uses) or bare `node --test` from the repo root.

**2. `timeout` is not installed.** `timeout 60 node --test ...` exits **127** and runs nothing. The empty output looks exactly like a hung test, so it is easy to misread as "the code under test has an infinite loop." Use `node --test --test-timeout=20000` instead — Node's own per-test timeout.

**Why:** both failure modes produce output that resembles a real defect rather than a bad invocation, so a verifier can draw a wrong conclusion and record it as evidence. Trap 2 nearly produced a false "the adversarial suite hangs on this mutant" finding during the go-path-reliability verification.

**How to apply:** when a criterion's verify command is `node --test tests/` (some PLAN.md tasks author it that way), run the CI form instead and note the substitution rather than recording a FAIL. When a test run returns no output at all, check the exit code before concluding anything about the code.

Related: [[dogfood-suite-failure]]
