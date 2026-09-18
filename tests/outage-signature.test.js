/**
 * An outage is recognised by its shape, because its message never arrives.
 *
 * v5.11.0 taught the go workflow to tell a dropped connection from a spent
 * turn budget by matching `ENOTFOUND`, `ECONNRESET` and friends in the thrown
 * message. A field audit of 114 runs (2026-09-08..18) found that classification
 * had never fired once: an agent that dies on an outage or a session limit ends
 * on a synthetic "API Error" message, and what the harness throws is the
 * generic `subagent completed without calling StructuredOutput` — the same
 * bytes a turn-cap death produces. 29 of 29 logged throws read `[agent]`, across
 * ~60 outage deaths. Three runs under a session limit spawned 41 agents burning
 * every continuation round "retrying blind"; an ENOTFOUND run burned 11.
 *
 * The signal the script *can* see is structural: a trivial read-only agent has
 * no turn budget to exhaust, so when it dies right after a long-running one,
 * the connection is what failed. On the build path that agent is the progress
 * probe; on the verify path it is a one-call canary.
 *
 * Every death below is thrown with the generic message — the only one the
 * field ever produces — so nothing here passes through TRANSPORT_PATTERNS.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const WORKFLOW = path.join(repoRoot, 'ship', 'workflows', 'go.workflow.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const GENERIC = () => new Error('agent({schema}): subagent completed without calling StructuredOutput (after in-conversation nudge)');

async function runWorkflow(handler, overrides = {}) {
  const src = fs.readFileSync(WORKFLOW, 'utf8').replace(/^export const meta/m, 'const meta');
  const run = new AsyncFunction('args', 'agent', 'log', 'phase', src);
  const labels = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || '';
    labels.push(label);
    return handler(label, opts, prompt);
  };
  const result = await run(
    { feature: 'demo', phases: [{ id: '1', name: 'one' }], ...overrides },
    agent, (m) => logs.push(String(m)), () => {}
  );
  return { result, labels, logs };
}

const COMPLETE = { feature: 'demo', status: 'COMPLETE', tasks_completed: 2, tasks_total: 2, commits: ['abc1234'] };
const APPROVED = { feature: 'demo', status: 'APPROVED', findings: [], verify_runs: [], files_reviewed: ['x'] };
const PASS = { feature: 'demo', status: 'PASS', criteria_passed: 1, criteria_total: 1, criteria_verdicts: [] };
const probe = (done, pending) => ({
  tasks_done: done, tasks_pending: pending, tasks_total: done + pending, commits: [], working_tree_clean: true,
});
const builders = (labels) => labels.filter((l) => l.startsWith('build:'));

describe('build path — builder and probe dying together is an outage', () => {
  it('stops as INFRASTRUCTURE after two blind rounds, never as EXHAUSTED', async () => {
    const { result, labels } = await runWorkflow(() => { throw GENERIC(); });

    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE',
      'the generic message is all an outage ever throws — it must still be named an outage');
    assert.equal(builders(labels).length, 2,
      'one blind retry is allowed; the second blind round is the outage');
    assert.match(result.stoppedAt.build.recommendation, /Re-run \/ship:go demo/);
    assert.doesNotMatch(result.stoppedAt.build.recommendation, /split/i,
      'an outage must never be answered with advice to resize tasks');
    assert.match(result.stoppedAt.build.reason, /progress probe both died/);
    assert.match(result.stoppedAt.build.reason, /StructuredOutput/,
      'the last error is carried so the report shows what the script actually saw');
    assert.ok(!labels.includes('verify'), 'nothing runs past an outage');
  });

  it('a larger round budget buys an outage no extra builders', async () => {
    // The field failure: `thorough` carries 8 build rounds, and a session limit
    // spent all 8 plus 8 probes. The blind cap must not scale with the profile.
    const { result, labels } = await runWorkflow(() => { throw GENERIC(); }, { maxBuildRounds: 8 });
    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE');
    assert.equal(builders(labels).length, 2);
  });

  it('a single blind round on the last permitted round is still not EXHAUSTED', async () => {
    const { result, labels } = await runWorkflow(() => { throw GENERIC(); }, { maxBuildRounds: 1 });
    assert.equal(builders(labels).length, 1);
    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE',
      'EXHAUSTED claims the tasks were too big — a run that could not read PLAN.md has no evidence of that');
  });

  it('one blind round that recovers finishes the run', async () => {
    // A laptop waking from sleep kills the agents in flight; the next succeeds.
    let n = 0;
    const { result, labels } = await runWorkflow((label) => {
      if (label.startsWith('build:')) { n += 1; if (n === 1) throw GENERIC(); return COMPLETE; }
      if (label.startsWith('progress:')) throw GENERIC();
      if (label.startsWith('review:')) return APPROVED;
      return PASS;
    });
    assert.equal(result.stoppedAt, null);
    assert.equal(result.verdict.status, 'PASS');
    assert.deepEqual(builders(labels), ['build:1', 'build:1:cont1']);
  });

  it('blind rounds must be consecutive to add up', async () => {
    // blind, sighted-with-progress, blind, complete: the probe answering in
    // between proves the connection came back, so the count restarts.
    const script = {
      'build:1': GENERIC, 'progress:1': GENERIC,
      'build:1:cont1': GENERIC, 'progress:1:cont1': () => probe(1, 1),
      'build:1:cont2': GENERIC, 'progress:1:cont2': GENERIC,
      'build:1:cont3': () => COMPLETE,
    };
    const { result } = await runWorkflow((label) => {
      const base = label.replace(/:retry$/, '');
      if (script[base]) { const out = script[base](); if (out instanceof Error) throw out; return out; }
      if (label.startsWith('review:')) return APPROVED;
      return PASS;
    });
    assert.equal(result.stoppedAt, null, 'two blind rounds split by a sighted one are not an outage');
  });

  it('a turn-cap death with a live probe is still a spent round, not an outage', async () => {
    // The generic message with the probe answering is the ordinary case: 25 of
    // 198 field builders died this way. It must keep its EXHAUSTED ending.
    const { result } = await runWorkflow((label) => {
      if (label.startsWith('build:')) throw GENERIC();
      if (label.startsWith('progress:')) return probe(1, 1);
      return PASS;
    });
    assert.equal(result.stoppedAt.build.status, 'EXHAUSTED');
    assert.match(result.stoppedAt.build.recommendation, /split/i);
  });
});

describe('verify path — a one-call canary tells an outage from a verifier failure', () => {
  const healthyBuild = (label) => {
    if (label.startsWith('build:')) return COMPLETE;
    if (label.startsWith('review:')) return APPROVED;
    return undefined;
  };

  it('verifier, salvage retry and canary all dead → INFRASTRUCTURE at verify', async () => {
    const { result, labels } = await runWorkflow((label) => {
      const out = healthyBuild(label);
      if (out) return out;
      throw GENERIC();
    });
    assert.deepEqual(labels.slice(-3), ['verify', 'verify:retry', 'canary:verify']);
    assert.equal(result.verdict, null);
    assert.equal(result.stoppedAt.phase.id, 'verify');
    assert.equal(result.stoppedAt.build.status, 'INFRASTRUCTURE');
    assert.match(result.stoppedAt.build.reason, /connection check died/);
    assert.match(result.stoppedAt.build.recommendation, /Re-run \/ship:go demo/);
  });

  it('a live canary leaves a dead verifier as a verifier failure', async () => {
    const { result } = await runWorkflow((label) => {
      const out = healthyBuild(label);
      if (out) return out;
      if (label === 'canary:verify') return { ok: true };
      throw GENERIC();
    });
    assert.equal(result.verdict, null);
    assert.equal(result.stoppedAt, null, 'two spent verifier budgets with the connection up is not an outage');
  });

  it('the canary is one attempt, and only runs when the verdict is missing', async () => {
    const dead = await runWorkflow((label) => {
      const out = healthyBuild(label);
      if (out) return out;
      throw GENERIC();
    });
    assert.equal(dead.labels.filter((l) => l.startsWith('canary')).length, 1,
      'a retried canary doubles the wait during the outage it exists to detect');

    const healthy = await runWorkflow((label) => healthyBuild(label) || PASS);
    assert.ok(!healthy.labels.some((l) => l.startsWith('canary')),
      'a run that got its verdict must not pay for a connection check');
  });

  it('the canary asks for nothing but the structured call', () => {
    const src = fs.readFileSync(WORKFLOW, 'utf8');
    const prompt = /const canaryPrompt = `([^`]+)`/.exec(src);
    assert.ok(prompt, 'canaryPrompt must exist');
    assert.match(prompt[1], /StructuredOutput/);
    assert.match(prompt[1], /Do not read files/,
      'a canary that does work can die of that work, and then proves nothing');
  });
});

describe('a spent usage window is an outage', () => {
  it('the predicate classifies the session-limit message when it does arrive', () => {
    const src = fs.readFileSync(WORKFLOW, 'utf8');
    const block = src.slice(src.indexOf('const TRANSPORT_PATTERNS'), src.indexOf('let lastFailure'));
    const isTransportError = new Function(`${block}\nreturn isTransportError`)();
    assert.equal(isTransportError(new Error("You've hit your session limit · resets 12:50pm")), true);
    assert.equal(isTransportError(new Error('usage limit reached')), true);
    assert.equal(isTransportError(GENERIC()), false,
      'the generic message alone stays unclassified — a turn-cap death throws it too');
  });
});
