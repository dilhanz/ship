// Adversarial edge cases for the build-context-diet fix round 1, written by
// the ship-verifier. They pin the malformed-layout warning on the PLAN.md
// shapes the fix's own tests do not cover, and the synthetic-message skip in
// measure on an all-synthetic transcript.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { listPendingTasks } = require(path.join(ROOT, 'ship', 'plan-tasks.cjs'));
const { tick } = require(path.join(ROOT, 'ship', 'tick.cjs'));
const { measureTranscript } = require(path.join(ROOT, 'ship', 'measure.cjs'));

function fixture(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-fix1-'));
  const fdir = path.join(dir, '.planning', 'features', 'demo');
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, 'PLAN.md'), plan);
  return { dir, planPath: path.join(fdir, 'PLAN.md') };
}

const list = (plan) => listPendingTasks({ cwd: fixture(plan).dir, feature: 'demo' });

describe('plan-tasks — malformed layouts still warn', () => {
  it('warns when the last task of the plan closes inline (swallows </phase>)', () => {
    const r = list('<phase id="1" name="P" status="pending">\n<task id="1" status="pending">\n</task>\n'
      + '<task id="2" status="pending">\n  <verify>x</verify></task>\n</phase>\n');
    assert.match(r.warning || '', /task 2 \(line 4\) is never closed/);
    assert.match(r.warning, /phase 1 \(line 1\) is never closed/);
  });

  it('warns when a phase closes inline after text', () => {
    const r = list('<phase id="1" name="P" status="pending">\n<task id="1" status="pending">\n</task>\nend</phase>\n'
      + '<phase id="2" name="Q" status="pending">\n<task id="2" status="pending">\n</task>\n</phase>\n');
    assert.match(r.warning || '', /phase 2 opens while phase 1/);
  });

  it('warns on an inline close in a CRLF plan', () => {
    const r = list('<phase id="1" name="P" status="pending">\r\n<task id="1" status="pending">\r\n  <verify>a</verify></task>\r\n'
      + '<task id="2" status="pending">\r\n</task>\r\n</phase>\r\n');
    assert.match(r.warning || '', /task 2 opens inside task 1/);
  });

  it('a well-formed CRLF plan lists every task with no warning', () => {
    const r = list('<phase id="1" name="P" status="pending">\r\n<task id="1" status="pending">\r\n</task>\r\n'
      + '<task id="2" status="pending">\r\n</task>\r\n</phase>\r\n');
    assert.equal(r.warning, null);
    assert.deepEqual(r.phases[0].tasks.map((t) => t.id), ['1', '2']);
  });

  it('a single-line task followed by another phase warns rather than silently dropping task 2', () => {
    const r = list('<phase id="1" name="P" status="pending">\n<task id="1" status="pending"><name>One</name></task>\n</phase>\n'
      + '<phase id="2" name="Q" status="pending">\n<task id="2" status="pending">\n</task>\n</phase>\n');
    assert.notEqual(r.warning, null);
  });
});

describe('tick — anomaly reporting', () => {
  it('names the anomaly when the swallowed task is ticked, and leaves PLAN.md untouched', () => {
    const { dir, planPath } = fixture('<task id="1" status="pending">\n  <verify>a</verify></task>\n<task id="2" status="pending">\n</task>\n');
    const before = fs.readFileSync(planPath, 'utf8');
    const r = tick({ cwd: dir, feature: 'demo', taskId: '2', commit: 'abc1234' });
    assert.equal(r.code, 1);
    assert.match(r.line, /not found in PLAN\.md — malformed PLAN\.md: line 3: task 2 opens inside task 1/);
    assert.equal(r.line.split('\n').length, 1, 'one line');
    assert.equal(fs.readFileSync(planPath, 'utf8'), before);
  });
});

describe('measure — synthetic-only transcripts', () => {
  it('an all-synthetic transcript reports zero turns, no model and no estimate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-meas-'));
    const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const f = path.join(dir, 'a.jsonl');
    fs.writeFileSync(f, [
      { type: 'assistant', timestamp: '2026-10-01T00:00:01Z', message: { id: 's1', model: '<synthetic>', usage: zero } },
      { type: 'assistant', timestamp: '2026-10-01T00:00:02Z', message: { id: 's2', model: '<synthetic>', usage: zero } },
    ].map((l) => JSON.stringify(l)).join('\n'));
    const r = measureTranscript(f);
    assert.equal(r.turns, 0);
    assert.equal(r.model, null);
    assert.equal(r.estimated, false);
    assert.equal(r.cost, 0);
  });

  it('a synthetic message reusing a real message id does not replace it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-meas-'));
    const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const f = path.join(dir, 'a.jsonl');
    fs.writeFileSync(f, [
      { type: 'assistant', timestamp: '2026-10-01T00:00:01Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'assistant', timestamp: '2026-10-01T00:00:02Z', message: { id: 'm1', model: '<synthetic>', usage: zero } },
    ].map((l) => JSON.stringify(l)).join('\n'));
    const r = measureTranscript(f);
    assert.equal(r.turns, 1);
    assert.equal(r.model, 'claude-opus-5-5');
    assert.equal(r.output, 5);
  });
});
