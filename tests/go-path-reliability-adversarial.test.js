/**
 * Verifier-authored adversarial tests for go-path-reliability.
 *
 * The feature's own suite asserts the *source text* of go.workflow.js. That
 * catches prose drift but cannot catch a logic error: an assertion on a string
 * passes whether or not the code around it runs. These tests execute the real
 * thing instead —
 *
 *   1. `ship/verify-scratch.cjs` against real fixture git repositories, driven
 *      through both the module API and the CLI, including the degrade paths;
 *   2. `ship/workflows/go.workflow.js` itself, loaded into an AsyncFunction
 *      with `args`/`agent`/`log`/`phase` injected, so the transport
 *      classification, the round accounting, the INFRASTRUCTURE exits and the
 *      salvage-event channel are observed as behavior rather than as text.
 *
 * The workflow is a Workflow-engine script: a module whose body ends in a
 * top-level `return`, with `agent`, `log` and `phase` supplied by the host. It
 * is therefore neither `require()`-able nor `import()`-able as written, which
 * is why the harness below rewrites the single `export` and wraps the body.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SCRIPT = path.join(repoRoot, 'ship', 'verify-scratch.cjs');
const WORKFLOW = path.join(repoRoot, 'ship', 'workflows', 'go.workflow.js');
const validator = require(SCRIPT);

// ---------------------------------------------------------------------------
// fixture git repository helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-verify-scratch-')));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Ship Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

function commit(dir, file, body, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
  git(['add', file], dir);
  git(['commit', '-q', '-m', message], dir);
  return git(['rev-parse', 'HEAD'], dir).stdout.trim();
}

function writeRecord(dir, slug, record) {
  const file = path.join(dir, '.planning', 'features', slug, '.review-scratch', 'verify.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record, null, 2));
  return file;
}

function cli(argv, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], { cwd, encoding: 'utf8' });
}

function withRepo(fn) {
  const dir = makeRepo();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SLUG = 'demo-feature';

// ---------------------------------------------------------------------------
// 1. verify-scratch.cjs — the accept path and every documented rejection
// ---------------------------------------------------------------------------

describe('verify-scratch — accepts only records that describe THIS build', () => {
  it('accepts a base head that is HEAD itself (verifier died before committing anything)', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      writeRecord(dir, SLUG, { feature: SLUG, base_head: base, stage: 'criteria', criteria: [], tests: [] });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, true, v.reason || '');
      assert.equal(v.stage, 'criteria');
    });
  });

  it('accepts when every commit since the base head is one of the record\'s own test commits', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      const t1 = commit(dir, 'tests/one.test.js', '1', 'test: one');
      const t2 = commit(dir, 'tests/two.test.js', '2', 'test: two');
      writeRecord(dir, SLUG, {
        feature: SLUG, base_head: base, stage: 'bughunt',
        tests: [{ file: 'tests/one.test.js', commit: t1 }, { file: 'tests/two.test.js', commit: t2 }],
      });
      assert.equal(validator.validateRecord(SLUG, dir).valid, true);
    });
  });

  it('resolves short hashes on both sides rather than comparing raw strings', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      const t1 = commit(dir, 'tests/one.test.js', '1', 'test: one');
      writeRecord(dir, SLUG, {
        feature: SLUG, base_head: base.slice(0, 7), stage: 'bughunt',
        tests: [{ file: 'tests/one.test.js', commit: t1.slice(0, 7) }],
      });
      assert.equal(validator.validateRecord(SLUG, dir).valid, true);
    });
  });

  it('rejects a foreign commit inside base_head..HEAD — the code moved under the verifier', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      const t1 = commit(dir, 'tests/one.test.js', '1', 'test: one');
      commit(dir, 'src.js', 'src', 'feat: someone else shipped');
      writeRecord(dir, SLUG, {
        feature: SLUG, base_head: base, stage: 'bughunt',
        tests: [{ file: 'tests/one.test.js', commit: t1 }],
      });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /not one of the record's own test commits/);
    });
  });

  it('rejects a base head that is not an ancestor of HEAD', () => {
    withRepo((dir) => {
      commit(dir, 'a.txt', 'a', 'feat: a');
      git(['checkout', '-q', '-b', 'side'], dir);
      const side = commit(dir, 'side.txt', 's', 'feat: side');
      git(['checkout', '-q', 'main'], dir);
      commit(dir, 'b.txt', 'b', 'feat: b');
      writeRecord(dir, SLUG, { feature: SLUG, base_head: side, stage: 'criteria', tests: [] });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /not an ancestor of HEAD/);
    });
  });

  it('rejects a missing record, malformed JSON, an unstamped record, and a record with no base_head', () => {
    withRepo((dir) => {
      commit(dir, 'a.txt', 'a', 'feat: a');
      const base = git(['rev-parse', 'HEAD'], dir).stdout.trim();

      assert.match(validator.validateRecord(SLUG, dir).reason, /no scratch record at/);

      writeRecord(dir, SLUG, '{ not json');
      assert.match(validator.validateRecord(SLUG, dir).reason, /malformed JSON/);

      writeRecord(dir, SLUG, { feature: SLUG, base_head: base, criteria: [] });
      assert.match(validator.validateRecord(SLUG, dir).reason, /no stage key/);

      writeRecord(dir, SLUG, { feature: SLUG, stage: 'criteria' });
      assert.match(validator.validateRecord(SLUG, dir).reason, /no base_head/);

      writeRecord(dir, SLUG, { feature: SLUG, base_head: base, stage: 'halfway' });
      assert.match(validator.validateRecord(SLUG, dir).reason, /is not one of criteria\|bughunt\|complete/);
    });
  });

  it('rejects rather than skips a test commit it cannot resolve', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      commit(dir, 'tests/one.test.js', '1', 'test: one');
      writeRecord(dir, SLUG, {
        feature: SLUG, base_head: base, stage: 'bughunt',
        tests: [{ file: 'tests/one.test.js', commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }],
      });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /cannot be resolved/);
    });
  });

  it('rejects a record whose base_head is a valid SHA from another repository', () => {
    withRepo((dir) => {
      commit(dir, 'a.txt', 'a', 'feat: a');
      writeRecord(dir, SLUG, {
        feature: SLUG, stage: 'criteria',
        base_head: '136c13f8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
        tests: [],
      });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /not a commit known to this repository/);
    });
  });
});

describe('verify-scratch — degrades, never dies', () => {
  it('never throws from the module API on hostile input', () => {
    for (const [slug, cwd] of [
      [null, null], [undefined, undefined], [123, {}], ['', ''],
      ['x', '/definitely/not/a/path/anywhere'], [{ a: 1 }, os.tmpdir()],
    ]) {
      let v;
      assert.doesNotThrow(() => { v = validator.validateRecord(slug, cwd); });
      assert.equal(v.valid, false, `expected reject for ${String(slug)}`);
      assert.equal(typeof v.reason, 'string');
    }
  });

  it('the CLI exits 0 with a reject verdict on garbage, a non-git dir, and a nonexistent path', () => {
    const cases = [
      { argv: [], cwd: os.tmpdir() },
      { argv: ['no-such-feature'], cwd: os.tmpdir() },
      { argv: ['--cwd'], cwd: os.tmpdir() },
      { argv: ['--cwd=/definitely/not/a/path', 'x'], cwd: os.tmpdir() },
      { argv: ['--nonsense', '--flags', 'only'], cwd: os.tmpdir() },
      { argv: ['a', 'b', 'c'], cwd: os.tmpdir() },
    ];
    for (const c of cases) {
      const r = cli(c.argv, c.cwd);
      assert.equal(r.status, 0, `exit 0 expected for ${JSON.stringify(c.argv)} (stderr: ${r.stderr})`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.valid, false);
      assert.equal(typeof out.reason, 'string');
    }
  });

  it('the CLI never mistakes the --cwd value for the feature slug', () => {
    withRepo((dir) => {
      const base = commit(dir, 'a.txt', 'a', 'feat: a');
      writeRecord(dir, SLUG, { feature: SLUG, base_head: base, stage: 'complete', tests: [] });
      const r = cli(['--cwd', dir, SLUG], os.tmpdir());
      assert.equal(r.status, 0);
      const out = JSON.parse(r.stdout);
      assert.equal(out.valid, true, out.reason || '');
      assert.equal(out.stage, 'complete');
    });
  });

  it('a record inside a repo with no commits at all is rejected, not crashed on', () => {
    const dir = makeRepo();
    try {
      writeRecord(dir, SLUG, { feature: SLUG, base_head: 'abc1234', stage: 'criteria', tests: [] });
      const v = validator.validateRecord(SLUG, dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /cannot resolve HEAD|not a commit known/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. go.workflow.js — executed, not merely read
// ---------------------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Load go.workflow.js as a callable async function.
 *
 * The script is a Workflow-engine module: one `export` on line 1, a top-level
 * `return` on the last line, and `agent`/`log`/`phase` supplied by the host.
 * Dropping the `export` keyword and wrapping the body in an AsyncFunction is
 * the smallest transformation that makes the real source executable here —
 * every line of logic under test is the shipped line.
 */
