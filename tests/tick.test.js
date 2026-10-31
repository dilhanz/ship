// Tests for ship/tick.cjs — the quiet script that marks a PLAN.md task done —
// and the shared line-anchored parser in ship/plan-parse.cjs it stands on.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TICK = path.join(__dirname, '..', 'ship', 'tick.cjs');
const { tick } = require(TICK);
const { parseTasks, parsePhases } = require(path.join(__dirname, '..', 'ship', 'plan-parse.cjs'));
const { scanFeatures } = require(path.join(__dirname, '..', 'hooks', 'scan-features.cjs'));

const SLUG = 'sample-feature';

const PLAN = `---
feature: "sample-feature"
goal: "Sample"
---

## Exploration Summary

Prose that mentions <task id="99" status="pending"> inline must not open a task.

<phase id="1" name="One" status="pending">

<task id="1" status="pending">
  <name>First</name>
  <files>a.js</files>
  <action>Write a.js. Mention <task …>…</task> inline, and
a line that only says
  <task id="fake" status="pending"> is still inside task 1.
</action>
  <verify>true</verify>
</task>

<task id="10" status="pending" depends="1">
  <name>Tenth</name>
  <files>b.js</files>
  <action>Write b.js.</action>
  <verify>true</verify>
</task>

<task id="11" depends="1, ,10" status="pending">
  <name>Eleventh</name>
  <files>c.js</files>
  <action>Write c.js.</action>
  <verify>true</verify>
</task>

<task id="12" status="pending" depends="404">
  <name>Twelfth</name>
  <files>d.js</files>
  <action>Write d.js.</action>
  <verify>true</verify>
</task>

</phase>
`;

function makeFixture(plan = PLAN) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-tick-')));
  const feat = path.join(dir, '.planning', 'features', SLUG);
  fs.mkdirSync(feat, { recursive: true });
  fs.writeFileSync(path.join(feat, 'PLAN.md'), plan);
  fs.writeFileSync(path.join(feat, 'CONTEXT.md'), '---\nfeature: "sample-feature"\nstatus: building\n---\n');
  return { dir, planPath: path.join(feat, 'PLAN.md') };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

describe('plan-parse', () => {
  it('ignores inline tag mentions and returns the full task XML', () => {
    const tasks = parseTasks(PLAN);
    assert.deepEqual(tasks.map((t) => t.id), ['1', '10', '11', '12']);
    const t1 = tasks[0];
    assert.ok(t1.xml.startsWith('<task id="1" status="pending">'));
    assert.ok(t1.xml.endsWith('</task>'));
    assert.ok(t1.xml.includes('Mention <task …>…</task> inline'));
    assert.ok(t1.xml.includes('<verify>true</verify>'));
    assert.equal(t1.name, 'First');
    assert.equal(t1.files, 'a.js');
    assert.equal(t1.phaseId, '1');
    assert.equal(PLAN.slice(t1.start, t1.end), t1.xml);
  });

  it('parses phases', () => {
    const phases = parsePhases(PLAN);
    assert.equal(phases.length, 1);
    assert.equal(phases[0].id, '1');
    assert.equal(phases[0].name, 'One');
    assert.equal(phases[0].attrs.status, 'pending');
  });

  it('parses this repo\'s own PLAN.md task 2 in full when present', (t) => {
    const own = path.join(__dirname, '..', '.planning', 'features', 'build-context-diet', 'PLAN.md');
    if (!fs.existsSync(own)) return t.skip('PLAN.md absent (.planning is git-ignored)');
    const tasks = parseTasks(fs.readFileSync(own, 'utf8'));
    const t2 = tasks.find((x) => x.id === '2');
    assert.ok(t2, 'task 2 found');
    assert.ok(t2.xml.includes('<verify>node --test --test-timeout=20000 tests/task-brief.test.js</verify>'));
  });
});

