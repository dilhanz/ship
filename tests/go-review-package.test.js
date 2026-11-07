/**
 * Per-task phase reviews read one review package and trust builder evidence.
 *
 * A phase built per task carries each builder's recorded verify run. Its
 * reviewer is told to build a review-package file for the phase range (log,
 * stat, diff) and read that instead of running git diff itself, and not to
 * re-run the verify commands the builders recorded green — only the tasks with
 * no evidence or a failing one. Builder evidence may stand in for the verify
 * half of a review's substantiation, never for the files-reviewed half.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { run, WORKFLOW } = require('./go-per-phase-golden.test.js');

const src = fs.readFileSync(WORKFLOW, 'utf8');
const ROOT = '/opt/ship-root';
const TASKS = [
  { id: '1', name: 'one', docsOnly: false },
  { id: '2', name: 'two', docsOnly: false },
  { id: '3', name: 'three', docsOnly: false },
];
const longTail = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
const EVIDENCE = {
  1: [{ task_id: '1', command: 'node --test tests/a.test.js', exit_code: 0, output_tail: longTail }],
  2: [],
  3: [{ task_id: '3', command: 'node --test tests/c.test.js', exit_code: 1, output_tail: 'not ok 1' }],
};
const PASS = { feature: 'demo', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
const built = (id, evidence = EVIDENCE[id]) => ({
  feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: [`c${id}c${id}c${id}`],
  verify_evidence: evidence,
});
const review = (verifyRuns, files) => ({ feature: 'demo', status: 'APPROVED', findings: [], verify_runs: verifyRuns, files_reviewed: files });

async function runPerTask(reviewResult, { evidence = EVIDENCE, phases } = {}) {
  let reviewPrompt = null;
  let retryPrompt = null;
  const out = await run(src, {
    feature: 'demo', shipRoot: ROOT,
    phases: phases || [{ id: 'p1', name: 'Core', tasks: TASKS }],
  }, (label, prompt) => {
    const m = label.match(/^build:p1:t(\d)$/);
    if (m) return built(m[1], evidence[m[1]]);
    if (label === 'build:p1') return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['aaa1111'] };
    if (label === 'review:p1') { reviewPrompt = prompt; return typeof reviewResult === 'function' ? reviewResult : reviewResult; }
    if (label === 'review:p1:retry') { retryPrompt = prompt; return review([], ['a.js']); }
    if (label === 'verify') return PASS;
    return null;
  });
  return { ...out, reviewPrompt, retryPrompt };
}

const unsubstantiated = (concerns) => concerns.filter((c) => c.includes('treat its') && c.includes('unsubstantiated'));
const unreviewed = (concerns) => concerns.filter((c) => c.includes('reviewed no files — the diff went unreviewed'));

describe('go workflow — per-task phase review package', () => {
  it('hands the reviewer the package command, the evidence, and the re-run list', async () => {
    const { reviewPrompt } = await runPerTask(review([], ['a.js']));
    assert.ok(reviewPrompt.includes(`node "${ROOT}/ship/review-package.cjs" demo c1c1c1~1..HEAD phase-p1`), 'package command with range and scope');
    assert.ok(reviewPrompt.includes('.review-scratch/package-phase-p1.md'));
    assert.ok(reviewPrompt.includes('Phase commits: c1c1c1, c2c2c2, c3c3c3'));
    assert.ok(reviewPrompt.includes('- task 1: `node --test tests/a.test.js` → exit 0'));
    assert.ok(reviewPrompt.includes('- task 3: `node --test tests/c.test.js` → exit 1'));
    assert.ok(reviewPrompt.includes('    line 30'), 'tail is indented');
    assert.ok(reviewPrompt.includes('    line 11'), 'last 20 lines kept');
    assert.ok(!reviewPrompt.includes('    line 10\n'), 'tail capped at 20 lines');
    assert.ok(reviewPrompt.includes('Do NOT re-run these verify commands'));
    const rerun = reviewPrompt.split('\n').find((l) => l.startsWith('Re-run Step 1 for every other task'));
    assert.ok(rerun, 're-run list present');
    assert.ok(rerun.includes('task 2') && rerun.includes('task 3'), 'no evidence and failing evidence re-run');
    assert.ok(!rerun.includes('task 1,') && !/task 1$/.test(rerun), 'green evidence is not re-run');
    assert.ok(rerun.includes('a task an earlier run finished has no evidence above and must be re-run'), 'resumed-phase done tasks are re-run');
    const cov = reviewPrompt.indexOf('Run the coverage check from your instructions first');
    assert.ok(cov >= 0 && cov < reviewPrompt.indexOf('review-package.cjs'), 'coverage check precedes package build');
    assert.ok(reviewPrompt.includes('Step 1b (neighbouring tests) still runs.'));
    assert.ok(reviewPrompt.includes('Output Discipline'));
    assert.ok(reviewPrompt.includes('.planning/features/demo/PLAN.md'));
  });

  it('omits the re-run list when every task has green evidence', async () => {
    const green = { 1: EVIDENCE[1], 2: [{ task_id: '2', command: 'x', exit_code: 0 }], 3: [{ task_id: '3', command: 'y', exit_code: 0 }] };
    const { reviewPrompt } = await runPerTask(review([], ['a.js']), { evidence: green });
    assert.ok(!reviewPrompt.includes('From this run:'), 'no this-run list when all green');
    assert.ok(reviewPrompt.includes('a task an earlier run finished has no evidence above'), 'earlier done tasks still re-run');
  });

  it('a per-phase phase keeps today\'s review prompt', async () => {
    const { reviewPrompt } = await runPerTask(review([], ['a.js']), { phases: [{ id: 'p1', name: 'Core' }] });
    assert.ok(reviewPrompt.includes("Re-run each task's verify command (trust-but-verify), then review the phase diff."));
    assert.ok(!reviewPrompt.includes('review-package.cjs'));
  });

  it('a salvage retry wraps the package prompt', async () => {
    const { reviewPrompt, retryPrompt } = await runPerTask(() => { throw new Error('lost'); });
    assert.equal(reviewPrompt.includes('review-package.cjs'), true);
    assert.ok(retryPrompt.startsWith('Salvage a lost review result'));
    assert.ok(retryPrompt.includes('.review-scratch/phase-p1.json'));
    assert.ok(retryPrompt.endsWith(reviewPrompt), 'the full package prompt follows the salvage block');
  });
});

describe('go workflow — per-task review substantiation', () => {
  it('no concern when the review read files and builders left evidence', async () => {
    const { result } = await runPerTask(review([], ['a.js']));
    assert.deepEqual(unsubstantiated(result.completed[0].concerns), []);
    assert.deepEqual(unreviewed(result.completed[0].concerns), []);
    assert.equal(result.completed[0].builderEvidence.length, 2);
  });

  it('still unsubstantiated when verify runs, files, and builder evidence are all empty', async () => {
    const { result } = await runPerTask(review([], []), { evidence: { 1: [], 2: [], 3: [] } });
    assert.equal(unsubstantiated(result.completed[0].concerns).length, 1);
  });

  it('builder evidence never excuses an unreviewed diff', async () => {
    const { result } = await runPerTask(review([], []));
    assert.equal(unreviewed(result.completed[0].concerns).length, 1);
    assert.deepEqual(unsubstantiated(result.completed[0].concerns), []);
  });

  it('per-phase phases keep today\'s rule', async () => {
    const { result } = await runPerTask(review([], []), { phases: [{ id: 'p1', name: 'Core' }] });
    assert.equal(unsubstantiated(result.completed[0].concerns).length, 1);
    assert.deepEqual(unreviewed(result.completed[0].concerns), []);
  });
});
