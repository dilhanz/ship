'use strict';

// Adversarial tests for verify-checklist-gate: the go workflow's downgrade
// guard on the salvage path and on malformed-but-schema-legal verdicts, and the
// scratch-record validator on edge-shaped checklist / trial_merge keys.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const goSrc = () => fs.readFileSync(path.join(ROOT, 'ship/workflows/go.workflow.js'), 'utf8');
const { parseRecord } = require('../ship/verify-scratch.cjs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// verifyCalls: array of results (or Error instances to throw) handed out in
// order to the 'verify' / 'verify:retry' calls.
const runWorkflow = async (verifyCalls) => {
  const run = new AsyncFunction(
    'args', 'agent', 'log', 'phase',
    goSrc().replace(/^export const meta/m, 'const meta'),
  );
  const logs = [];
  const seen = [];
  const queue = verifyCalls.slice();
  const agent = async (prompt, opts) => {
    const label = opts.label || '';
    seen.push(label);
    if (label.startsWith('build:')) {
      return { feature: 'demo', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
    }
    if (label.startsWith('review:')) {
      return {
        feature: 'demo', status: 'APPROVED', findings: [],
        verify_runs: [{ command: 'node --test', exit_code: 0, verdict: 'pass' }],
        files_reviewed: ['x'],
      };
    }
    if (label === 'verify' || label === 'verify:retry') {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }
    if (label.startsWith('canary')) return { ok: true };
    throw new Error(`unexpected agent call: ${label}`);
  };
  const result = await run(
    { feature: 'demo', phases: [{ id: '1', name: 'one' }] },
    agent, (m) => logs.push(m), () => {},
  );
  return { result, logs, seen };
};

const base = { feature: 'demo', criteria_total: 7, criteria_passed: 7, criteria_failed: 0, criteria_inconclusive: 0 };
const bug = { severity: 'low', category: 'logic', description: 'low bug', file: 'a.js', evidence: 'repro' };

describe('adversarial: downgrade guard', () => {
  it('a salvaged PASS carrying a bug (first verifier lost) is still downgraded', async () => {
    const { result, seen } = await runWorkflow([
      new Error('subagent completed without calling StructuredOutput'),
      { ...base, status: 'PASS', bugs: [bug], salvaged: 'adopted' },
    ]);
    assert.ok(seen.includes('verify:retry'), 'the salvage retry ran');
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'PASS');
  });

  it('the downgrade does not mutate the verifier result object', async () => {
    const original = { ...base, status: 'PASS', bugs: [bug] };
    const { result } = await runWorkflow([original]);
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(original.status, 'PASS');
    assert.equal(original.downgraded_from, undefined);
  });

  it('N/A checklist rows and a NOT_RUNNABLE trial merge do not downgrade a clean PASS', async () => {
    const { result } = await runWorkflow([{
      ...base, status: 'PASS', bugs: [],
      checklist: [
        { item: 'docs', source: 'generic', verdict: 'N/A', evidence: 'no docs touched' },
        { item: 'tz', source: 'generic', verdict: 'PASS', evidence: 'grep' },
      ],
      trial_merge: { outcome: 'NOT_RUNNABLE', target: 'main', command: 'npm test', evidence: 'red baseline' },
    }]);
    assert.equal(result.verdict.status, 'PASS');
    assert.equal(result.verdict.downgraded_from, undefined);
  });

  it('missing bugs, null trial_merge and null checklist rows do not crash the guard', async () => {
    const { result } = await runWorkflow([{
      ...base, status: 'INCONCLUSIVE', checklist: [null], trial_merge: null,
    }]);
    assert.equal(result.verdict.status, 'INCONCLUSIVE');
  });

  it('INCONCLUSIVE with a failed trial merge and no bugs is downgraded and says why', async () => {
    const { result } = await runWorkflow([{
      ...base, status: 'INCONCLUSIVE', bugs: [],
      trial_merge: { outcome: 'FAIL', target: 'origin/main', command: 'npm test', evidence: 'conflict in a.js' },
    }]);
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, 'INCONCLUSIVE');
    assert.match(result.verdict.downgrade_reason, /trial merge failed/);
    assert.doesNotMatch(result.verdict.downgrade_reason, /open bug/);
  });

  it('a FAIL verdict with bugs passes through as the same object', async () => {
    const original = { ...base, status: 'FAIL', criteria_passed: 6, criteria_failed: 1, bugs: [bug] };
    const { result } = await runWorkflow([original]);
    assert.equal(result.verdict.status, 'FAIL');
    assert.equal(result.verdict.downgraded_from, undefined);
  });
});

describe('adversarial: parseRecord edge shapes', () => {
  const rec = (extra) => JSON.stringify({
    feature: 'demo', base_head: 'a'.repeat(40), stage: 'bughunt',
    criteria: [], carried_findings: [], tests: [], ...extra,
  });

  it('accepts checklist: null and an empty checklist', () => {
    assert.equal(parseRecord(rec({ checklist: null })).ok, true);
    assert.equal(parseRecord(rec({ checklist: [] })).ok, true);
  });

  it('accepts a trial_merge with only an outcome', () => {
    assert.equal(parseRecord(rec({ trial_merge: { outcome: 'NOT_RUNNABLE' } })).ok, true);
  });

  it('rejects a trial_merge with no outcome, an array, or a string', () => {
    assert.equal(parseRecord(rec({ trial_merge: {} })).ok, false);
    assert.equal(parseRecord(rec({ trial_merge: [] })).ok, false);
    assert.equal(parseRecord(rec({ trial_merge: 'PASS' })).ok, false);
  });

  it('rejects lowercase verdicts and outcomes', () => {
    assert.equal(parseRecord(rec({ checklist: [{ item: 'x', source: 'repo', verdict: 'pass', evidence: 'e' }] })).ok, false);
    assert.equal(parseRecord(rec({ trial_merge: { outcome: 'pass' } })).ok, false);
  });

  it('rejects whitespace-only item or evidence, and array entries', () => {
    assert.equal(parseRecord(rec({ checklist: [{ item: '  ', source: 'repo', verdict: 'PASS', evidence: 'e' }] })).ok, false);
    assert.equal(parseRecord(rec({ checklist: [{ item: 'x', source: 'repo', verdict: 'N/A', evidence: ' \n' }] })).ok, false);
    assert.equal(parseRecord(rec({ checklist: [['x']] })).ok, false);
  });

  it('rejects a non-string trial_merge evidence', () => {
    assert.equal(parseRecord(rec({ trial_merge: { outcome: 'PASS', evidence: 0 } })).ok, false);
  });
});
