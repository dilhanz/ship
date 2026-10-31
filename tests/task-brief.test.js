// Tests for ship/task-brief.cjs — the per-task brief a fresh builder reads
// instead of PLAN.md and CONTEXT.md.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'ship', 'task-brief.cjs');
const { buildBrief } = require(SCRIPT);

const SLUG = 'sample-feature';

const CONTEXT = `---
feature: "sample-feature"
status: building
---

## Problem

Problem text that must not appear.

## Decisions

- Decision one.
- Decision two.

### Sub-decision

- Nested detail.

## Acceptance Criteria

- [ ] Criterion that must not appear.

## Scope

**In scope:** a and b.
`;

function plan(commit) {
  return `---
feature: "sample-feature"
---

## Exploration Summary

Exploration text that must not appear.

<phase id="1" name="One" status="pending">

<task id="1" status="done" commit="${commit}">
  <name>First</name>
  <files>a.js</files>
  <action>Write a.js.</action>
  <verify>true</verify>
</task>

<task id="2" status="pending">
  <name>Second</name>
  <files>b.js</files>
  <action>Write b.js. Mentions <task …>…</task> inline.</action>
  <verify>true</verify>
</task>

<task id="3" status="pending" depends="1,2">
  <name>Third</name>
  <files>c.js</files>
  <action>Write c.js.</action>
  <verify>true</verify>
</task>

</phase>
`;
}

function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
    return r.stdout.trim();
  };
}

