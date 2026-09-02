/**
 * Plan-loop durability — ship/workflows/plan.workflow.js.
 *
 * A 2026-09-02 audit of 59 plan-loop runs found four defects that each forced
 * a plan round to be finished by hand:
 *
 *   1. the replanner lost its structured result on 6–8 CRITICAL plans and the
 *      salvage retry (keyed on the `### Round n` subsection, written last)
 *      could not recover it — the record-keyed salvage below fixes that;
 *   2. both agents' salvage checks said "and stop", contradicting the
 *      StructuredOutput final-action rule, so a salvaged result was lost too;
 *   3. a NEEDS_INPUT answer was silently dropped when the re-invoked review
 *      approved, because answers only reached a replanner that only runs on
 *      CRITICALs — the apply-answers step runs before any review;
 *   4. a lost replan reported "still carries CRITICAL findings" and pointed at
 *      /ship:plan-verify when PLAN.md was already revised — `blockedBy` and the
 *      honest BLOCKED text route the go skill's fallback instead.
 *
 * The harness mirrors tests/plan-loop.test.js: the script body runs in an
 * async fn with the engine globals injected and `agent()` stubbed. Every call
 * is recorded as {label, prompt}; a retry appears as a second entry under the
 * same label (its raw `:retry` suffix is stripped) so a test can read the
 * salvage prompt the retry was handed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const src = readSrc('ship/workflows/plan.workflow.js').replace('export const meta', 'const meta');

// Mirror the engine: run the script body in an async fn with the globals injected.
// `resolve` is called with (rawLabel, prompt) — the raw label keeps the
// `:retry` suffix so a test can throw on the first attempt only.
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

describe('plan-loop durability — record-keyed replan salvage', () => {
  it('a replanner that throws once is retried with the scratch-record salvage prompt', async () => {
    const { result, prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return died();
      if (label === 'replan:r1:retry') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    const attempts = promptsFor(prompts, 'replan:r1');
    assert.equal(attempts.length, 2, 'the first attempt and its salvage retry');
    const salvage = attempts[1];
    assert.match(salvage, /replan-round-1\.json/, 'the retry reads the replanner scratch record');
    assert.match(salvage, /pending/, 'a partial record is resumed from its first pending finding');
    assert.match(salvage, /double-apply/, 'the danger of a blind retry is double-applied edits');
    assert.equal(result.status, 'APPROVED', 'the salvaged replan feeds a clean re-review');
    assert.equal(result.rounds, 2);
  });

  it('the salvage prompt applies roundOffset to the record name and the round label', async () => {
    const { prompts } = await runWorkflow({ feature: 'f', roundOffset: 3 }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return died();
      if (label === 'replan:r1:retry') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    const salvage = promptsFor(prompts, 'replan:r1')[1];
    assert.match(salvage, /replan-round-4\.json/, 'the record name is the ### Round label, offset included');
    assert.match(salvage, /### Round 4\b/);
    assert.ok(!/replan-round-1\.json/.test(salvage), 'the bare loop round must not leak into the record name');
  });

  it('neither salvage prompt says "and stop" — both end on StructuredOutput', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return died();
      if (label === 'plan-review:r1:retry') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return died();
      if (label === 'replan:r1:retry') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    for (const label of ['plan-review:r1', 'replan:r1']) {
      const salvage = promptsFor(prompts, label)[1];
      assert.ok(salvage, `${label} must have been retried`);
      assert.ok(!/and stop/.test(salvage),
        `${label}: "and stop" contradicts the final-action rule and loses the salvaged result`);
      assert.match(salvage, /StructuredOutput/, `${label}: the salvage must end on the StructuredOutput call`);
    }
  });
});

describe('plan-loop durability — apply-answers step', () => {
  const answers = 'Q: x\nA: y';

  it('runs replan:answers before plan-review:r1 and approves with the step in history', async () => {
    const { result, calls, prompts } = await runWorkflow({ feature: 'f', answers }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });

    assert.deepEqual(calls, ['replan:answers', 'plan-review:r1'], 'the answers are applied before any review');

    const answersPrompt = promptFor(prompts, 'replan:answers');
    assert.match(answersPrompt, /Q: x\nA: y/, 'the answers prompt carries the transcript');
    assert.match(answersPrompt, /### Round 1\b/, 'the answers step consumes the first round label');

    const reviewPrompt = promptFor(prompts, 'plan-review:r1');
    assert.match(reviewPrompt, /Q: x\nA: y/, 'the first review sees the answers');
    assert.match(reviewPrompt, /Confirm the plan reflects/, 'the reviewer is told to check they landed');

    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 1, 'the answers step is not a review round');
    assert.equal(result.history[0].step, 'answers');
    assert.equal(result.history[0].reviewStatus, 'ANSWERS_APPLIED');
    assert.equal(result.history[1].round, 1);
    assert.equal(result.nextRoundOffset, 2, 'one answers label plus one review round');
  });

  it('answers stay interpolated in the in-loop replan prompt after the answers step', async () => {
    const { prompts } = await runWorkflow({ feature: 'f', answers }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.match(promptFor(prompts, 'replan:r1'), /Q: x\nA: y/,
      'the in-loop replanner keeps the answers in scope — the step is the guarantee, not a replacement');
  });

  it('the answers step shifts every later round label by one', async () => {
    const { prompts } = await runWorkflow({ feature: 'f', answers, roundOffset: 2 }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    const answersPrompt = promptFor(prompts, 'replan:answers');
    assert.match(answersPrompt, /### Round 3\b/, 'the answers label is 1 + roundOffset');
    assert.match(answersPrompt, /replan-round-3\.json/, 'its scratch record carries the same number');

    const replanPrompt = promptFor(prompts, 'replan:r1');
    assert.match(replanPrompt, /### Round 4\b/, 'the first in-loop replan must not collide with the answers label');
    assert.match(replanPrompt, /replan-round-4\.json/);
    assert.ok(!/### Round 3\b/.test(replanPrompt));
  });

  it('lists args.findings in the answers prompt, or points at PLAN.md when absent', async () => {
    const seed = [critical('7', 'src/store.js', 'store undecided')];
    const withSeed = await runWorkflow({ feature: 'f', answers, findings: seed }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    const seeded = promptFor(withSeed.prompts, 'replan:answers');
    assert.match(seeded, /\[CRITICAL\] Task 7 \/ src\/store\.js — store undecided/);
    assert.match(seeded, /fix: fix src\/store\.js/);

    const withoutSeed = await runWorkflow({ feature: 'f', answers }, (label) => {
      if (label === 'replan:answers') return revised();
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    const unseeded = promptFor(withoutSeed.prompts, 'replan:answers');
    assert.match(unseeded, /## Plan Review/, 'with no findings passed, the replanner reads the open ones from PLAN.md');
    assert.ok(!/src\/store\.js/.test(unseeded));
  });

  it('an answers-step escalation returns NEEDS_INPUT at round 0 without a review', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f', answers }, (label) => {
      if (label === 'replan:answers') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: questions };
      return null;
    });

    assert.equal(result.status, 'NEEDS_INPUT');
    assert.equal(result.rounds, 0);
    assert.deepEqual(result.questions, questions);
    assert.ok(!calls.includes('plan-review:r1'), 'no review runs after an escalation');
    assert.equal(result.nextRoundOffset, 1, 'the answers label was consumed');
  });

  it('an answers step that dies twice returns BLOCKED by answers', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f', answers }, (label) => {
      if (label.startsWith('replan:answers')) return died();
      return null;
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blockedBy, 'answers');
    assert.equal(result.rounds, 0);
    assert.match(result.reason, /replan-round-1\.json/, 'the report points at the record for what landed');
    assert.match(result.recommendation, /\/ship:go/);
    assert.ok(!calls.includes('plan-review:r1'));
  });

  it('without answers the flow is unchanged: no answers step, no step entries, Round 1 label', async () => {
    const { result, calls, prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.ok(!calls.includes('replan:answers'));
    assert.equal(calls[0], 'plan-review:r1');
    assert.match(promptFor(prompts, 'replan:r1'), /### Round 1\b/);
    assert.ok(!/Confirm the plan reflects/.test(promptFor(prompts, 'plan-review:r1')));
    assert.ok(result.history.every((h) => !('step' in h)), 'history carries no answers entry');
  });
});

describe('plan-loop durability — result fields', () => {
  it('BLOCKED names who blocked it', async () => {
    const reviewerDied = await runWorkflow({ feature: 'f' }, (label) => {
      if (label.startsWith('plan-review:')) return died();
      return null;
    });
    assert.equal(reviewerDied.result.status, 'BLOCKED');
    assert.equal(reviewerDied.result.blockedBy, 'reviewer');

    const replannerDied = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label.startsWith('replan:')) return died();
      return null;
    });
    assert.equal(replannerDied.result.status, 'BLOCKED');
    assert.equal(replannerDied.result.blockedBy, 'replanner');
  });

  it('a lost replan tells the truth: PLAN.md may be revised, re-run /ship:go', async () => {
    const { result } = await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label.startsWith('replan:')) return died();
      return null;
    });

    assert.match(result.reason, /may already be partly or fully revised/);
    assert.match(result.reason, /replan-round-3\.json/, 'the record name carries the offset label');
    assert.match(result.recommendation, /\/ship:go/);
    assert.ok(!/plan-verify/.test(result.recommendation),
      'a manual review of a half-revised plan is the wrong remedy — the retry salvages the record');
  });

  it('nextRoundOffset is on every terminal result and equals roundOffset + rounds without an answers step', async () => {
    const results = [];

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    })).result);

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label.startsWith('plan-review:')) return review(critical('3', 'src/a.js', 'boom'));
      if (label.startsWith('replan:')) return revised();
      return null;
    })).result);

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      const m = /^plan-review:r(\d)$/.exec(label);
      if (m) return review(critical(m[1], `src/f${m[1]}.js`, `problem ${m[1]}`));
      if (label.startsWith('replan:')) return revised();
      return null;
    })).result);

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'boom'));
      if (label === 'replan:r1') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: questions };
      return null;
    })).result);

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label.startsWith('plan-review:')) return died();
      return null;
    })).result);

    results.push((await runWorkflow({ feature: 'f', roundOffset: 2 }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'boom'));
      if (label.startsWith('replan:')) return died();
      return null;
    })).result);

    assert.deepEqual(results.map((r) => r.status),
      ['APPROVED', 'STUCK', 'UNRESOLVED', 'NEEDS_INPUT', 'BLOCKED', 'BLOCKED']);
    for (const r of results) {
      assert.equal(typeof r.nextRoundOffset, 'number', `${r.status} must carry nextRoundOffset`);
      assert.equal(r.nextRoundOffset, 2 + r.rounds,
        `${r.status}: nextRoundOffset counts the labels consumed so far`);
    }
  });
});
