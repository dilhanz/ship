// Adversarial edge cases for the build-context-diet helpers and per-task
// dispatch, written by the ship-verifier. Each case targets an input the
// feature's own tests do not exercise.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { tick } = require(path.join(ROOT, 'ship', 'tick.cjs'));
const { buildBrief } = require(path.join(ROOT, 'ship', 'task-brief.cjs'));
const { buildPackage, isValidRange } = require(path.join(ROOT, 'ship', 'review-package.cjs'));
const { run, WORKFLOW } = require('./go-per-phase-golden.test.js');

const src = fs.readFileSync(WORKFLOW, 'utf8');

function fixture(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-adv-'));
  const fdir = path.join(dir, '.planning', 'features', 'demo');
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, 'PLAN.md'), plan);
  fs.writeFileSync(path.join(fdir, 'CONTEXT.md'), '---\nstatus: building\n---\n\n## Decisions\n\n- d\n\n## Scope\n\n- s\n');
  return { dir, planPath: path.join(fdir, 'PLAN.md'), fdir };
}

describe('tick — adversarial', () => {
  it('adds status="done" to a task tag that has no status attribute', () => {
    const { dir, planPath } = fixture('<task id="1">\n  <name>a</name>\n</task>\n');
    const r = tick({ cwd: dir, feature: 'demo', taskId: '1', commit: 'abc1234' });
    assert.equal(r.code, 0, r.line);
    assert.match(fs.readFileSync(planPath, 'utf8'), /<task id="1" status="done" commit="abc1234">/);
  });

  it('tolerates spaces and empty entries in depends, and still refuses on the pending one', () => {
    const plan = '<task id="1" status="done" commit="aaaa">\n</task>\n<task id="2" status="pending">\n</task>\n'
      + '<task id="3" status="pending" depends=" 1 , ,2 ">\n</task>\n';
    const { dir, planPath } = fixture(plan);
    const before = fs.readFileSync(planPath, 'utf8');
    const r = tick({ cwd: dir, feature: 'demo', taskId: '3', commit: 'bbbb' });
    assert.equal(r.code, 2);
    assert.equal(r.line, 'tick: refused — task 3 depends on 2 (not done)');
    assert.equal(fs.readFileSync(planPath, 'utf8'), before);
  });

  it('rejects an uppercase or non-hex commit and a task id carrying a regex metachar', () => {
    const { dir } = fixture('<task id="1" status="pending">\n</task>\n');
    assert.equal(tick({ cwd: dir, feature: 'demo', taskId: '1', commit: 'ABC1234' }).code, 1);
    assert.equal(tick({ cwd: dir, feature: 'demo', taskId: '.*', commit: 'abc1234' }).code, 1);
    assert.equal(tick({ cwd: dir, feature: 'demo', taskId: '1', commit: 'abc' }).code, 1);
  });
});

describe('task-brief — adversarial', () => {
  it('rejects a path-traversal task id and writes nothing', () => {
    const { dir, fdir } = fixture('<task id="1" status="pending">\n  <name>a</name>\n</task>\n');
    const r = buildBrief({ cwd: dir, feature: 'demo', taskId: '../../x' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 1);
    assert.equal(fs.existsSync(path.join(fdir, '.review-scratch')), false);
  });

  it('rejects a slug that escapes the features directory', () => {
    const { dir } = fixture('<task id="1" status="pending">\n</task>\n');
    assert.equal(buildBrief({ cwd: dir, feature: '..', taskId: '1' }).code, 1);
  });
});

describe('review-package — adversarial', () => {
  it('rejects an option-shaped right-hand side and a scope with a separator', () => {
    assert.equal(isValidRange('HEAD..--output=/tmp/x'), false);
    assert.equal(isValidRange('HEAD..-p'), false);
    assert.equal(isValidRange('-x..HEAD'), false);
    const r = buildPackage({ cwd: os.tmpdir(), feature: 'demo', range: 'a..b', scope: '../x' });
    assert.equal(r.code, 1);
  });
});

describe('per-task dispatch — adversarial', () => {
  const T = (id) => ({ id, name: `task ${id}`, docsOnly: false });
  const args = { feature: 'demo', shipRoot: '/r', phases: [{ id: 'p1', name: 'Core', tasks: [T('1'), T('2'), T('3')] }] };

  it('a CHECKPOINT on the middle task keeps the first task\'s commit and stops before the third', async () => {
    const { calls, result } = await run(src, args, (label) => {
      if (label === 'build:p1:t1') return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['aaa1'] };
      if (label === 'build:p1:t2') return { feature: 'demo', status: 'CHECKPOINT', tasks_completed: 0, tasks_total: 1, commits: [], reason: 'needs a ruling' };
      return null;
    });
    const labels = calls.map((c) => c.label);
    assert.ok(!labels.includes('build:p1:t3'));
    assert.ok(!labels.some((l) => l.startsWith('review:')));
    assert.ok(result.stoppedAt, 'stoppedAt set');
    assert.equal(result.stoppedAt.build.tasks_completed, 1);
    assert.deepEqual(result.stoppedAt.build.commits, ['aaa1']);
    assert.match(result.stoppedAt.build.stopped_at, /task 2/);
  });

  it('lists a task whose recorded verify exited non-zero, or null, for a review re-run', async () => {
    const { calls } = await run(src, args, (label) => {
      if (label === 'build:p1:t1') return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['aaa1'], verify_evidence: [{ task_id: '1', command: 'c1', exit_code: 0 }] };
      if (label === 'build:p1:t2') return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['bbb2'], verify_evidence: [{ task_id: '2', command: 'c2', exit_code: 1 }] };
      if (label === 'build:p1:t3') return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['ccc3'], verify_evidence: [{ task_id: '3', command: 'c3', exit_code: null }] };
      if (label === 'review:p1') return { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['a'] };
      if (label === 'verify') return { feature: 'demo', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
      return null;
    });
    const p = calls.find((c) => c.label === 'review:p1').prompt;
    assert.ok(p.includes('From this run: task 2, task 3'), p);
    assert.ok(p.includes('node "/r/ship/review-package.cjs" demo aaa1~1..HEAD phase-p1'), p);
  });
});
