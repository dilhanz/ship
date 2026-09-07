/**
 * Uncommitted work is the one thing a turn cap can destroy.
 *
 * Everything else a dead builder leaves behind survives: committed tasks are in
 * the history, done tasks are in PLAN.md, and a fresh builder resumes from
 * both. Work that exists only in the working tree is invisible to all of it —
 * the progress probe counts done tasks, so a builder cut off between `git add`
 * and `git commit` reads as a round that achieved nothing, and the phase stops
 * on top of finished, verified code.
 *
 * That is not a hypothetical: an admin-quotes phase-4 builder wrote a page, its
 * test, and six registration edits, went green, spent its last turn on
 * `git add ... && git status`, and died before the commit. The phase was
 * declared EXHAUSTED, the run escalated to a human, and the work sat staged for
 * two hours until someone told a fresh session to commit it.
 *
 * Two halves are tested here: the workflow grants one salvage round when a dead
 * builder leaves the tree dirty, and the builder is told to commit atomically so
 * the salvage is rarely needed in the first place.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const src = readSrc('ship/workflows/go.workflow.js').replace('export const meta', 'const meta');

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
const APPROVED = { feature: 'f', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: [] };
const VERDICT = { feature: 'f', status: 'PASS', criteria_total: 3, criteria_passed: 3 };
const complete = (tasks, commits) => ({
  feature: 'f', status: 'COMPLETE', tasks_completed: tasks, tasks_total: 6, commits,
});
const probe = (done, pending, clean, commits = []) => ({
  tasks_done: done, tasks_pending: pending, tasks_total: done + pending, commits,
  working_tree_clean: clean,
});

describe('go workflow — the dirty-tree salvage round', () => {
  it('grants one more builder when a round lands nothing but leaves the tree dirty', async () => {
    // Round 2 landed no new done task, but the tree is dirty: that is a task
    // finished and staged by a builder that died before committing it, not a
    // stuck phase. The old rule counted only done tasks and stopped here.
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label === 'build:p1') return null;
      if (label === 'progress:p1') return probe(2, 4, true, ['aaa1111']);
      if (label === 'build:p1:cont1') return null;
      if (label === 'progress:p1:cont1') return probe(2, 4, false, ['aaa1111']);
      if (label === 'build:p1:cont2') return complete(4, ['bbb2222']);
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.deepEqual(calls, [
      'build:p1', 'progress:p1',
      'build:p1:cont1', 'progress:p1:cont1',
      'build:p1:cont2', 'review:p1', 'verify',
    ]);
    assert.equal(result.stoppedAt, null, 'the salvaged phase must finish the run');
    assert.equal(result.completed[0].tasksCompleted, 6);
    assert.deepEqual(result.completed[0].commits, ['aaa1111', 'bbb2222']);
  });

  it('records the salvage as a concern, so it is visible rather than silent', async () => {
    const { result } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:p1:cont2')) return complete(4, ['bbb2222']);
      if (label.startsWith('build:')) return null;
      if (label === 'progress:p1') return probe(2, 4, true);
      if (label.startsWith('progress:')) return probe(2, 4, false);
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.ok(
      result.completed[0].concerns.some((c) => /uncommitted work/.test(c)),
      'a phase that needed the salvage round must say so in its concerns',
    );
  });

  it('tells the salvage builder that committing the interrupted work comes first', async () => {
    let salvagePrompt = null;
    await runWorkflow(ONE_PHASE, (label, prompt) => {
      if (label === 'build:p1') return null;
      if (label === 'progress:p1') return probe(2, 4, true);
      if (label === 'build:p1:cont1') return null;
      if (label === 'progress:p1:cont1') return probe(2, 4, false);
      if (label === 'build:p1:cont2') { salvagePrompt = prompt; return complete(4, ['bbb2222']); }
      if (label.startsWith('review')) return APPROVED;
      if (label === 'verify') return VERDICT;
      return null;
    });

    assert.match(salvagePrompt, /uncommitted changes in the working tree/);
    assert.match(salvagePrompt, /only round that will do it/,
      'the builder must know this is the work’s last chance, not a routine continuation');
  });

  it('grants the salvage once — a still-dirty tree stops the phase instead of looping', async () => {
    // The guard that keeps a genuinely stuck phase from eating the whole round
    // budget: whatever is in that tree, a second builder did not commit it
    // either, so it is not an interrupted commit.
    const { result, calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return null;
      if (label.startsWith('progress:')) return probe(2, 4, false, ['aaa1111']);
      return null;
    });

    assert.deepEqual(calls, [
      'build:p1', 'progress:p1',
      'build:p1:cont1', 'progress:p1:cont1',
      'build:p1:cont2', 'progress:p1:cont2',
    ], 'exactly one extra round, then stop');
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
    assert.equal(result.stoppedAt.build.tasks_completed, 2, 'landed work is still reported');
  });

  it('a clean tree with no progress still stops on the spot', async () => {
    // The unchanged case: nothing to salvage means nothing to spend a round on.
    const { calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return null;
      if (label.startsWith('progress:')) return probe(2, 4, true, ['aaa1111']);
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'build:p1:cont1', 'progress:p1:cont1']);
  });

  it('a probe that omits working_tree_clean is not treated as dirty', async () => {
    // The field is optional in PROGRESS_SCHEMA. Absent means unknown, and
    // unknown must not buy a round — only an explicit `false` does.
    const { calls } = await runWorkflow(ONE_PHASE, (label) => {
      if (label.startsWith('build:')) return null;
      if (label.startsWith('progress:')) return { tasks_done: 2, tasks_pending: 4, tasks_total: 6 };
      return null;
    });

    assert.deepEqual(calls, ['build:p1', 'progress:p1', 'build:p1:cont1', 'progress:p1:cont1']);
  });
});

describe('builder — the commit is atomic', () => {
  const builder = readSrc('agents/ship-builder.md');
  const commits = readSrc('skills/git-commits/SKILL.md');

  it('the git-commits template is one command, not two lines', () => {
    const template = commits.slice(commits.indexOf('## Command Template'));
    assert.match(template, /git add .* && git commit -m/,
      'the template is what the builder copies — a two-line one produces a two-turn commit');
    assert.doesNotMatch(template, /git add [^\n]*\n+git commit/,
      'add and commit must not appear on separate lines of the template');
  });

  it('the git-commits skill states the rule and its consequence', () => {
    assert.match(commits, /Stage and commit in ONE command/);
    assert.match(commits, /staged and uncommitted/,
      'the rule must name the failure it prevents, or it reads as style');
  });

  it('the builder commits the moment verify passes, before anything else', () => {
    assert.match(builder, /git add \{files\} && git commit/);
    assert.match(builder, /Uncommitted work at the end is the one unrecoverable failure/);
  });

  it('the builder is told not to estimate a turn counter it cannot see', () => {
    assert.match(builder, /cannot see your turn counter/i);
  });
});
