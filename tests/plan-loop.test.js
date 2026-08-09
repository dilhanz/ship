/**
 * The plan revision loop in ship/workflows/plan.workflow.js.
 *
 * The loop reviews a plan, hands surviving CRITICAL findings to a replanner,
 * and re-reviews — up to 5 rounds, stopping early when a round's CRITICAL set
 * repeats (STUCK) or the replanner escalates (NEEDS_INPUT). Every branch is
 * driven here through a stubbed agent(), plus the cross-file wiring that keeps
 * the workflow's schemas in agreement with the agents and skills that use them.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const src = readSrc('ship/workflows/plan.workflow.js').replace('export const meta', 'const meta');

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

const ARGS = { feature: 'f' };

const clean = () => ({ feature: 'f', status: 'APPROVED', findings: [] });
const critical = (taskId, file, desc) => ({
  severity: 'CRITICAL', task_id: taskId, file, description: desc,
  evidence: `evidence for ${file}`, recommendation: `fix ${file}`,
});
const review = (...findings) => ({ feature: 'f', status: 'NEEDS-REVISION', findings });
const revised = () => ({ feature: 'f', status: 'REVISED', changes: ['x'], needs_input: [] });

const reviews = (calls) => calls.filter((c) => c.startsWith('plan-review:'));
const replans = (calls) => calls.filter((c) => c.startsWith('replan:'));

describe('plan loop — control flow', () => {
  it('a clean round 1 approves without ever invoking a replanner', async () => {
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    });

    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 1);
    assert.equal(replans(calls).length, 0, 'a clean plan must not be replanned');
  });

  it('CRITICALs then a clean re-review approves at round 2 with one replan', async () => {
    let replanPrompt = null;
    const { result, calls } = await runWorkflow(ARGS, (label, prompt) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') { replanPrompt = prompt; return revised(); }
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 2);
    assert.equal(replans(calls).length, 1, 'exactly one replan round');
    assert.match(replanPrompt, /src\/a\.js/, 'the replan prompt carries the finding file');
    assert.match(replanPrompt, /missing import/, 'the replan prompt carries the finding description');
  });

  it('the same CRITICAL set twice returns STUCK with the remaining rounds unspent', async () => {
    const same = () => review(critical('3', 'src/a.js', 'missing import'));
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      if (label.startsWith('plan-review:')) return same();
      if (label.startsWith('replan:')) return revised();
      return null;
    });

    assert.equal(result.status, 'STUCK');
    assert.equal(result.rounds, 2);
    assert.equal(reviews(calls).length, 2, 'the loop stops the moment it converges');
    assert.equal(result.findings.length, 1);
  });

  it('a reworded description for the same task and file still converges', async () => {
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'plan-review:r2') return review(critical('3', 'src/a.js', 'the import is absent'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });

    assert.equal(result.status, 'STUCK', 'convergence keys on task_id + file, not description');
    assert.equal(result.rounds, 2);
    assert.equal(reviews(calls).length, 2);
  });

  it('a different CRITICAL every round exhausts the cap and returns UNRESOLVED', async () => {
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      const m = /^plan-review:r(\d)$/.exec(label);
      if (m) return review(critical(m[1], `src/f${m[1]}.js`, `problem ${m[1]}`));
      if (label.startsWith('replan:')) return revised();
      return null;
    });

    assert.equal(result.status, 'UNRESOLVED');
    assert.equal(result.rounds, 5);
    assert.equal(reviews(calls).length, 5, '5 reviews');
    assert.equal(replans(calls).length, 4, 'at most 4 replans — the cap check precedes the replan');
    assert.deepEqual(result.findings.map((f) => f.file), ['src/f5.js'], 'round 5 findings survive');
  });

  it('a non-empty needs_input returns NEEDS_INPUT and runs no further review', async () => {
    const questions = [{
      question: 'Which store?', options: ['sqlite', 'postgres'], why_blocking: 'changes the schema task',
    }];
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'undecided store'));
      if (label === 'replan:r1') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: questions };
      return null;
    });

    assert.equal(result.status, 'NEEDS_INPUT');
    assert.equal(result.rounds, 1);
    assert.deepEqual(result.questions, questions);
    assert.equal(reviews(calls).length, 1, 'no review runs after an escalation');
  });

  it('re-invocation with args.answers puts them verbatim in the replan prompt', async () => {
    let replanPrompt = null;
    await runWorkflow({ feature: 'f', answers: 'Q: Which store? A: postgres' }, (label, prompt) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'undecided store'));
      if (label === 'replan:r1') { replanPrompt = prompt; return revised(); }
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.match(replanPrompt, /Q: Which store\? A: postgres/);
    assert.match(replanPrompt, /Answers from the user/);
  });

  it('the round-2 review prompt embeds prior CRITICALs and scopes the review', async () => {
    let rereviewPrompt = null;
    await runWorkflow(ARGS, (label, prompt) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') { rereviewPrompt = prompt; return clean(); }
      return null;
    });

    assert.match(rereviewPrompt, /missing import/, 'prior CRITICALs are carried into the fresh reviewer');
    assert.match(rereviewPrompt, /src\/a\.js/);
    assert.match(rereviewPrompt, /would actually break the build/, 'new findings are scoped');
  });

  it('a reviewer that throws on both attempts returns BLOCKED, never APPROVED', async () => {
    const { result } = await runWorkflow(ARGS, (label) => {
      if (label.startsWith('plan-review:')) return () => { throw new Error('agent died'); };
      return null;
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.rounds, 1);
    assert.deepEqual(result.findings, [], 'a round-1 BLOCKED reports no findings rather than crashing');
    assert.deepEqual(result.history, []);
  });

  it('a replanner that throws on both attempts returns BLOCKED with the open findings', async () => {
    const { result } = await runWorkflow(ARGS, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label.startsWith('replan:')) return () => { throw new Error('agent died'); };
      return null;
    });

    assert.equal(result.status, 'BLOCKED');
    assert.notEqual(result.status, 'APPROVED');
    assert.equal(result.findings.length, 1);
    assert.equal(result.history.length, 1, 'the workflow keeps its own round record');
  });

  it('a CRITICAL finding beats an APPROVED verdict', async () => {
    const { result } = await runWorkflow(ARGS, (label) => {
      if (label === 'plan-review:r1') {
        return { feature: 'f', status: 'APPROVED', findings: [critical('3', 'src/a.js', 'missing import')] };
      }
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 2, 'round 1 did not approve despite the verdict — the CRITICAL was replanned');
  });

  it('roundOffset shifts only the replanner history label, not the round count', async () => {
    let replanPrompt = null;
    const { result } = await runWorkflow({ feature: 'f', roundOffset: 3 }, (label, prompt) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') { replanPrompt = prompt; return revised(); }
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.match(replanPrompt, /### Round 4/, 're-invoked rounds must not collide with earlier subsections');
    assert.ok(!/### Round 1\b/.test(replanPrompt));
    assert.equal(result.rounds, 2, 'the returned round count stays 1-based and offset-free');
  });

  it('coerces a string roundOffset instead of string-concatenating the label', async () => {
    let replanPrompt = null;
    await runWorkflow({ feature: 'f', roundOffset: '3' }, (label, prompt) => {
      if (label === 'plan-review:r1') return review(critical('3', 'src/a.js', 'missing import'));
      if (label === 'replan:r1') { replanPrompt = prompt; return revised(); }
      if (label === 'plan-review:r2') return clean();
      return null;
    });

    assert.match(replanPrompt, /### Round 4/, 'a string offset must add, not concatenate');
    assert.ok(!/### Round 13/.test(replanPrompt));
  });

  it('blocks instead of throwing when a review result arrives without a findings array', async () => {
    const { result, calls } = await runWorkflow(ARGS, (label) => {
      if (label.startsWith('plan-review:')) return { feature: 'f', status: 'APPROVED' };
      return null;
    });

    assert.equal(result.status, 'BLOCKED', 'an incomplete review must never approve the plan');
    assert.match(result.reason, /no findings array/);
    assert.equal(replans(calls).length, 0, 'a malformed review must not trigger a replan');
  });
});

describe('plan loop — agent and skill wiring', () => {
  it('ship-plan-reviewer carries the plan_review_result contract the schema expects', () => {
    const c = readSrc('agents/ship-plan-reviewer.md');
    assert.match(c, /^name: ship-plan-reviewer$/m);
    assert.ok(c.includes('plan_review_result'), 'the result block tag is the workflow contract');
    for (const field of ['feature', 'status', 'examined', 'findings', 'task_id', 'file', 'description', 'evidence', 'recommendation']) {
      assert.ok(c.includes(field), `the reviewer contract must name ${field}`);
    }
    for (const severity of ['CRITICAL', 'WARNING', 'SUGGESTION']) {
      assert.ok(c.includes(severity), `PLAN_REVIEW_SCHEMA accepts ${severity}`);
    }
    assert.ok(c.includes('NEEDS-REVISION') && c.includes('APPROVED'), 'both verdicts the schema enumerates');
  });

  it('ship-replanner is gated to PLAN.md and requires structured needs_input', () => {
    const c = readSrc('agents/ship-replanner.md');
    assert.match(c, /^name: ship-replanner$/m);
    assert.ok(/never modify CONTEXT\.md/i.test(c), 'CONTEXT.md is human-owned brainstorm output');
    assert.ok(c.includes('HARD-GATE'), 'the write gate is a hard gate');
    assert.ok(c.includes('replan_result'), 'the result block tag is the workflow contract');
    for (const field of ['needs_input', 'question', 'options', 'why_blocking', 'changes', 'addressed']) {
      assert.ok(c.includes(field), `the replanner contract must name ${field}`);
    }
    assert.ok(c.includes('REVISED') && c.includes('NEEDS_INPUT'), 'both statuses the schema enumerates');
  });

  it('plan-verify delegates to the agent and keeps no inline reviewer checklist', () => {
    const c = readSrc('skills/plan-verify/SKILL.md');
    assert.ok(c.includes('ship-plan-reviewer'), 'the skill delegates to the agent');
    assert.ok(!/Mechanical grounding/i.test(c), 'the checklist lives only in the agent now');
    assert.ok(!/do not police document format/i.test(c), 'no duplicated prompt content');
  });

  it('the go skill wires the plan workflow and branches on every status it can return', () => {
    const c = readSrc('skills/go/SKILL.md');
    assert.ok(c.includes('plan.workflow.js'), 'the planned row invokes the loop');
    assert.ok(c.includes('--auto'), 'the build-approval gate can be skipped');
    for (const status of ['APPROVED', 'NEEDS_INPUT', 'STUCK', 'UNRESOLVED', 'BLOCKED']) {
      assert.ok(c.includes(status), `the go skill must branch on ${status}`);
    }
  });
});
