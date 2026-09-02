/**
 * Adversarial coverage for ship/workflows/plan.workflow.js.
 *
 * The happy paths and each documented status live in tests/plan-loop.test.js.
 * This file attacks the edges the loop is exposed to in production: a runtime
 * that hands `args` over as an encoded string, a `safeAgent` retry that
 * actually succeeds, oscillating findings, degenerate finding shapes, and the
 * boundary between the convergence guard and the round cap.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const src = fs
  .readFileSync(path.join(repoRoot, 'ship/workflows/plan.workflow.js'), 'utf8')
  .replace('export const meta', 'const meta');

// Mirror the engine: run the script body in an async fn with the globals injected.
function runWorkflow(args, resolve) {
  const calls = [];
  const prompts = [];
  const logs = [];
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '';
    calls.push(label);
    prompts.push({ label, prompt, opts });
    const out = resolve(label, prompt);
    if (typeof out === 'function') return out();
    return out;
  };
  const phase = () => {};
  const log = (m) => logs.push(String(m));
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const pipeline = async () => { throw new Error('pipeline not expected'); };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
    `return (async () => { ${src}\n })()`);
  return fn(args, phase, log, parallel, pipeline, agent, budget)
    .then((result) => ({ result, calls, prompts, logs }));
}

const critical = (taskId, file, desc) => ({
  severity: 'CRITICAL', task_id: taskId, file, description: desc,
  evidence: `evidence for ${file}`, recommendation: `fix ${file}`,
});
const review = (...findings) => ({ feature: 'f', status: 'NEEDS-REVISION', findings });
const clean = () => ({ feature: 'f', status: 'APPROVED', findings: [] });
const revised = () => ({ feature: 'f', status: 'REVISED', changes: ['x'], needs_input: [] });
const promptFor = (prompts, label) => (prompts.find((p) => p.label === label) || {}).prompt;

describe('plan loop — args handling', () => {
  it('unwraps a JSON-string args payload from the runtime', async () => {
    const { result } = await runWorkflow(JSON.stringify({ feature: 'encoded' }), (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.feature, 'encoded', 'the feature survives one layer of encoding');
  });

  it('unwraps a double-encoded args payload', async () => {
    const { result } = await runWorkflow(JSON.stringify(JSON.stringify({ feature: 'twice' })), (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.equal(result.feature, 'twice');
  });

  it('throws a named error when feature is missing', async () => {
    await assert.rejects(
      () => runWorkflow({}, () => clean()),
      /plan\.workflow: args\.feature is required/,
    );
  });

  it('throws rather than reviewing a garbage args payload', async () => {
    await assert.rejects(() => runWorkflow('not json at all', () => clean()));
  });

  it('a missing roundOffset labels the first replan as Round 1', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'a.js', 'boom'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    assert.match(promptFor(prompts, 'replan:r1'), /### Round 1\b/);
  });
});

describe('plan loop — safeAgent behaviour', () => {
  it('a reviewer that throws once then succeeds still completes the round', async () => {
    let attempts = 0;
    const { result, calls } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label.startsWith('plan-review:')) {
        attempts += 1;
        if (attempts === 1) return () => { throw new Error('flake'); };
        return clean();
      }
      return null;
    });
    assert.equal(result.status, 'APPROVED', 'the retry rescues a flaked first attempt');
    assert.equal(attempts, 2);
    assert.ok(calls.includes('plan-review:r1:retry'), 'the retry is labelled distinctly');
  });

  it('an agent returning null (no throw) is treated as no result, not as approval', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, () => null);
    assert.equal(result.status, 'BLOCKED');
    assert.notEqual(result.status, 'APPROVED');
  });

  it('a replanner returning null after retry yields BLOCKED carrying the open findings', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('3', 'a.js', 'boom'));
      return null;
    });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.findings.length, 1);
    assert.match(result.reason, /replanner/);
    assert.ok(result.recommendation, 'a BLOCKED result always tells the user what to do next');
  });

  it('every terminal status returns a history array', async () => {
    const terminal = [];
    // BLOCKED at round 1 (history empty by construction)
    terminal.push((await runWorkflow({ feature: 'f' }, () => null)).result);
    // APPROVED
    terminal.push((await runWorkflow({ feature: 'f' }, (l) => (l === 'plan-review:r1' ? clean() : null))).result);
    // STUCK
    terminal.push((await runWorkflow({ feature: 'f' }, (l) => {
      if (l.startsWith('plan-review:')) return review(critical('3', 'a.js', 'boom'));
      if (l.startsWith('replan:')) return revised();
      return null;
    })).result);
    for (const r of terminal) {
      assert.ok(Array.isArray(r.history), `${r.status} must return a history array`);
      assert.equal(typeof r.rounds, 'number');
      assert.ok(r.rounds >= 1);
    }
  });
});

describe('plan loop — convergence guard edges', () => {
  it('findings with a null task_id still key correctly and converge on the same file', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label.startsWith('plan-review:')) return review(critical(null, 'PLAN.md', 'plan-wide gap'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'STUCK', 'null task_id normalizes to a stable key');
    assert.equal(result.rounds, 2);
  });

  it('the same file under a different task id does NOT converge (keys on both)', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f' }, (label) => {
      const m = /^plan-review:r(\d)$/.exec(label);
      if (m) return review(critical(m[1], 'same.js', 'same problem, drifting task id'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'UNRESOLVED', 'the 5-round cap is the documented backstop for a drifting task_id');
    assert.equal(calls.filter((c) => c.startsWith('plan-review:')).length, 5);
  });

  it('case and whitespace differences in a key do not defeat convergence', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('T3', 'Src/A.js', 'boom'));
      if (label === 'plan-review:r2') return review(critical(' t3 ', ' src/a.js ', 'boom again'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'STUCK', 'keys are trimmed and lowercased');
  });

  it('an oscillating A-B-A finding set never converges and hits the cap', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f' }, (label) => {
      const m = /^plan-review:r(\d)$/.exec(label);
      if (m) {
        const n = Number(m[1]);
        return review(n % 2 ? critical('1', 'a.js', 'A') : critical('2', 'b.js', 'B'));
      }
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'UNRESOLVED');
    assert.equal(result.rounds, 5);
    assert.equal(calls.filter((c) => c.startsWith('replan:')).length, 4,
      'the cap check precedes the replan — 5 reviews, at most 4 replans');
  });

  it('a strict superset of the prior CRITICAL set is progress, not convergence', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'plan-review:r2') return review(critical('1', 'a.js', 'A'), critical('2', 'b.js', 'B'));
      if (label === 'plan-review:r3') return clean();
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.rounds, 3, 'a differing set size must not trip the guard');
  });

  it('duplicate findings sharing one key still compare as a single-key set', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'), critical('1', 'a.js', 'A again'));
      if (label === 'plan-review:r2') return review(critical('1', 'a.js', 'still A'));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'STUCK', 'set semantics dedupe before comparing');
  });
});

describe('plan loop — findings and verdict handling', () => {
  it('WARNING and SUGGESTION findings never block approval and survive on the result', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') {
        return {
          feature: 'f', status: 'NEEDS-REVISION',
          examined: ['src/a.js'],
          findings: [
            { severity: 'WARNING', task_id: '1', file: 'a.js', description: 'w' },
            { severity: 'SUGGESTION', task_id: null, file: 'b.js', description: 's' },
          ],
        };
      }
      return null;
    });
    assert.equal(result.status, 'APPROVED', 'zero CRITICALs approves even on a NEEDS-REVISION verdict');
    assert.equal(result.rounds, 1);
    assert.equal(result.findings.length, 2, 'non-critical findings are reported, not dropped');
    assert.deepEqual(result.examined, ['src/a.js']);
    assert.equal(calls.filter((c) => c.startsWith('replan:')).length, 0);
  });

  it('APPROVED drops CRITICALs from findings only because there are none', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.examined, [], 'a missing examined array defaults rather than being undefined');
  });

  it('an UNRESOLVED result carries the surviving findings and a recommendation', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      const m = /^plan-review:r(\d)$/.exec(label);
      if (m) return review(critical(m[1], `f${m[1]}.js`, `p${m[1]}`));
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.equal(result.status, 'UNRESOLVED');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].file, 'f5.js');
    assert.match(result.reason, /5/);
    assert.match(result.recommendation, /\/ship:plan f/);
    assert.equal(result.history.length, 5, 'history records every round the loop actually ran');
  });

  it('history records the per-round review status and critical count', async () => {
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'), critical('2', 'b.js', 'B'));
      if (label === 'plan-review:r2') return clean();
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.deepEqual(
      result.history.map((h) => [h.round, h.reviewStatus, h.criticals]),
      [[1, 'NEEDS-REVISION', 2], [2, 'APPROVED', 0]],
    );
  });
});

describe('plan loop — escalation and prompt contracts', () => {
  it('an escalation with an empty needs_input array is treated as a normal revision', async () => {
    const { result, calls } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return { feature: 'f', status: 'NEEDS_INPUT', changes: [], needs_input: [] };
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    assert.equal(result.status, 'APPROVED', 'the loop trusts the needs_input array over the status string');
    assert.equal(calls.filter((c) => c.startsWith('plan-review:')).length, 2);
  });

  it('NEEDS_INPUT reports the round it fired on plus the findings and changes so far', async () => {
    const questions = [{ question: 'Which?', options: ['a', 'b'], why_blocking: 'structure' }];
    const { result } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return { feature: 'f', status: 'NEEDS_INPUT', changes: ['partial edit'], needs_input: questions };
      return null;
    });
    assert.equal(result.status, 'NEEDS_INPUT');
    assert.deepEqual(result.changes, ['partial edit'], 'work done before escalating is not lost');
    assert.equal(result.findings.length, 1);
    assert.equal(result.history.length, 1);
  });

  it('args.answers reach every replan prompt of the run, not just the first', async () => {
    const { prompts } = await runWorkflow({ feature: 'f', answers: 'A: postgres' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'plan-review:r2') return review(critical('2', 'b.js', 'B'));
      if (label === 'plan-review:r3') return clean();
      if (label.startsWith('replan:')) return revised();
      return null;
    });
    assert.match(promptFor(prompts, 'replan:answers'), /A: postgres/,
      'the apply-answers step runs before the first review with the transcript');
    assert.match(promptFor(prompts, 'replan:r1'), /A: postgres/);
    assert.match(promptFor(prompts, 'replan:r2'), /A: postgres/,
      'the loop restarts at round 1 on re-invocation, so answers must stay in scope');
  });

  it('no answers block is rendered when args.answers is absent', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    assert.ok(!/Answers from the user/.test(promptFor(prompts, 'replan:r1')));
  });

  it('the round-1 review prompt carries no prior-findings section', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return clean();
      return null;
    });
    const p = promptFor(prompts, 'plan-review:r1');
    assert.ok(!/previous review/i.test(p), 'round 1 has no prior round to reference');
    assert.match(p, /\.planning\/features\/f\/PLAN\.md/, 'the reviewer is told which plan to read');
    assert.match(p, /\.planning\/features\/f\/CONTEXT\.md/);
  });

  it('the re-review prompt carries the disproved-finding rule that prevents a false STUCK', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    const p = promptFor(prompts, 'plan-review:r2');
    assert.match(p, /Disproved-finding rule/i);
    assert.match(p, /no memory of that review/);
  });

  it('a null task_id renders as an em dash rather than the string "null" in prompts', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical(null, 'a.js', 'plan-wide'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return review(critical(null, 'b.js', 'other'));
      if (label === 'replan:r2') return revised();
      if (label === 'plan-review:r3') return clean();
      return null;
    });
    assert.ok(!/Task null/.test(promptFor(prompts, 'replan:r1')), 'replan prompt');
    assert.ok(!/Task null/.test(promptFor(prompts, 'plan-review:r2')), 're-review prompt');
    assert.match(promptFor(prompts, 'replan:r1'), /Task —/);
  });

  it('each agent call is dispatched to the namespaced agent type with its schema', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    const byLabel = Object.fromEntries(prompts.map((p) => [p.label, p.opts]));
    assert.equal(byLabel['plan-review:r1'].agentType, 'ship:ship-plan-reviewer');
    assert.equal(byLabel['replan:r1'].agentType, 'ship:ship-replanner');
    assert.ok(byLabel['plan-review:r1'].schema, 'the reviewer call is schema-validated');
    assert.ok(byLabel['replan:r1'].schema, 'the replan call is schema-validated');
    assert.equal(byLabel['replan:r1'].schema.required.includes('needs_input'), true,
      'needs_input is a required schema field, not left to prose');
  });

  it('the replan schema bounds needs_input options to the 2-4 AskUserQuestion accepts', async () => {
    const { prompts } = await runWorkflow({ feature: 'f' }, (label) => {
      if (label === 'plan-review:r1') return review(critical('1', 'a.js', 'A'));
      if (label === 'replan:r1') return revised();
      if (label === 'plan-review:r2') return clean();
      return null;
    });
    const schema = prompts.find((p) => p.label === 'replan:r1').opts.schema;
    const opt = schema.properties.needs_input.items.properties.options;
    assert.equal(opt.minItems, 2);
    assert.equal(opt.maxItems, 4);
    assert.deepEqual(
      schema.properties.needs_input.items.required.sort(),
      ['options', 'question', 'why_blocking'],
    );
  });

  it('the workflow never uses Date.now or Math.random (unavailable in the engine)', () => {
    assert.ok(!/Date\.now|Math\.random/.test(src),
      'non-deterministic globals would throw only in production, not under the test harness');
  });
});
