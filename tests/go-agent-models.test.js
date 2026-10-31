/**
 * Every agent() call in go.workflow.js names its model.
 *
 * An agent call without `model` inherits the session's model, so a run started
 * on Opus pays Opus rates for a read-only progress probe and a one-call canary.
 * The map: `progress:`, `sync:` and `canary:` run on Sonnet; builders, the fix
 * builder, reviewers and the verifier run on Opus.
 *
 * Two guards: a runtime one that drives the golden scenarios and checks the
 * model each call actually carried, and a static one that fails on any new
 * `safeAgent(` call whose options object omits `model:`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { run, SCENARIOS, shapeToday, shapePerPhase, WORKFLOW } = require('./go-per-phase-golden.test.js');

const SONNET_PREFIXES = ['progress:', 'sync:', 'canary:'];
const expectedModel = (label) => (SONNET_PREFIXES.some((p) => label.startsWith(p)) ? 'sonnet' : 'opus');

// Every `safeAgent(` call site, as the text of its options object (from the
// first `{` after the call to its matching `}`). Returns the calls that lack
// `model:`, identified by their label line.
function callsMissingModel(src) {
  const missing = [];
  const calls = [];
  const re = /safeAgent\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = src.slice(open, end + 1);
    calls.push(body);
    if (!/\bmodel:/.test(body)) {
      const label = (body.match(/label:\s*([^,\n]+)/) || [null, '<no label>'])[1];
      missing.push(label.trim());
    }
  }
  return { calls, missing };
}

describe('go workflow — every agent call names a model (runtime)', () => {
  const src = fs.readFileSync(WORKFLOW, 'utf8');
  for (const shape of [['today', shapeToday], ['per-phase', shapePerPhase]]) {
    for (const s of SCENARIOS) {
      it(`${s.name} (${shape[0]}): each call carries the mapped model`, async () => {
        const { calls } = await run(src, shape[1](s.args), s.resolve);
        assert.ok(calls.length > 0);
        for (const c of calls) {
          assert.ok(['opus', 'sonnet'].includes(c.model), `${c.label} carried model ${c.model}`);
          assert.equal(c.model, expectedModel(c.label), `${c.label} should run on ${expectedModel(c.label)}`);
        }
      });
    }
  }
});

describe('go workflow — every agent call names a model (static)', () => {
  const src = fs.readFileSync(WORKFLOW, 'utf8');

  it('finds the call sites and none omits model', () => {
    const { calls, missing } = callsMissingModel(src);
    assert.ok(calls.length >= 7, `expected at least 7 safeAgent calls, found ${calls.length}`);
    assert.deepEqual(missing, []);
  });

  it('reports a call whose model line is removed', () => {
    const line = "      model: 'sonnet',\n";
    assert.ok(src.includes(line), 'the sync:main call carries its model on its own line');
    const { missing } = callsMissingModel(src.replace(line, ''));
    assert.equal(missing.length, 1);
    assert.match(missing[0], /sync:main/);
  });
});
