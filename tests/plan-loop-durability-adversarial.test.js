/**
 * Plan-loop durability — adversarial cases for ship/workflows/plan.workflow.js.
 *
 * The happy paths live in tests/plan-loop-durability.test.js. These tests push
 * on the seams the apply-answers step introduced: the `### Round n` label
 * bookkeeping across a NEEDS_INPUT re-invocation, the review cap, the answers
 * step's own salvage retry, hostile `args` shapes the go skill could hand-build,
 * and the convergence guard once a label shift is in play.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const src = readSrc('ship/workflows/plan.workflow.js').replace('export const meta', 'const meta');

function runWorkflow(args, resolve) {
  const calls = [];
  const prompts = [];
  const agent = async (prompt, opts = {}) => {
    const raw = opts.label || '';
    calls.push(raw);
    prompts.push({ label: raw.replace(/:retry$/, ''), retry: /:retry$/.test(raw), prompt, opts });
    const out = resolve(raw, prompt);
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
  return fn(args, phase, log, parallel, pipeline, agent, budget)
    .then((result) => ({ result, calls, prompts }));
}

const clean = () => ({ feature: 'f', status: 'APPROVED', findings: [] });
const critical = (taskId, file, desc) => ({
  severity: 'CRITICAL', task_id: taskId, file, description: desc,
  evidence: `evidence for ${file}`, recommendation: `fix ${file}`,
});
const review = (...findings) => ({ feature: 'f', status: 'NEEDS-REVISION', findings });
const revised = () => ({ feature: 'f', status: 'REVISED', changes: ['x'], needs_input: [] });
const died = () => () => { throw new Error('agent died'); };
const questions = [{ question: 'Which?', options: ['a', 'b'], why_blocking: 'structure' }];

const promptsFor = (prompts, label) => prompts.filter((p) => p.label === label).map((p) => p.prompt);
const promptFor = (prompts, label) => promptsFor(prompts, label)[0];
// Every `### Round n` label a run asked a replanner to write.
const roundLabels = (prompts) => prompts
  .filter((p) => p.label.startsWith('replan:') && !p.retry)
  .map((p) => Number(/### Round (\d+)\b/.exec(p.prompt)[1]));

describe('plan-loop durability adversarial — label bookkeeping across re-invocation', () => {
  it('a NEEDS_INPUT re-invocation with answers never reuses a ### Round label', async () => {
    // Run 1: review r1 raises a CRITICAL, replan r1 escalates.
    const first = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'undecided'));
      if (label === 'replan:r1') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: questions };
      return null;
    });
    assert.equal(first.result.status, 'NEEDS_INPUT');
    const firstLabels = roundLabels(first.prompts);
    assert.deepEqual(firstLabels, [1]);

    // Run 2: the go skill threads nextRoundOffset back with the answers; the
    // answers step and a further in-loop replan both consume labels.
    const second = await runWorkflow({
      feature: 'f', answers: 'Q: Which?\nA: a', roundOffset: first.result.nextRoundOffset,
      findings: first.result.findings,
    }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('4', 'src/b.js', 'new problem'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    assert.equal(second.result.status, 'APPROVED');
    const secondLabels = roundLabels(second.prompts);
    assert.deepEqual(secondLabels, [2, 3], 'answers step takes the next label, the in-loop replan the one after');
    const all = [...firstLabels, ...secondLabels];
    assert.equal(new Set(all).size, all.length, 'no label may collide — the replanner refuses to rewrite a round');
    assert.equal(second.result.nextRoundOffset, 4, 'three labels consumed plus the final review round');
  });

  it('a second NEEDS_INPUT from the answers step itself still keeps labels monotonic on the third run', async () => {
    const second = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', roundOffset: 1 }, (label) => {
      if (label === 'replan:answers') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: questions };
      return null;
    });
    assert.equal(second.result.status, 'NEEDS_INPUT');
    assert.equal(second.result.nextRoundOffset, 2);
    assert.deepEqual(roundLabels(second.prompts), [2]);

    const third = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y\nQ: Which?\nA: a', roundOffset: second.result.nextRoundOffset }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.deepEqual(roundLabels(third.prompts), [3]);
    assert.equal(third.result.nextRoundOffset, 4);
  });
});

describe('plan-loop durability adversarial — review cap and convergence with an answers step', () => {
  it('the answers step does not consume a review round against maxPlanRounds', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', maxPlanRounds: 1 }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'boom'));
      if (label === 'replan:r1') return revised();
      return null;
    });
    assert.equal(result.status, 'UNRESOLVED', 'one review round is the cap; it ends on the review verdict');
    assert.equal(result.rounds, 1);
    assert.ok(calls.includes('replan:answers'), 'the answers step still ran before the single review');
    assert.ok(!calls.includes('replan:r1'), 'the cap fires before the replan');
    assert.equal(result.nextRoundOffset, 2);
  });

  it('a clean single review after the answers step approves under maxPlanRounds: 1', async () => {
    const { result } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', maxPlanRounds: 1 }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 1);
  });

  it('the convergence guard still fires after an answers step, with the shifted label in the replan prompt', async () => {
    const { result, prompts } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y' }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label.startsWith('plan-review:')) return review(critical('3', 'src/a.js', 'same problem'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'STUCK');
    assert.equal(result.rounds, 2, 'the same CRITICAL set survived one replan');
    assert.match(promptFor(prompts, 'replan:r1'), /### Round 2\b/);
    assert.equal(result.nextRoundOffset, 3);
    assert.equal(result.history.length, 3, 'answers entry plus two review rounds');
    assert.equal(result.history[0].step, 'answers');
  });

  it('a reviewer that dies after the answers step reports BLOCKED by reviewer with the shifted offset', async () => {
    const { result } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', roundOffset: 5 }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'boom'));
      if (label === 'replan:r1') return revised();
      if (label.startsWith('plan-review:r2')) return died();
      return null;
    });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blockedBy, 'reviewer');
    assert.equal(result.rounds, 2, 'the go skill reads plan-round-2.json from this');
    assert.equal(result.nextRoundOffset, 5 + 1 + 2, 'roundOffset + answers label + review rounds');
    assert.equal(result.history[0].step, 'answers', 'the outcome block can still render the answers line');
  });
});

describe('plan-loop durability adversarial — answers-step salvage and hostile args', () => {
  it('an answers step that throws once is retried with a salvage prompt keyed on its own record', async () => {
    const { result, prompts, calls } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', roundOffset: 2 }, (label) => {
      if (label === 'replan:answers') return died();
      if (label === 'replan:answers:retry') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    const attempts = promptsFor(prompts, 'replan:answers');
    assert.equal(attempts.length, 2);
    const salvage = attempts[1];
    assert.match(salvage, /replan-round-3\.json/, 'the answers record is named by 1 + roundOffset');
    assert.match(salvage, /### Round 3\b/);
    assert.match(salvage, /double-apply/);
    assert.match(salvage, /StructuredOutput/);
    assert.ok(!/and stop/.test(salvage));
    assert.match(salvage, /Q: x\nA: y/, 'the full answers prompt is appended for the fallback path');
    assert.equal(result.status, 'APPROVED');
    assert.deepEqual(calls, ['replan:answers', 'replan:answers:retry', 'plan-review:r1']);
  });

  it('a string roundOffset with answers is coerced, not concatenated', async () => {
    const { prompts, result } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', roundOffset: '2' }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'boom'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    assert.match(promptFor(prompts, 'replan:answers'), /### Round 3\b/);
    assert.match(promptFor(prompts, 'replan:r1'), /### Round 4\b/);
    assert.ok(!/Round 12\b|Round 121\b/.test(promptFor(prompts, 'replan:r1')), 'no string concatenation');
    assert.equal(result.nextRoundOffset, 5);
  });

  it('a non-array args.findings is ignored rather than crashing the answers prompt', async () => {
    for (const findings of ['not an array', { task_id: '1' }, 7, null]) {
      const { result, prompts } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', findings }, (label) => {
        if (label === 'replan:answers') return revised();
        if (label === 'plan-review:r1') return clean();
        return null;
      });
      assert.equal(result.status, 'APPROVED', `findings=${JSON.stringify(findings)}`);
      assert.match(promptFor(prompts, 'replan:answers'), /## Plan Review/,
        'falls back to reading the open findings from PLAN.md');
    }
  });

  it('answers-step BLOCKED / NEEDS_INPUT results still carry the seed findings for the re-invocation', async () => {
    const seed = [critical('7', 'src/store.js', 'store undecided')];
    const blocked = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', findings: seed }, (label) => {
      if (label.startsWith('replan:answers')) return died();
      return null;
    });
    assert.deepEqual(blocked.result.findings, seed);
    assert.deepEqual(blocked.result.history, [], 'nothing landed in history before the block');

    const escalated = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y', findings: seed }, (label) => {
      if (label === 'replan:answers') return { feature: 'f', status: 'NEEDS_INPUT', changes: ['partial'], needs_input: questions };
      return null;
    });
    assert.deepEqual(escalated.result.findings, seed);
    assert.deepEqual(escalated.result.changes, ['partial']);
  });

  it('JSON-string-encoded args with answers still run the answers step', async () => {
    const encoded = JSON.stringify({ feature: 'f', answers: 'Q: x\nA: y', roundOffset: 1 });
    const { calls, prompts } = await runWorkflow(encoded, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.deepEqual(calls, ['replan:answers', 'plan-review:r1']);
    assert.match(promptFor(prompts, 'replan:answers'), /### Round 2\b/);
  });

  it('the answers-step history entry carries the three fields the go skill renders from every entry', async () => {
    const { result } = await runWorkflow({ feature: 'f', answers: 'Q: x\nA: y' }, (label) => {
      if (label === 'replan:answers') return { feature: 'f', status: 'REVISED', changes: ['a', 'b'], needs_input: [] };
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    const entry = result.history[0];
    for (const key of ['round', 'reviewStatus', 'criticals', 'findings', 'changes']) {
      assert.ok(key in entry, `answers entry must carry ${key}`);
    }
    assert.equal(entry.changes.length, 2, 'the outcome block renders "Answers applied: 2 change(s)"');
    assert.equal(entry.criticals, 0);
  });
});
