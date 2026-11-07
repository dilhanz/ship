'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'ship', 'measure.cjs');
const { measureSessions, PRICES } = require(SCRIPT);

function assistant({ id, model, ts, usage }) {
  return JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model, role: 'assistant', usage } });
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// Hand-computed fixture.
//   main (opus): m1 = 100*4 + 1000*5 (5m cache write, no breakdown) + 50*20 = 6400 -> $0.0064
//                m2 (last duplicate wins) = 200*4 + 1000*0.20 + 30*20 = 1600 -> $0.0016
//                turns 2, peak 1200, reread 1000, output 80, cost 0.008
//   build:phase-1 (sonnet): 10*2 + 500*2.5 + 1500*4 + 3000*0.20 + 100*10 = 8870 -> $0.00887
//                turns 1, peak 5010, reread 3000, output 100
//   agent-xyz (unknown model, priced as opus): 1000*4 + 1000*20 = 24000 -> $0.024
//   TOTAL: turns 4, peak 5010, reread 4000, output 1180, cost 0.04087
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-measure-'));
  const proj = path.join(root, '-Users-me-proj');
  writeLines(path.join(proj, 'sess-1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'hi' } }),
    'this line is not json {',
    assistant({ id: 'm1', model: 'claude-opus-5-5', ts: '2026-10-01T00:00:01Z',
      usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 50 } }),
    assistant({ id: 'm2', model: 'claude-opus-5-5', ts: '2026-10-01T00:00:05Z',
      usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 10 } }),
    assistant({ id: 'm2', model: 'claude-opus-5-5', ts: '2026-10-01T00:00:06Z',
      usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 30 } }),
  ]);
  const wf = path.join(proj, 'sess-1', 'subagents', 'workflows', 'wf-1');
  writeLines(path.join(wf, 'agent-a1.jsonl'), [
    assistant({ id: 'a1', model: 'claude-sonnet-5-5', ts: '2026-10-01T00:00:02Z',
      usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000, output_tokens: 100,
        cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } } }),
  ]);
  fs.writeFileSync(path.join(wf, 'agent-a1.meta.json'), JSON.stringify({ description: 'build:phase-1', agentType: 'ship-builder' }));
  writeLines(path.join(proj, 'sess-1', 'subagents', 'agent-xyz.jsonl'), [
    assistant({ id: 'x1', model: 'claude-foo-1', ts: '2026-10-01T00:00:03Z',
      usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1000 } }),
  ]);
  // A second session for the multi-session grand total.
  writeLines(path.join(proj, 'sess-2.jsonl'), [
    assistant({ id: 'n1', model: 'claude-haiku-5-5', ts: '2026-10-02T00:00:00Z',
      usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000, output_tokens: 1000 } }),
  ]);
  return root;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

const near = (actual, expected) => assert.equal(actual.toFixed(4), expected.toFixed(4));