describe('tick', () => {
  it('marks a task done, preserving attribute order and depends', () => {
    const { dir, planPath } = makeFixture(PLAN.replace('<task id="1" status="pending">', '<task id="1" status="done" commit="aaaa111">'));
    try {
      const r = tick({ cwd: dir, feature: SLUG, taskId: '11', commit: 'abc1234' });
      assert.equal(r.ok, true);
      assert.equal(r.code, 2, 'task 10 is still pending');
      const r2 = tick({ cwd: dir, feature: SLUG, taskId: '10', commit: 'abc1234' });
      assert.equal(r2.code, 0);
      assert.equal(r2.line, 'tick: task 10 done (abc1234) — 2/4 tasks done');
      const text = fs.readFileSync(planPath, 'utf8');
      assert.ok(text.includes('<task id="10" status="done" depends="1" commit="abc1234">'));
      const r3 = tick({ cwd: dir, feature: SLUG, taskId: '11', commit: 'def5678' });
      assert.equal(r3.code, 0);
      assert.ok(fs.readFileSync(planPath, 'utf8').includes('<task id="11" depends="1, ,10" status="done" commit="def5678">'));
    } finally {
      cleanup(dir);
    }
  });

  it('id 1 does not match id 10', () => {
    const { dir, planPath } = makeFixture();
    try {
      const r = tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'abcd' });
      assert.equal(r.code, 0);
      const tasks = parseTasks(fs.readFileSync(planPath, 'utf8'));
      assert.equal(tasks.find((t) => t.id === '1').attrs.status, 'done');
      assert.equal(tasks.find((t) => t.id === '10').attrs.status, 'pending');
      assert.equal(tasks.find((t) => t.id === '10').attrs.commit, undefined);
    } finally {
      cleanup(dir);
    }
  });

  it('refuses while a depends task is pending and leaves PLAN.md byte-identical', () => {
    const { dir, planPath } = makeFixture();
    try {
      const before = fs.readFileSync(planPath);
      const r = tick({ cwd: dir, feature: SLUG, taskId: '10', commit: 'abcd123' });
      assert.equal(r.code, 2);
      assert.equal(r.line, 'tick: refused — task 10 depends on 1 (not done)');
      assert.deepEqual(fs.readFileSync(planPath), before);
    } finally {
      cleanup(dir);
    }
  });

  it('refuses when a depends id does not exist', () => {
    const { dir, planPath } = makeFixture();
    try {
      const before = fs.readFileSync(planPath);
      const r = tick({ cwd: dir, feature: SLUG, taskId: '12', commit: 'abcd123' });
      assert.equal(r.code, 2);
      assert.equal(r.line, 'tick: refused — task 12 depends on 404 (not done)');
      assert.deepEqual(fs.readFileSync(planPath), before);
    } finally {
      cleanup(dir);
    }
  });

  it('is idempotent for the same commit and overwrites a different one', () => {
    const { dir, planPath } = makeFixture();
    try {
      assert.equal(tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'abcd123' }).code, 0);
      const after = fs.readFileSync(planPath);
      const again = tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'abcd123' });
      assert.equal(again.code, 0);
      assert.equal(again.line, 'tick: task 1 already done (abcd123)');
      assert.deepEqual(fs.readFileSync(planPath), after);
      const other = tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'beef999' });
      assert.equal(other.code, 0);
      assert.equal(other.line, 'tick: task 1 done (beef999) — 1/4 tasks done');
      assert.ok(fs.readFileSync(planPath, 'utf8').includes('<task id="1" status="done" commit="beef999">'));
    } finally {
      cleanup(dir);
    }
  });

  it('rejects invalid input without writing', () => {
    const { dir, planPath } = makeFixture();
    try {
      const before = fs.readFileSync(planPath);
      assert.deepEqual(tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'XYZ' }), {
        ok: false, code: 1, line: "tick: invalid commit 'XYZ'",
      });
      assert.equal(tick({ cwd: dir, feature: '../x', taskId: '1', commit: 'abcd' }).line, "tick: invalid feature '../x'");
      assert.equal(tick({ cwd: dir, feature: SLUG, taskId: '1"x', commit: 'abcd' }).line, `tick: invalid task-id '1"x'`);
      assert.equal(tick({ cwd: dir, feature: SLUG, taskId: '7', commit: 'abcd' }).line, 'tick: task 7 not found in PLAN.md');
      assert.equal(tick({ cwd: dir, feature: 'nope', taskId: '1', commit: 'abcd' }).line, 'tick: PLAN.md not found for nope');
      assert.deepEqual(fs.readFileSync(planPath), before);
      assert.deepEqual(fs.readdirSync(path.dirname(planPath)).sort(), ['CONTEXT.md', 'PLAN.md']);
    } finally {
      cleanup(dir);
    }
  });

  it('CLI prints exactly one stdout line', () => {
    const { dir } = makeFixture();
    try {
      for (const args of [[SLUG, '1', 'abcd123'], [SLUG, '10', 'abcd123'], [SLUG, '1', 'zz'], []]) {
        const r = spawnSync(process.execPath, [TICK, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
        const out = r.stdout;
        assert.ok(out.endsWith('\n'), `trailing newline for ${args}`);
        assert.equal(out.trimEnd().split('\n').length, 1, `one line for ${args}: ${out}`);
        assert.ok(out.startsWith('tick: '));
        assert.equal(r.stderr, '');
      }
      const ok = spawnSync(process.execPath, [TICK, SLUG, '1', 'abcd123'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(ok.status, 0);
      const refused = spawnSync(process.execPath, [TICK, SLUG, '12', 'abcd123'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(refused.status, 2);
      const bad = spawnSync(process.execPath, [TICK, SLUG, '1', 'zz'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(bad.status, 1);
    } finally {
      cleanup(dir);
    }
  });

  it('scan-features counts a ticked task as done', () => {
    const { dir } = makeFixture();
    try {
      const before = scanFeatures(dir).find((f) => f.name === SLUG);
      assert.equal(before.tasks.done, 0);
      assert.equal(tick({ cwd: dir, feature: SLUG, taskId: '1', commit: 'abcd123' }).code, 0);
      const after = scanFeatures(dir).find((f) => f.name === SLUG);
      assert.equal(after.tasks.done, 1);
      assert.equal(after.tasks.pending, before.tasks.pending - 1);
    } finally {
      cleanup(dir);
    }
  });
});