function loadWorkflow() {
  const src = fs.readFileSync(WORKFLOW, 'utf8').replace(/^export const meta/m, 'const meta');
  return new AsyncFunction('args', 'agent', 'log', 'phase', src);
}

const TRANSPORT = () => Object.assign(new Error('API Error: getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' });

/**
 * Run the workflow with a scripted `agent`. `handler` receives
 * `{ prompt, opts, call }` and either throws (simulating an agent death) or
 * returns a structured result.
 */
async function runWorkflow(handler, overrides = {}) {
  const run = loadWorkflow();
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    const call = { prompt, opts, index: calls.length };
    calls.push(call);
    return handler({ prompt, opts, call, calls });
  };
  const result = await run(
    { feature: 'demo', phases: [{ id: '1', name: 'one' }], ...overrides },
    agent,
    (m) => logs.push(String(m)),
    () => {}
  );
  return { result, calls, logs };
}

const buildCalls = (calls) => calls.filter((c) => (c.opts.label || '').startsWith('build:'));

describe('transport deaths are not spent rounds (executed)', () => {
  it('a sustained builder outage terminates as INFRASTRUCTURE after the transport cap, not the round cap', async () => {
    const { result, calls } = await runWorkflow(() => { throw TRANSPORT(); });

    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE',
      'a connection that never comes back must be named an outage, not an exhausted budget');
    // MAX_BUILD_ROUNDS is 5 and MAX_TRANSPORT_RETRIES is 3: if transport deaths
    // consumed rounds we would see 5 builder calls and an EXHAUSTED status.
    assert.equal(buildCalls(calls).length, 3, 'the cap that fired must be the transport cap');
    assert.match(result.stoppedAt.build.reason, /transport error/);
    assert.match(result.stoppedAt.build.recommendation, /Re-run \/ship:go demo/);
    assert.doesNotMatch(result.stoppedAt.build.recommendation, /split/i,
      'an outage must never be answered with advice to resize tasks');
  });

  it('a transport death that recovers costs the phase no round at all', async () => {
    // Two outages, then a healthy builder that completes the phase. If the
    // outages had been charged, only three rounds would remain and the phase
    // would still finish — so the assertion is on the round count reported.
    let n = 0;
    const { result } = await runWorkflow(({ opts }) => {
      if ((opts.label || '').startsWith('build:')) {
        n += 1;
        if (n <= 2) throw TRANSPORT();
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if ((opts.label || '').startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      return { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
    });

    assert.equal(result.stoppedAt, null, 'the phase completed once the connection came back');
    assert.equal(result.completed[0].builderRounds, 1,
      'the two outages must not appear as spent rounds — the first real builder is round 1');
  });

  it('non-consecutive outages never add up to the cap', async () => {
    // outage, healthy PARTIAL, outage, healthy PARTIAL, outage, ... — the
    // counter resets on every returned result, so this must not terminate as
    // INFRASTRUCTURE.
    let build = 0;
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        build += 1;
        if (build % 2 === 1) throw TRANSPORT();
        return {
          feature: 'demo', status: 'PARTIAL', tasks_completed: 1, tasks_total: 9,
          commits: [`c${build}`],
        };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      return { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
    });

    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED',
      'a build that kept making progress between outages ran out of rounds, not connection');
  });

  it('a plain agent failure still spends its round — the exemption is transport-only', async () => {
    // Each dead builder still lands a task (the probe sees the count rise), so
    // the phase keeps going and the round cap is what stops it. Under the
    // transport exemption these rounds would not be charged and the run would
    // never terminate as EXHAUSTED.
    let done = 0;
    const { result, calls } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) { done += 1; throw new Error('the builder blew up on its own'); }
      if (label.startsWith('progress:')) {
        return {
          feature: 'demo', tasks_done: done, tasks_pending: 99 - done, tasks_total: 99,
          commits: [], working_tree_clean: true, out_of_order: [], notes: null,
        };
      }
      return null;
    });
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
    assert.equal(buildCalls(calls).length, 5, 'a genuine agent death must consume a build round');
    assert.match(result.stoppedAt.build.reason, /turn budget exhausted/);
    assert.match(result.stoppedAt.build.recommendation, /split its remaining tasks/);
  });

  it('the exhaustion reason names the transport cause when the run ended on one', async () => {
    // Progress every round (so rounds run out) with the very last builder dying
    // on the connection: EXHAUSTED is right, but the hardcoded "turn budget"
    // reason would be a lie.
    let build = 0;
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        build += 1;
        if (build >= 5) throw TRANSPORT();
        return { feature: 'demo', status: 'PARTIAL', tasks_completed: 1, tasks_total: 99, commits: [`c${build}`] };
      }
      if (label.startsWith('progress:')) {
        return {
          feature: 'demo', tasks_done: 4, tasks_pending: 95, tasks_total: 99,
          commits: [], working_tree_clean: true, out_of_order: [], notes: null,
        };
      }
      return null;
    });
    assert.match(result.stoppedAt.build.reason, /transport error/,
      'the reason must be derived from the actual cause');
    assert.match(result.stoppedAt.build.recommendation, /Re-run \/ship:go/);
  });
});

