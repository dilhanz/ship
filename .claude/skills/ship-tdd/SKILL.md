---
name: ship-tdd
description: Use when implementing tasks that have test-based verify commands — provides RED-GREEN-REFACTOR cycle guidance
user-invocable: false
---

# Test-Driven Development

When a task's `<verify>` command runs tests, follow this cycle.

## When to Apply

- Tasks where `<verify>` runs a test command (`node --test`, `npm test`, `pytest`, `cargo test`, etc.)
- Bug fixes (write a test that reproduces the bug first)

**Skip TDD for:** Config changes, file wiring, template creation, or tasks with non-test verify commands (e.g., `grep`, `ls`, type-check only).

## RED-GREEN-REFACTOR

### RED — Write Failing Test

Write one minimal test for the behavior described in the task. Run it. Confirm it **fails because the feature is missing** (not because of a typo or import error).

If the test passes immediately, you're testing existing behavior — fix the test.

### GREEN — Minimal Implementation

Write the simplest code to make the test pass. No extras, no "while I'm here" improvements.

Run the verify command. All tests must pass.

### REFACTOR — Clean Up (If Needed)

Remove duplication, improve names. Keep tests green. Don't add behavior.

## Rules

1. **One test at a time** — don't batch multiple test cases before implementing
2. **Watch it fail** — never skip the RED step; a test you didn't see fail proves nothing
3. **Minimal code** — only write enough to pass the current test
4. **Don't mock what you own** — use real code unless external dependencies force mocks

## When Stuck

| Problem | Action |
|---------|--------|
| Don't know what to test | Write the assertion first — what should the output be? |
| Test too complicated | The interface is too complicated — simplify the design |
| Must mock everything | Code too coupled — note it as a deviation, implement anyway |
