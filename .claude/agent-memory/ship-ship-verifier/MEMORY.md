# Memory Index

- [Test runner environment](test-runner-environment.md) — `node --test tests/` and `timeout` both fail on this machine in ways that mimic real defects
- [Dogfood suite failure](dogfood-suite-failure.md) — RESOLVED 2026-08-23: the code-span assertion now passes everywhere; a future failure is a real regression
- [Nested node --test passes vacuously](nested-node-test-vacuous-pass.md) — a spawned `node --test` inherits NODE_TEST_CONTEXT and exits 0 with no output; strip it or the assertion proves nothing