test('PRICES carries the three 5.5 models', () => {
  assert.deepEqual(Object.keys(PRICES).sort(), ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
});

test('measureSessions computes turns, peak, re-read and cost per agent', () => {
  const projectsDir = makeFixture();
  const r = measureSessions({ sessionIds: ['sess-1'], projectsDir });
  assert.equal(r.ok, true);
  const s = r.sessions[0];
  assert.equal(s.id, 'sess-1');
  assert.deepEqual(s.agents.map(a => a.label), ['main', 'build:phase-1', 'agent-xyz']);

  const [main, build, unknown] = s.agents;
  assert.equal(main.turns, 2);
  assert.equal(main.peak, 1200);
  assert.equal(main.reread, 1000);
  assert.equal(main.output, 80);
  assert.equal(main.model, 'claude-opus-5-5');
  near(main.cost, 0.008);
  assert.equal(main.estimated, false);

  assert.equal(build.turns, 1);
  assert.equal(build.peak, 5010);
  assert.equal(build.model, 'claude-sonnet-5-5');
  near(build.cost, 0.00887);

  assert.equal(unknown.model, 'claude-foo-1');
  near(unknown.cost, 0.024);
  assert.equal(unknown.estimated, true);

  assert.equal(s.total.turns, 4);
  assert.equal(s.total.peak, 5010);
  assert.equal(s.total.reread, 4000);
  assert.equal(s.total.output, 1180);
  near(s.total.cost, 0.04087);
});

test('CLI table prints one row per agent and a TOTAL row', () => {
  const projectsDir = makeFixture();
  const r = run(['sess-1', '--projects-dir', projectsDir]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  const rowOf = label => lines.find(l => l.trimStart().startsWith(label + ' '));
  assert.ok(rowOf('main'));
  assert.ok(rowOf('build:phase-1'));
  assert.match(rowOf('agent-xyz'), /0\.0240~/);
  const total = rowOf('TOTAL');
  assert.ok(total, r.stdout);
  assert.match(total, /\b4\b/);
  assert.match(total, /5010/);
  assert.match(total, /4000/);
  assert.match(total, /1180/);
  assert.match(total, /0\.0409/);
});

test('CLI --json shape, with a grand total across sessions', () => {
  const projectsDir = makeFixture();
  const r = run(['sess-1', 'sess-2', '--projects-dir', projectsDir, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).sort(), ['sessions', 'total']);
  assert.deepEqual(out.sessions.map(s => s.id), ['sess-1', 'sess-2']);
  for (const s of out.sessions) {
    assert.ok(Array.isArray(s.agents));
    for (const k of ['turns', 'peak', 'reread', 'output', 'cost']) assert.equal(typeof s.total[k], 'number');
  }
  // sess-2 haiku: 1000*0.10 + 2000*0.01 + 1000*0.50 = 620 -> $0.00062
  near(out.sessions[1].total.cost, 0.00062);
  assert.equal(out.total.turns, 5);
  assert.equal(out.total.peak, 5010);
  assert.equal(out.total.reread, 6000);
  near(out.total.cost, 0.04149);
});

test('CLI grand TOTAL row for multiple sessions', () => {
  const projectsDir = makeFixture();
  const r = run(['sess-1', 'sess-2', '--projects-dir', projectsDir]);
  assert.equal(r.status, 0, r.stderr);
  const totals = r.stdout.split('\n').filter(l => /^\s*TOTAL\b/.test(l));
  assert.equal(totals.length, 3, r.stdout);
  assert.match(totals[2], /0\.0415/);
});

test('missing session exits 1 with one line', () => {
  const projectsDir = makeFixture();
  const r = run(['nope', '--projects-dir', projectsDir]);
  assert.equal(r.status, 1);
  const out = (r.stdout + r.stderr).trim().split('\n');
  assert.equal(out.length, 1);
  assert.equal(out[0], `measure: session nope not found under ${projectsDir}`);
});

test('invalid session id exits 1', () => {
  const projectsDir = makeFixture();
  const r = run(['../etc', '--projects-dir', projectsDir]);
  assert.equal(r.status, 1);
  assert.equal((r.stdout + r.stderr).trim(), "measure: invalid session id '../etc'");
});

test('synthetic zero-usage messages add no turn, no estimate and never set the model', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-measure-synth-'));
  try {
    const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    writeLines(path.join(root, '-p', 'sess-s.jsonl'), [
      assistant({ id: 'r1', model: 'claude-opus-5-5', ts: '2026-10-01T00:00:01Z',
        usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } }),
      assistant({ id: 's1', model: '<synthetic>', ts: '2026-10-01T00:00:02Z', usage: zero }),
      assistant({ id: 's2', model: '<synthetic>', ts: '2026-10-01T00:00:03Z', usage: zero }),
    ]);
    const r = measureSessions({ sessionIds: ['sess-s'], projectsDir: root });
    assert.equal(r.ok, true);
    const main = r.sessions[0].agents[0];
    assert.equal(main.turns, 1);
    assert.equal(main.model, 'claude-opus-5-5');
    assert.equal(main.estimated, false);
    assert.equal(r.sessions[0].total.turns, 1);
    assert.equal(r.sessions[0].total.estimated, false);
    near(main.cost, (100 * 4 + 10 * 20) / 1e6);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
