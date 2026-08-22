/**
 * Verifier-authored tests for the review findings carried into Stage 2b.
 *
 * REVIEW.md recorded several defects the build's single fix round did not have
 * to clear. Two of them are closable here with a real executed assertion rather
 * than a string match:
 *
 *   1. tests/go-path-reliability.test.js:100-104 asserts the transport cap is
 *      checked before `round -= 1` with
 *      `branch.indexOf(A) < branch.indexOf(B)`. When A is absent `indexOf`
 *      returns -1, which is less than any real index, so the assertion passes
 *      vacuously — mutating the guard to key on the wrong variable leaves the
 *      suite green while a real outage decrements `round` forever. The guard
 *      here is behavioral: the harness bounds the number of builder calls, so a
 *      neutered cap fails as an assertion instead of hanging the runner.
 *
 *   2. agents/ship-verifier.md:102 specifies `tests` as "every test file you
 *      have committed" — first person, current run. A salvaged retry reading
 *      that literally rewrites the record with only its own commits while
 *      keeping the inherited `base_head`, so the dead run's commits become
 *      foreign and verify-scratch.cjs rejects the record at the next
 *      validation. These tests pin the helper's actual behavior on both
 *      readings, so the contract's requirement is executable rather than prose.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const WORKFLOW = path.join(repoRoot, 'ship', 'workflows', 'go.workflow.js');
const validator = require(path.join(repoRoot, 'ship', 'verify-scratch.cjs'));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const loadWorkflow = () =>
  new AsyncFunction(
    'args', 'agent', 'log', 'phase',
    fs.readFileSync(WORKFLOW, 'utf8').replace(/^export const meta/m, 'const meta')
  );

const TRANSPORT = () =>
  Object.assign(new Error('API Error: getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' });

/**
 * Run the workflow with a hard ceiling on agent calls.
 *
 * The ceiling is the point. `buildPhase` refunds a round on every transport
 * death (`round -= 1; continue`), so the ONLY thing standing between a
 * sustained outage and an infinite loop is the `MAX_TRANSPORT_RETRIES` guard.
 * If that guard is broken the loop never exits, and a test that simply awaited
 * the workflow would hang rather than fail — indistinguishable from a slow
 * machine and useless in CI. Instead the scripted agent stops throwing once the
 * ceiling is crossed and returns a COMPLETE result, which unwinds the loop so
 * the assertion below can name the failure.
 */
async function runBounded(handler, ceiling) {
  const run = loadWorkflow();
  const calls = [];
  let runaway = false;
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts });
    if (calls.length > ceiling) {
      runaway = true;
      return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['ceiling'] };
    }
    return handler({ prompt, opts, calls });
  };
  const result = await run(
    { feature: 'demo', phases: [{ id: '1', name: 'one' }] },
    agent, () => {}, () => {}
  );
  return { result, calls, runaway };
}

describe('carried finding — the transport cap is load-bearing, not just present in the source', () => {
  it('a never-ending outage terminates instead of refunding rounds forever', async () => {
    // MAX_BUILD_ROUNDS is 5 and MAX_TRANSPORT_RETRIES is 3. A correct run makes
    // 3 builder calls. The ceiling of 40 is far above any legitimate path, so
    // crossing it means the refund loop never terminated.
    const { result, runaway, calls } = await runBounded(() => { throw TRANSPORT(); }, 40);

    assert.equal(runaway, false,
      `the transport cap must terminate the refund loop; the workflow made ${calls.length} agent calls`);
    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE');
    assert.equal(
      calls.filter((c) => (c.opts.label || '').startsWith('build:')).length, 3,
      'the cap that fired must be the transport cap (3), not the round cap (5)'
    );
  });

  it('the refund is bounded even when outages are interleaved with real work', async () => {
    // Alternating outage / PARTIAL keeps resetting the transport counter, so
    // only MAX_BUILD_ROUNDS can stop this. If rounds were refunded
    // unconditionally it would run forever.
    let build = 0;
    const { result, runaway } = await runBounded(({ opts }) => {
      const label = opts.label || '';
      if (label.startsWith('build:')) {
        build += 1;
        if (build % 2 === 1) throw TRANSPORT();
        return { feature: 'demo', status: 'PARTIAL', tasks_completed: build, tasks_total: 99, commits: [`c${build}`] };
      }
      if (label.startsWith('review:')) {
        return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
      }
      return { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
    }, 60);

    assert.equal(runaway, false, 'MAX_BUILD_ROUNDS must still bound a run that keeps recovering');
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
  });
});

// ---------------------------------------------------------------------------

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-salvage-chain-')));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Ship Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

function commit(dir, file, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), message);
  git(['add', file], dir);
  git(['commit', '-q', '-m', message], dir);
  return git(['rev-parse', 'HEAD'], dir).stdout.trim();
}

function writeRecord(dir, record) {
  const file = path.join(dir, '.planning', 'features', 'demo', '.review-scratch', 'verify.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

describe('carried finding — the salvage chain survives a SECOND death only if tests[] carries forward', () => {
  it('a second-generation record listing only its own commits is rejected', () => {
    const dir = fixture();
    try {
      const base = commit(dir, 'src.js', 'feat: the build under verification');
      // Verifier run 1 commits a test file, then dies.
      commit(dir, 'tests/a.test.js', 'test: a');
      // Verifier run 2 salvages, commits its own test file, and rewrites the
      // record with only that one — the literal reading of "every test file you
      // have committed".
      const b = commit(dir, 'tests/b.test.js', 'test: b');
      writeRecord(dir, {
        feature: 'demo', base_head: base, stage: 'bughunt',
        tests: [{ file: 'tests/b.test.js', commit: b }],
      });

      const v = validator.validateRecord('demo', dir);
      assert.equal(v.valid, false,
        'run 1\'s commit is now foreign to run 2\'s record — this is the chain break');
      assert.match(v.reason, /not one of the record's own test commits/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carrying the predecessor\'s commits forward keeps the chain valid', () => {
    const dir = fixture();
    try {
      const base = commit(dir, 'src.js', 'feat: the build under verification');
      const a = commit(dir, 'tests/a.test.js', 'test: a');
      const b = commit(dir, 'tests/b.test.js', 'test: b');
      writeRecord(dir, {
        feature: 'demo', base_head: base, stage: 'bughunt',
        tests: [{ file: 'tests/a.test.js', commit: a }, { file: 'tests/b.test.js', commit: b }],
      });

      const v = validator.validateRecord('demo', dir);
      assert.equal(v.valid, true, v.reason || '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-capturing base_head instead of adopting it also breaks the chain', () => {
    // The other half of the same instruction: Stage 0 says adopt base_head FROM
    // the record. A retry that re-runs `git rev-parse HEAD` after the dead run's
    // test commits landed would stamp a base head that no longer describes the
    // build under verification.
    const dir = fixture();
    try {
      commit(dir, 'src.js', 'feat: the build under verification');
      const a = commit(dir, 'tests/a.test.js', 'test: a');
      const b = commit(dir, 'tests/b.test.js', 'test: b');
      // base_head re-captured at `a` rather than adopted: valid as far as
      // ancestry goes, but it now silently excludes run 1's work from the range
      // the record claims to describe.
      writeRecord(dir, {
        feature: 'demo', base_head: a, stage: 'bughunt',
        tests: [{ file: 'tests/b.test.js', commit: b }],
      });
      assert.equal(validator.validateRecord('demo', dir).valid, true,
        'ancestry alone cannot catch a re-captured base head — only the contract can');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
