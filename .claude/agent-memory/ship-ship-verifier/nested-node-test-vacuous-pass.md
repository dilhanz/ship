---
name: nested-node-test-vacuous-pass
description: A `node --test` spawned from inside a test inherits NODE_TEST_CONTEXT and silently exits 0 with no output — any "the nested run must be red" assertion passes vacuously unless the env var is stripped
metadata:
  type: project
---

When a test spawns another `node --test` run (the natural way to prove a guard test actually goes
red against a mutated tree), the child **inherits `NODE_TEST_CONTEXT=child-v8`** from the parent
test process. The child then emits **no output and exits 0**, regardless of whether its assertions
would have failed.

Measured 2026-08-23 during the `remove-legacy-install-tree` verification, on the same file, back to back:

- `spawnSync(process.execPath, ['--test', '--test-reporter=tap', f], { cwd })` → `status=0`, `stdout=''`
- same call with `env` = `{...process.env}` minus `NODE_TEST_CONTEXT` → `status=1`, full TAP output

**Why it matters:** the failure mode is a *pass*. An `assert.notEqual(r.status, 0, 'guard should be red')`
silently succeeds — sorry, silently **fails to fail** — and the meta-test looks green forever while
proving nothing. It is the exact shape of bug a verifier is supposed to catch, hiding inside the
verifier's own tooling.

**How to apply:** whenever you spawn a nested `node --test` from within a test (or from any process
already running under the test runner):

1. Strip `NODE_TEST_CONTEXT` from the child env.
2. Add a sentinel assertion that the child produced real output — e.g. `assert.ok(r.stdout.includes('TAP version'))`
   — so a future regression in the env handling surfaces as a failure rather than a vacuous pass.
3. Use `--test-reporter=tap` for parsing; the local spec reporter is unparseable (see [[test-runner-environment]]).

`tests/legacy-install-tree-adversarial.test.js` is the worked example in this repo. As of that date it
is the only test that spawns a nested runner, so nothing else is affected — but the trap is invisible
until someone writes the second one.

Related: [[test-runner-environment]]