function makeRepo({ checklist = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-brief-')));
  const git = gitIn(dir);
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Ship Test');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
  git('add', 'a.js');
  git('commit', '-q', '-m', 'feat(sample-feature): add a');
  const commit = git('rev-parse', '--short', 'HEAD');
  const feat = path.join(dir, '.planning', 'features', SLUG);
  fs.mkdirSync(feat, { recursive: true });
  fs.writeFileSync(path.join(feat, 'PLAN.md'), plan(commit));
  fs.writeFileSync(path.join(feat, 'CONTEXT.md'), CONTEXT);
  if (checklist) {
    fs.writeFileSync(
      path.join(dir, '.planning', 'verify-checklist.md'),
      '# Checklist\n\nIntro prose.\n\n- Rule one\n  * Rule two nested\n\nBuild: npm test\n'
    );
  }
  return { dir, commit };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

describe('task-brief', () => {
  it('writes the four sections in order and nothing else', () => {
    const { dir } = makeRepo();
    try {
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '2' });
      assert.equal(r.ok, true, r.line);
      assert.equal(r.path, `.planning/features/${SLUG}/.review-scratch/briefs/task-2.md`);
      const text = fs.readFileSync(path.join(dir, r.path), 'utf8');
      assert.equal(text, r.content);
      const headings = text.split('\n').filter((l) => /^## /.test(l));
      assert.deepEqual(headings, ['## Task', '## Decisions and Scope', '## Dependencies', '## Verify checklist']);
      assert.ok(text.startsWith(`# Task 2 brief — ${SLUG}\n`));
      assert.ok(text.includes('<task id="2" status="pending">'));
      assert.ok(text.includes('Mentions <task …>…</task> inline.'));
      assert.ok(text.includes('- Decision two.\n\n### Sub-decision\n\n- Nested detail.'));
      assert.ok(text.includes('**In scope:** a and b.'));
      assert.ok(text.includes('- Rule one\n  * Rule two nested\nBuild: npm test'));
      for (const banned of ['Problem text', 'Criterion that must not', 'Exploration text', 'Intro prose', '<task id="3"', 'Third']) {
        assert.ok(!text.includes(banned), `brief must not contain ${banned}`);
      }
    } finally {
      cleanup(dir);
    }
  });

  it('uses the implied previous task and includes its commit stat', () => {
    const { dir, commit } = makeRepo();
    try {
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '2' });
      assert.ok(r.content.includes('### Task 1 — First'));
      assert.ok(r.content.includes(`Status: done · Commit: ${commit}`));
      assert.ok(r.content.includes('Files: a.js'));
      assert.ok(r.content.includes('    feat(sample-feature): add a'));
      assert.match(r.content, / {4} a\.js \| 1 \+/);
    } finally {
      cleanup(dir);
    }
  });

  it('uses the explicit depends list', () => {
    const { dir } = makeRepo();
    try {
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '3' });
      assert.ok(r.content.includes('### Task 1 — First'));
      assert.ok(r.content.includes('### Task 2 — Second\nStatus: pending · Commit: none\nFiles: b.js'));
    } finally {
      cleanup(dir);
    }
  });

  it('reports None for the first task', () => {
    const { dir } = makeRepo();
    try {
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '1' });
      assert.ok(r.content.includes('## Dependencies\n\nNone — this task depends on nothing earlier.\n'));
    } finally {
      cleanup(dir);
    }
  });

  it('notes a missing checklist', () => {
    const { dir } = makeRepo({ checklist: false });
    try {
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '1' });
      assert.ok(r.content.includes('No repo checklist (.planning/verify-checklist.md is absent).'));
    } finally {
      cleanup(dir);
    }
  });

  it('still writes the brief when git show fails', () => {
    const { dir } = makeRepo();
    try {
      const p = path.join(dir, '.planning', 'features', SLUG, 'PLAN.md');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/commit="[0-9a-f]+"/, 'commit="deadbeef"'));
      const r = buildBrief({ cwd: dir, feature: SLUG, taskId: '2' });
      assert.equal(r.ok, true);
      assert.match(r.content, /\(git show failed: .+\)/);
    } finally {
      cleanup(dir);
    }
  });

  it('a missing task fails with exit 1 and writes nothing', () => {
    const { dir } = makeRepo();
    try {
      const r = spawnSync(process.execPath, [SCRIPT, SLUG, '9'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 1);
      assert.equal(r.stdout, 'task-brief: task 9 not found in PLAN.md\n');
      assert.equal(fs.existsSync(path.join(dir, '.planning', 'features', SLUG, '.review-scratch')), false);
      assert.equal(buildBrief({ cwd: dir, feature: '../x', taskId: '1' }).code, 1);
      assert.equal(buildBrief({ cwd: dir, feature: SLUG, taskId: 'a b' }).code, 1);
      fs.rmSync(path.join(dir, '.planning', 'features', SLUG, 'CONTEXT.md'));
      assert.equal(buildBrief({ cwd: dir, feature: SLUG, taskId: '1' }).line, `task-brief: CONTEXT.md not found for ${SLUG}`);
    } finally {
      cleanup(dir);
    }
  });

  it('the CLI prints exactly one line, the written path', () => {
    const { dir } = makeRepo();
    try {
      const r = spawnSync(process.execPath, [SCRIPT, SLUG, '2'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 0);
      const lines = r.stdout.trimEnd().split('\n');
      assert.equal(lines.length, 1);
      assert.equal(lines[0], `.planning/features/${SLUG}/.review-scratch/briefs/task-2.md`);
      assert.ok(fs.existsSync(path.join(dir, lines[0])));
    } finally {
      cleanup(dir);
    }
  });

  it('extracts this repo\'s own task 2 in full when present', (t) => {
    const root = path.join(__dirname, '..');
    const own = path.join(root, '.planning', 'features', 'build-context-diet');
    if (!fs.existsSync(path.join(own, 'PLAN.md')) || !fs.existsSync(path.join(own, 'CONTEXT.md'))) {
      return t.skip('.planning is git-ignored and absent here');
    }
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-brief-own-')));
    try {
      const dst = path.join(tmp, '.planning', 'features', 'build-context-diet');
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(path.join(own, 'PLAN.md'), path.join(dst, 'PLAN.md'));
      fs.copyFileSync(path.join(own, 'CONTEXT.md'), path.join(dst, 'CONTEXT.md'));
      const r = buildBrief({ cwd: tmp, feature: 'build-context-diet', taskId: '2' });
      assert.equal(r.ok, true, r.line);
      assert.ok(r.content.includes('<verify>node --test --test-timeout=20000 tests/task-brief.test.js</verify>\n</task>'));
    } finally {
      cleanup(tmp);
    }
  });
});