describe('the verifier outage is reported through the one rendering path (executed)', () => {
  it('a verifier lost to the connection surfaces as a verify pseudo-phase, not a null verdict', async () => {
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      throw TRANSPORT();
    });

    assert.equal(result.verdict, null);
    assert.ok(result.stoppedAt, 'the outage must reach the operator through stoppedAt');
    assert.equal(result.stoppedAt.phase.id, 'verify');
    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE');
    assert.match(result.stoppedAt.build.reason, /verifier died on a transport error/);
    assert.match(result.stoppedAt.build.recommendation, /Re-run \/ship:go demo/);
  });

  it('a verifier that dies for its own reasons is NOT reported as an outage', async () => {
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      throw new Error('subagent completed without calling StructuredOutput');
    });
    assert.equal(result.verdict, null);
    assert.equal(result.stoppedAt, null, 'only a transport cause may claim INFRASTRUCTURE');
  });
});

describe('salvage events are recorded as they happen (executed)', () => {
  it('a salvaged verifier retry lands an adopted event naming agent and record', async () => {
    let verifyCalls = 0;
    const { result, calls } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      verifyCalls += 1;
      if (verifyCalls === 1) throw new Error('StructuredOutput wrapper flaked');
      return {
        feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1,
        criteria_verdicts: [], salvaged: 'adopted',
      };
    });

    assert.equal(result.verdict.status, 'PASS');
    assert.deepEqual(result.salvageEvents, [
      { agent: 'verify', record: '.review-scratch/verify.json', outcome: 'adopted' },
    ]);

    // The retry must have been pointed at the scratch record, and the plugin
    // root must survive prompt construction as a literal for the shell to
    // expand — evaluating it at build time would have thrown a ReferenceError.
    const retry = calls.find((c) => (c.opts.label || '') === 'verify:retry');
    assert.match(retry.prompt, /verify-scratch\.cjs/);
    assert.ok(retry.prompt.includes('${CLAUDE_PLUGIN_ROOT}'),
      'the salvage prompt must carry the literal ${CLAUDE_PLUGIN_ROOT}');
    // Anchor on the numbered section headers, not the bare filename: the
    // prompt's opening sentence names VERIFY.md while instructing the reader to
    // check the scratch record first, so a bare-substring ordering test reads
    // the correct prompt as wrong.
    assert.ok(
      retry.prompt.indexOf('**1. The scratch record.**') < retry.prompt.indexOf('**2. VERIFY.md.**'),
      'the scratch record must be consulted before VERIFY.md'
    );
    assert.ok(
      retry.prompt.indexOf('verify-scratch.cjs') < retry.prompt.indexOf('**2. VERIFY.md.**'),
      'the helper invocation belongs in the record step, ahead of the VERIFY.md step'
    );
  });

  it('a retry that returns nothing is recorded too — a silent salvage is the bug being fixed', async () => {
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      throw new Error('flake');
    });
    assert.equal(result.salvageEvents.length, 1);
    assert.equal(result.salvageEvents[0].outcome, 'no-result');
  });

  it('a run where nothing was lost reports no salvage events', async () => {
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      return { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
    });
    assert.deepEqual(result.salvageEvents, []);
  });
});

describe('the progress probe surfaces ordering corruption (executed)', () => {
  it('out_of_order entries reach the phase result as concerns even though the builder is gone', async () => {
    let build = 0;
    const { result } = await runWorkflow(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) { build += 1; throw new Error('builder died silently'); }
      if (label.startsWith('progress:')) {
        return {
          feature: 'demo',
          tasks_done: build, tasks_pending: Math.max(0, 4 - build), tasks_total: 4,
          commits: [], working_tree_clean: true,
          out_of_order: ['task 3 depends on 2'], notes: null,
        };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      return { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
    });

    const concerns = (result.stoppedAt ? result.stoppedAt.build.concerns : result.completed[0].concerns) || [];
    assert.ok(
      concerns.some((c) => /ordering violated — task 3 depends on 2/.test(c)),
      `expected the ordering violation to survive to the phase result, got ${JSON.stringify(concerns)}`
    );
    assert.equal(concerns.filter((c) => /task 3 depends on 2/.test(c)).length, 1,
      'the same violation must be reported once, not once per round');
  });
});
