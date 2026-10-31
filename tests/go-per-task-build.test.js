/**
 * Per-task build dispatch in the /ship:go workflow.
 *
 * With a task list on the phase and no `buildMode: 'per-phase'`, the workflow
 * dispatches one fresh builder per pending task. Each builder's input is a
 * brief file it generates with ship/task-brief.cjs — never PLAN.md or
 * CONTEXT.md — and it ticks the task done with ship/tick.cjs. The phase's
 * round machinery (PARTIAL, probe, salvage, blind rounds) applies per task.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { run, WORKFLOW } = require('./go-per-phase-golden.test.js');

const src = fs.readFileSync(WORKFLOW, 'utf8');
const ROOT = '/opt/ship-root';
const T1 = { id: '1', name: 'Add the parser', docsOnly: false };
const T2 = { id: '2', name: 'Document the parser', docsOnly: true };
const args = (extra = {}) => ({
  feature: 'demo', shipRoot: ROOT,
  phases: [{ id: 'p1', name: 'Core', tasks: [T1, T2] }],
  ...extra,
});

const done = (commits, evidence) => ({
  feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits,
  ...(evidence ? { verify_evidence: evidence } : {}),
});
const APPROVED = { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['a.js'] };
const PASS = { feature: 'demo', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
const probe = (doneCount, clean = true, commits = []) => ({
  tasks_done: doneCount, tasks_pending: 1 - doneCount, tasks_total: 1, commits, working_tree_clean: clean,
});
const happy = (label) => {
  if (label === 'build:p1:t1') return done(['aaa1111'], [{ task_id: '1', command: 'node --test a', exit_code: 0, output_tail: 'ok' }]);
  if (label === 'build:p1:t2') return done(['bbb2222'], [{ task_id: '2', command: 'grep -q x README.md', exit_code: 0 }]);
  if (label === 'review:p1') return APPROVED;
  if (label === 'verify') return PASS;
  return null;
};
const labels = (calls) => calls.map((c) => c.label);
const byLabel = (calls, l) => calls.find((c) => c.label === l);

describe('go workflow — per-task build dispatch', () => {
  it('dispatches one builder per task, then reviews the phase', async () => {
    const { calls, result } = await run(src, args(), happy);
    assert.deepEqual(labels(calls), ['build:p1:t1', 'build:p1:t2', 'review:p1', 'verify']);
    assert.equal(result.stoppedAt, null);
    assert.deepEqual(result.completed[0].commits, ['aaa1111', 'bbb2222']);
    assert.equal(result.completed[0].tasksCompleted, 2);
    assert.equal(result.completed[0].tasksTotal, 2);
  });

  it('feeds each builder a brief and never PLAN.md or CONTEXT.md', async () => {
    const { calls } = await run(src, args(), happy);
    for (const t of [T1, T2]) {
      const p = byLabel(calls, `build:p1:t${t.id}`).prompt;
      assert.ok(p.includes(`.review-scratch/briefs/task-${t.id}.md`), 'names the brief path');
      assert.ok(p.includes(`node "${ROOT}/ship/task-brief.cjs" demo ${t.id}`), 'names the brief command');
      assert.ok(p.includes(`node "${ROOT}/ship/tick.cjs" demo ${t.id}`), 'names the tick command');
      assert.ok(p.includes(`Task: ${t.id} — ${t.name}`));
      assert.ok(p.includes('verify_evidence'));
      assert.ok(p.includes('Output Discipline'));
      assert.ok(!p.includes('PLAN.md'), 'no PLAN.md pointer');
      assert.ok(!p.includes('CONTEXT.md'), 'no CONTEXT.md pointer');
    }
  });

  it('falls back to the literal ${CLAUDE_PLUGIN_ROOT} when shipRoot is absent', async () => {
    const { calls } = await run(src, args({ shipRoot: undefined }), happy);
    assert.ok(byLabel(calls, 'build:p1:t1').prompt.includes('node "${CLAUDE_PLUGIN_ROOT}/ship/task-brief.cjs" demo 1'));
  });

  it('routes a docs-only task to sonnet and a code task to opus', async () => {
    const { calls } = await run(src, args(), happy);
    assert.equal(byLabel(calls, 'build:p1:t1').model, 'opus');
    assert.equal(byLabel(calls, 'build:p1:t2').model, 'sonnet');
  });

  it('continues a PARTIAL task as build:p1:t1:cont1', async () => {
    const { calls } = await run(src, args(), (label) => {
      // A PARTIAL continues only when it landed something (a partial commit).
      if (label === 'build:p1:t1') return { ...done(['aaa0000']), status: 'PARTIAL', tasks_completed: 0 };
      if (label === 'build:p1:t1:cont1') return done(['aaa1111']);
      return happy(label);
    });
    assert.deepEqual(labels(calls), ['build:p1:t1', 'build:p1:t1:cont1', 'build:p1:t2', 'review:p1', 'verify']);
    const cont = byLabel(calls, 'build:p1:t1:cont1').prompt;
    assert.ok(cont.includes("This task's previous builder reported PARTIAL."));
    assert.ok(!cont.includes('PLAN.md') && !cont.includes('CONTEXT.md'));
  });

  it('probes only the dead task, and the continuation stays off PLAN.md and CONTEXT.md', async () => {
    const { calls, result } = await run(src, args(), (label) => {
      if (label === 'build:p1:t1') return null;
      if (label === 'progress:p1:t1') return probe(0, true);
      if (label === 'build:p1:t1:cont1') return null;
      if (label === 'progress:p1:t1:cont1') return probe(0, false);
      if (label === 'build:p1:t1:cont2') return done(['aaa1111']);
      return happy(label);
    });
    assert.deepEqual(labels(calls), [
      'build:p1:t1', 'progress:p1:t1', 'build:p1:t1:cont1', 'progress:p1:t1:cont1', 'build:p1:t1:cont2',
      'build:p1:t2', 'review:p1', 'verify',
    ]);
    const p = byLabel(calls, 'progress:p1:t1');
    assert.equal(p.model, 'sonnet');
    assert.ok(p.prompt.includes('<task id="1">'), 'probe names its task');
    assert.ok(!p.prompt.includes('<phase id='), 'probe does not count the whole phase');
    assert.ok(!p.prompt.includes(T2.name), 'probe does not mention the other task');
    for (const l of ['build:p1:t1:cont1', 'build:p1:t1:cont2']) {
      const cont = byLabel(calls, l).prompt;
      assert.ok(cont.includes('The progress check found this task not yet done.'), l);
      assert.ok(!cont.includes('PLAN.md') && !cont.includes('CONTEXT.md'), l);
    }
    assert.ok(byLabel(calls, 'build:p1:t1:cont2').prompt.includes('uncommitted changes in the working tree'), 'dirty-tree salvage note kept');
    assert.equal(result.completed[0].builderRounds, 3, 'rounds is the max of any task');
    assert.ok(result.completed[0].concerns.some((c) => c.includes('salvage round')));
  });

  it('a CHECKPOINT on task 1 stops before task 2', async () => {
    const { calls, result } = await run(src, args(), (label) => {
      if (label === 'build:p1:t1') return { ...done([]), status: 'CHECKPOINT', tasks_completed: 0, reason: 'dep 9 pending', recommendation: 'build 9' };
      return happy(label);
    });
    assert.deepEqual(labels(calls), ['build:p1:t1']);
    assert.ok(result.stoppedAt, 'stoppedAt is set');
    assert.equal(result.stoppedAt.build.status, 'CHECKPOINT');
    assert.equal(result.stoppedAt.build.stopped_at, 'phase p1 task 1');
    assert.equal(result.stoppedAt.build.reason, 'dep 9 pending');
    assert.equal(result.stoppedAt.build.recommendation, 'build 9');
    assert.equal(result.stoppedAt.build.tasks_completed, 0);
    assert.equal(result.stoppedAt.build.tasks_total, 2);
  });

  it('a stop on task 2 carries task 1 as finished and its commits', async () => {
    const { result } = await run(src, args(), (label) => {
      if (label === 'build:p1:t2') return { ...done([]), status: 'NEEDS_CONTEXT', tasks_completed: 0, missing: 'an API key' };
      return happy(label);
    });
    assert.equal(result.stoppedAt.build.status, 'NEEDS_CONTEXT');
    assert.equal(result.stoppedAt.build.tasks_completed, 1);
    assert.deepEqual(result.stoppedAt.build.commits, ['aaa1111']);
    assert.equal(result.stoppedAt.build.stopped_at, 'phase p1 task 2');
  });

  it('collects verify_evidence from every task into builderEvidence', async () => {
    const { result } = await run(src, args(), happy);
    assert.deepEqual(result.completed[0].builderEvidence.map((e) => e.task_id), ['1', '2']);
  });

  it('a task reporting concerns makes the phase COMPLETE_WITH_CONCERNS', async () => {
    const { result } = await run(src, args({ reviewGate: false }), (label) => {
      if (label === 'build:p1:t1') return { ...done(['aaa1111']), status: 'COMPLETE_WITH_CONCERNS', concerns: ['flaky'] };
      return happy(label);
    });
    assert.deepEqual(result.completed[0].concerns, ['flaky']);
    assert.equal(result.completed[0].reviewStatus, 'SKIPPED_BY_PROFILE');
    assert.equal(result.completed[0].builderEvidence.length, 1);
  });

  it('a phase without tasks still builds as build:p1', async () => {
    const { calls, result } = await run(src, { feature: 'demo', phases: [{ id: 'p1', name: 'Core' }] }, (label) => {
      if (label === 'build:p1') return { ...done(['aaa1111']), tasks_total: 2 };
      return happy(label);
    });
    assert.deepEqual(labels(calls), ['build:p1', 'review:p1', 'verify']);
    assert.deepEqual(result.completed[0].builderEvidence, []);
  });

  it("buildMode 'per-phase' overrides the task list", async () => {
    const { calls } = await run(src, args({ buildMode: 'per-phase' }), (label) => {
      if (label === 'build:p1') return { ...done(['aaa1111']), tasks_total: 2 };
      return happy(label);
    });
    assert.deepEqual(labels(calls), ['build:p1', 'review:p1', 'verify']);
  });
});
