/**
 * Builder turn-budget continuation in the /ship:go workflow.
 *
 * A builder that exhausts its turn budget mid-phase is the common case on large
 * tasks: its finished tasks are committed and marked done in PLAN.md, so a fresh
 * builder resumes from there. The workflow must continue the phase while work
 * keeps landing, and only stop when a whole round lands nothing new.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const src = readSrc('ship/workflows/go.workflow.js').replace('export const meta', 'const meta');

// Mirror the engine: run the script body in an async fn with the globals injected.
// `resolve` is called with (label, prompt) so a test can drive each round.
function runWorkflow(args, resolve) {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '';
    calls.push(label);
    const out = resolve(label, prompt);
    if (typeof out === 'function') return out();
    return out;
  };
  const phase = () => {};
  const log = () => {};
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const pipeline = async () => { throw new Error('pipeline not expected'); };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
    `return (async () => { ${src}\n })()`);
  return fn(args, phase, log, parallel, pipeline, agent, budget).then((result) => ({ result, calls }));
}

const ONE_PHASE = { feature: 'f', phases: [{ id: 'p1', name: 'A' }] };
const APPROVED = { feature: 'f', status: 'APPROVED', findings: [] };
const VERDICT = { feature: 'f', status: 'PASS', criteria_total: 3, criteria_passed: 3 };
const partial = (tasks, commits) => ({
  feature: 'f', status: 'PARTIAL', tasks_completed: tasks, tasks_total: 6, commits,
});
const complete = (tasks, commits) => ({
  feature: 'f', status: 'COMPLETE', tasks_completed: tasks, tasks_total: 6, commits,
});
const progress = (done, pending, commits = []) => ({
  tasks_done: done, tasks_pending: pending, tasks_total: done + pending, commits, working_tree_clean: true,
});

describe('go workflow — builder continuation', () => {
  it('PARTIAL continues the phase with a fresh builder instead of stopping', async () => {
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label === 'build:p1') return partial(2, ['aaa1111', 'bbb2222']);
      if (label === 'build:p1:cont1') return partial(2, ['ccc3333']);
      if (label === 'build:p1:cont2') return complete(2, ['ddd4444']);
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'build:p1:cont1', 'build:p1:cont2', 'review:p1', 'verify']);
    assert.equal(result.stoppedAt, null, 'a turn-budget PARTIAL must not stop the run');
    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].builderRounds, 3);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('merges every round\'s commits so the reviewer sees the whole phase diff', async () => {
    let reviewPrompt = null;
    const { result } = await runWorkflow(ONE_PHASE, (label, prompt) => {
      if (label === 'build:p1') return partial(2, ['aaa1111']);
      if (label === 'build:p1:cont1') return complete(4, ['bbb2222', 'ccc3333']);
      if (label.startsWith('review')) { reviewPrompt = prompt; return APPROVED; }
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.deepEqual(result.completed[0].commits, ['aaa1111', 'bbb2222', 'ccc3333']);
    assert.ok(reviewPrompt.includes('aaa1111'), 'the oldest commit must reach the reviewer for the diff range');
    assert.equal(result.completed[0].tasksCompleted, 6, 'task counts accumulate across rounds');
  });

  it('an empty return is checked against PLAN.md, and a finished phase still completes', async () => {
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label === 'build:p1') return null; // agent died mid-turn, no structured result
      if (label === 'progress:p1') return progress(6, 0, ['aaa1111', 'bbb2222']);
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'review:p1', 'verify']);
    assert.equal(result.stoppedAt, null, 'work confirmed in PLAN.md must not read as a dead phase');
    assert.equal(result.completed[0].tasksCompleted, 6);
    assert.deepEqual(result.completed[0].commits, ['aaa1111', 'bbb2222']);
    assert.ok(result.completed[0].concerns.some((c) => /turn budget/.test(c)),
      'the silent exhaustion must still be surfaced as a concern');
  });

  it('an empty return with tasks still pending continues while progress is landing', async () => {
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label === 'build:p1') return null;
      if (label === 'progress:p1') return progress(2, 4, ['aaa1111']);
      if (label === 'build:p1:cont1') return complete(4, ['bbb2222']);
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'build:p1:cont1', 'review:p1', 'verify']);
    assert.equal(result.stoppedAt, null);
    assert.equal(result.completed[0].tasksCompleted, 6);
  });

  it('stops when a round lands nothing new — no infinite retry', async () => {
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return null;
      if (label.startsWith('progress:')) return progress(2, 4, ['aaa1111']); // stuck at 2 done
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'build:p1:cont1', 'progress:p1:cont1']);
    assert.ok(result.stoppedAt, 'a phase making no progress must stop the run');
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
    assert.equal(result.stoppedAt.build.tasks_completed, 2, 'partial progress is reported, not lost');
    assert.deepEqual(result.stoppedAt.build.commits, ['aaa1111']);
    assert.equal(result.verdict, null, 'verify must not run on an unfinished build');
  });

  it('caps continuation rounds even when every round claims progress', async () => {
    let round = 0;
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return partial(1, [`c${++round}`]);
      return null;
    });

    const buildCalls = calls.filter((c) => c.startsWith('build:'));
    assert.equal(buildCalls.length, 5, 'MAX_BUILD_ROUNDS caps the phase at 5 builders');
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
    assert.equal(result.stoppedAt.build.tasks_completed, 5, 'every landed task is still accounted for');
    assert.equal(result.stoppedAt.build.tasks_total, 6);
    assert.deepEqual(result.stoppedAt.build.commits, ['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('a builder that throws costs one round, not two (no double retry)', async () => {
    const { calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return () => { throw new Error('agent died'); };
      if (label.startsWith('progress:')) return progress(1, 5);
      return null;
    });

    assert.ok(!calls.some((c) => c.includes('build:p1:retry')),
      'the builder runs its own continuation loop — safeAgent must not also retry it');
    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'build:p1:cont1', 'progress:p1:cont1']);
  });

  it('continuation prompts tell the fresh builder to resume from PLAN.md', async () => {
    let contPrompt = null;
    await runWorkflow(ONE_PHASE, (label, prompt) => {
      if (label === 'build:p1') return partial(2, ['aaa1111']);
      if (label === 'build:p1:cont1') { contPrompt = prompt; return complete(4, ['bbb2222']); }
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.match(contPrompt, /Continue building feature: f/);
    assert.match(contPrompt, /status="done"/, 'must tell the builder to skip finished tasks');
    assert.match(contPrompt, /uncommitted changes/, 'must cover an interrupted task left in the working tree');
    assert.match(contPrompt, /aaa1111/, 'must carry the commits that already landed');
  });

  it('CHECKPOINT and NEEDS_CONTEXT still stop immediately — continuation is only for turn budget', async () => {
    for (const status of ['CHECKPOINT', 'NEEDS_CONTEXT']) {
      const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
        if (label === 'build:p1') return { feature: 'f', status, tasks_completed: 1, tasks_total: 6, commits: [] };
        return null;
      });
      assert.deepEqual(calls, ['build:p1'], `${status} must not spawn a continuation builder`);
      assert.equal(result.stoppedAt.build.status, status);
    }
  });
});

describe('builder agent — PARTIAL contract', () => {
  const builder = readSrc('agents/ship-builder.md');

  it('documents PARTIAL as a first-class status', () => {
    assert.ok(builder.includes('"PARTIAL"'), 'the build_result status enum must include PARTIAL');
    assert.match(builder, /\*\*PARTIAL\*\* — turn budget ran out/);
  });

  it('tells the builder to hand off cleanly rather than die mid-task', () => {
    assert.match(builder, /## Turn Budget/);
    assert.match(builder, /every task you touched is verified, committed/i);
  });

  it('tells a resuming builder that PLAN.md is the source of truth', () => {
    assert.match(builder, /\*\*Resuming:\*\*/);
    assert.match(builder, /skip tasks already marked `status="done"`/);
  });

  it('the workflow schema accepts the statuses the builder can emit', () => {
    const wf = readSrc('ship/workflows/go.workflow.js');
    for (const s of ['COMPLETE', 'COMPLETE_WITH_CONCERNS', 'PARTIAL', 'NEEDS_CONTEXT', 'CHECKPOINT']) {
      assert.ok(wf.includes(`'${s}'`), `BUILD_SCHEMA must accept ${s}`);
    }
  });
});

describe('manual /ship:build — same continuation semantics', () => {
  const skill = readSrc('skills/build/SKILL.md');

  it('continues while the phase is progressing instead of a fixed retry count', () => {
    assert.match(skill, /Auto-Continue While the Phase Is Progressing/);
    assert.match(skill, /PARTIAL/);
    assert.match(skill, /done-count did not increase/);
  });

  it('confirms progress from PLAN.md, not the builder self-report', () => {
    assert.match(skill, /ground truth for progress, not the builder's self-report/);
  });

  it('reports partial progress when a phase is genuinely stuck', () => {
    assert.match(skill, /## BUILDER EXHAUSTED/);
    assert.match(skill, /Completed tasks are committed/);
  });
});
