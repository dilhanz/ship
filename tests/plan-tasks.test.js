// Tests for ship/plan-tasks.cjs — the pending phase/task list the go skill
// passes to the go workflow as phases[].tasks.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'ship', 'plan-tasks.cjs');
const { listPendingTasks, isDocsOnly } = require(SCRIPT);

const SLUG = 'sample-feature';

function task(id, status, files, name = `Task ${id}`) {
  return `<task id="${id}" status="${status}">
  <name> ${name} </name>
  <files>${files}</files>
  <action>Do it. Mentions <task …>…</task> inline.</action>
  <verify>true</verify>
</task>
`;
}

function makeFixture(plan) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-plantasks-')));
  const feat = path.join(dir, '.planning', 'features', SLUG);
  fs.mkdirSync(feat, { recursive: true });
  if (plan !== null) fs.writeFileSync(path.join(feat, 'PLAN.md'), plan);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

describe('plan-tasks', () => {
  it('lists pending phases with their pending tasks in order', () => {
    const plan = [
      '---\nfeature: "x"\n---\n',
      '<phase id="1" name="Done phase" status="done">\n',
      task('1', 'done', 'a.js'),
      '</phase>\n',
      '<phase id="2" name="Mixed" status="pending">\n',
      task('2', 'done', 'b.js'),
      task('3', 'pending', 'README.md, docs/guide.md', 'Docs'),
      task('4', 'pending', 'src/c.ts'),
      '</phase>\n',
      '<phase id="3" name="Empty" status="building">\n',
      task('5', 'done', 'd.js'),
      '</phase>\n',
    ].join('\n');
    const dir = makeFixture(plan);
    try {
      assert.deepEqual(listPendingTasks({ cwd: dir, feature: SLUG }), {
        feature: SLUG,
        phases: [
          {
            id: '2',
            name: 'Mixed',
            tasks: [
              { id: '3', name: 'Docs', docsOnly: true },
              { id: '4', name: 'Task 4', docsOnly: false },
            ],
          },
          { id: '3', name: 'Empty', tasks: [] },
        ],
        warning: null,
      });
    } finally {
      cleanup(dir);
    }
  });

  it('treats a flat plan as one all phase', () => {
    const dir = makeFixture(['## Tasks\n', task('1', 'done', 'a.js'), task('2', 'pending', 'b.js')].join('\n'));
    try {
      assert.deepEqual(listPendingTasks({ cwd: dir, feature: SLUG }).phases, [
        { id: 'all', name: 'all', tasks: [{ id: '2', name: 'Task 2', docsOnly: false }] },
      ]);
    } finally {
      cleanup(dir);
    }
  });

  it('sweeps orphan fix tasks once every phase is done', () => {
    const plan = [
      '<phase id="1" name="One" status="done">\n',
      task('1', 'done', 'a.js'),
      '</phase>\n',
      task('F1', 'pending', 'a.js', 'Fix one'),
      task('F2', 'done', 'b.js', 'Fix two'),
    ].join('\n');
    const dir = makeFixture(plan);
    try {
      assert.deepEqual(listPendingTasks({ cwd: dir, feature: SLUG }).phases, [
        { id: 'all', name: 'all', tasks: [{ id: 'F1', name: 'Fix one', docsOnly: false }] },
      ]);
    } finally {
      cleanup(dir);
    }
  });

  it('returns no phases when everything is done', () => {
    const dir = makeFixture(['<phase id="1" name="One" status="done">\n', task('1', 'done', 'a.js'), '</phase>\n'].join('\n'));
    try {
      assert.deepEqual(listPendingTasks({ cwd: dir, feature: SLUG }), { feature: SLUG, phases: [], warning: null });
    } finally {
      cleanup(dir);
    }
  });

  it('isDocsOnly accepts prose and rejects prompts, code and empties', () => {
    assert.equal(isDocsOnly('README.md, docs/guide.md'), true);
    assert.equal(isDocsOnly('notes.TXT, a.rst, b.adoc, c.mdx, d.markdown'), true);
    assert.equal(isDocsOnly('agents/ship-builder.md'), false);
    assert.equal(isDocsOnly('skills/go/SKILL.md'), false);
    assert.equal(isDocsOnly('CLAUDE.md'), false);
    assert.equal(isDocsOnly('docs/AGENTS.md'), false);
    assert.equal(isDocsOnly('src/a.ts, README.md'), false);
    assert.equal(isDocsOnly(''), false);
    assert.equal(isDocsOnly(' , '), false);
    assert.equal(isDocsOnly(undefined), false);
  });

  it('a missing PLAN.md yields no phases, a warning and exit 0', () => {
    const dir = makeFixture(null);
    try {
      const r = spawnSync(process.execPath, [SCRIPT, SLUG], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trimEnd().split('\n').length, 1);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(out.phases, []);
      assert.equal(out.warning, `PLAN.md not found for ${SLUG}`);
      const bad = spawnSync(process.execPath, [SCRIPT, '../etc'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(bad.status, 0);
      assert.deepEqual(JSON.parse(bad.stdout).phases, []);
      assert.match(JSON.parse(bad.stdout).warning, /invalid feature/);
    } finally {
      cleanup(dir);
    }
  });

  it('parses this repo\'s own PLAN.md without a warning when present', (t) => {
    const root = path.join(__dirname, '..');
    if (!fs.existsSync(path.join(root, '.planning', 'features', 'build-context-diet', 'PLAN.md'))) {
      return t.skip('.planning is git-ignored and absent here');
    }
    const r = listPendingTasks({ cwd: root, feature: 'build-context-diet' });
    assert.equal(r.warning, null);
    for (const ph of r.phases) {
      for (const tk of ph.tasks) {
        assert.match(tk.id, /^\d+$/);
        assert.ok(tk.name.length > 0);
      }
    }
  });
});
