const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPER = path.join(__dirname, '..', 'ship', 'auto-run.cjs');
const autoRun = require(HELPER);

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-auto-run-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function featureDir(slug) {
  return path.join(tmp, '.planning', 'features', slug);
}

function recordPath(slug) {
  return path.join(featureDir(slug), 'AUTO.json');
}

/** A feature with CONTEXT.md and, unless `plan` is null, a PLAN.md. */
function createFeature(slug, plan) {
  const dir = featureDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), `---\nfeature: "${slug}"\nstatus: plan-verified\n---\n`);
  if (plan !== null) {
    fs.writeFileSync(path.join(dir, 'PLAN.md'), plan === undefined ? planWith(['pending']) : plan);
  }
}

function planWith(statuses) {
  const tasks = statuses
    .map((s, i) => `<task id="${i + 1}" status="${s}">\n  <name>Task ${i + 1}</name>\n  <files>a.js</files>\n</task>\n`)
    .join('\n');
  return `---\nfeature: "x"\n---\n\n<phase id="1" name="Fixes" status="pending">\n\n${tasks}\n</phase>\n`;
}

/** Spawn the CLI; every call must exit 0 and print exactly one JSON line. */
function cli(args, cwd) {
  const r = spawnSync(process.execPath, [HELPER, ...args], { cwd: cwd || tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, `exit code for ${JSON.stringify(args)} (stderr: ${r.stderr})`);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, `exactly one line of output for ${JSON.stringify(args)}: ${r.stdout}`);
  return JSON.parse(lines[0]);
}

function cliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER, ...args], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

function everyFile(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(full));
    else out.push(full);
  }
  return out;
}

describe('auto-run record — lifecycle (module)', () => {
  it('start writes a fresh record with the documented shape', () => {
    createFeature('feat');
    const r = autoRun.start('feat', { cwd: tmp, session: 'sess-1' });
    assert.equal(r.ok, true);
    assert.equal(r.resumed, false);
    assert.deepEqual(Object.keys(r.record), [
      'feature', 'session', 'started', 'fixRounds', 'fixRoundsUsed', 'failingSets', 'planRounds', 'profile', 'workflow',
    ]);
    assert.equal(r.record.feature, 'feat');
    assert.equal(r.record.session, 'sess-1');
    assert.equal(r.record.fixRounds, 2);
    assert.equal(r.record.fixRoundsUsed, 0);
    assert.deepEqual(r.record.failingSets, []);
    assert.equal(r.record.planRounds, 0);
    assert.equal(r.record.profile, null);
    assert.equal(r.record.workflow, null);
    assert.equal(new Date(r.record.started).toISOString(), r.record.started, 'started is an ISO timestamp');
    assert.deepEqual(JSON.parse(fs.readFileSync(recordPath('feat'), 'utf8')), r.record);
  });

  it('start refuses a feature with no CONTEXT.md and writes nothing', () => {
    fs.mkdirSync(featureDir('bare'), { recursive: true });
    const r = autoRun.start('bare', { cwd: tmp, session: 's' });
    assert.equal(r.ok, false);
    assert.match(r.warning, /CONTEXT\.md/);
    assert.deepEqual(fs.readdirSync(featureDir('bare')), []);
  });

  it('get returns the record, and null when absent or unparseable', () => {
    createFeature('feat');
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }), { ok: true, record: null });
    assert.deepEqual(autoRun.get('never-created', { cwd: tmp }), { ok: true, record: null });
    const started = autoRun.start('feat', { cwd: tmp, session: 's' });
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }).record, started.record);
    fs.writeFileSync(recordPath('feat'), '{ not json');
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }), { ok: true, record: null });
    fs.writeFileSync(recordPath('feat'), '[1,2]');
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }), { ok: true, record: null });
  });

  it('workflow sets and clears the workflow in flight', () => {
    createFeature('feat');
    assert.equal(autoRun.setWorkflow('feat', 'build', 'task-9', { cwd: tmp }).ok, false, 'no record yet');
    assert.equal(autoRun.clearWorkflow('feat', { cwd: tmp }).ok, false, 'no record yet');
    autoRun.start('feat', { cwd: tmp, session: 's' });

    const set = autoRun.setWorkflow('feat', 'build', 'task-9', { cwd: tmp });
    assert.equal(set.ok, true);
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }).record.workflow, { kind: 'build', taskId: 'task-9' });

    assert.equal(autoRun.setWorkflow('feat', 'deploy', 'task-9', { cwd: tmp }).ok, false, 'unknown kind');
    assert.equal(autoRun.setWorkflow('feat', 'plan', '', { cwd: tmp }).ok, false, 'missing task id');
    assert.deepEqual(autoRun.get('feat', { cwd: tmp }).record.workflow, { kind: 'build', taskId: 'task-9' });

    assert.equal(autoRun.clearWorkflow('feat', { cwd: tmp }).ok, true);
    assert.equal(autoRun.get('feat', { cwd: tmp }).record.workflow, null);
  });

  it('end deletes the record and is ok when it is already gone', () => {
    createFeature('feat');
    autoRun.start('feat', { cwd: tmp, session: 's' });
    assert.equal(autoRun.end('feat', { cwd: tmp }).ok, true);
    assert.equal(fs.existsSync(recordPath('feat')), false);
    assert.equal(autoRun.end('feat', { cwd: tmp }).ok, true);
    assert.equal(autoRun.end('never-created', { cwd: tmp }).ok, true);
    assert.equal(fs.existsSync(featureDir('never-created')), false, 'end creates nothing');
  });

  it('leaves no temp or lock file behind', () => {
    createFeature('feat');
    autoRun.start('feat', { cwd: tmp, session: 's' });
    autoRun.setWorkflow('feat', 'plan', 't1', { cwd: tmp });
    autoRun.verdict('feat', 3, { cwd: tmp });
    autoRun.bump('feat', 'planRounds', 2, { cwd: tmp });
    assert.deepEqual(fs.readdirSync(featureDir('feat')).sort(), ['AUTO.json', 'CONTEXT.md', 'PLAN.md']);
  });
});

describe('auto-run record — start flags', () => {
  it('--resume keeps the counters, a plain start resets them', () => {
    createFeature('feat');
    const first = cli(['start', 'feat', '--session', 'sess-1', '--fix-rounds', '3', '--profile', 'quick']);
    assert.equal(first.ok, true);
    assert.equal(cli(['verdict', 'feat', '5']).next, 'fix-round');
    assert.equal(cli(['bump', 'feat', 'planRounds', '--cap', '2']).value, 1);
    cli(['workflow', 'feat', 'build', 'wf-1']);

    const resumed = cli(['start', 'feat', '--session', 'sess-2', '--resume']);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.record.session, 'sess-2', 'a non-null session is updated');
    assert.equal(resumed.record.fixRoundsUsed, 1);
    assert.deepEqual(resumed.record.failingSets, [5]);
    assert.equal(resumed.record.planRounds, 1);
    assert.equal(resumed.record.fixRounds, 3);
    assert.equal(resumed.record.profile, 'quick');
    assert.deepEqual(resumed.record.workflow, { kind: 'build', taskId: 'wf-1' });
    assert.equal(resumed.record.started, first.record.started);

    const fresh = cli(['start', 'feat', '--session', 'sess-3']);
    assert.equal(fresh.resumed, false);
    assert.equal(fresh.record.fixRoundsUsed, 0);
    assert.deepEqual(fresh.record.failingSets, []);
    assert.equal(fresh.record.planRounds, 0);
    assert.equal(fresh.record.fixRounds, 2);
    assert.equal(fresh.record.profile, null);
    assert.equal(fresh.record.workflow, null);
  });

  it('--resume keeps the stored session when the new one is null, and takes explicit overrides', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 'sess-1', '--fix-rounds', '1']);
    const kept = cli(['start', 'feat', '--session', '${CLAUDE_SESSION_ID}', '--resume']);
    assert.equal(kept.record.session, 'sess-1');
    assert.equal(kept.record.fixRounds, 1);

    const overridden = cli(['start', 'feat', '--resume', '--fix-rounds=3', '--profile=thorough']);
    assert.equal(overridden.resumed, true);
    assert.equal(overridden.record.session, 'sess-1');
    assert.equal(overridden.record.fixRounds, 3);
    assert.equal(overridden.record.profile, 'thorough');
  });

  it('--resume falls back to a fresh record when none exists or it is unparseable', () => {
    createFeature('feat');
    const none = cli(['start', 'feat', '--session', 's', '--resume']);
    assert.equal(none.ok, true);
    assert.equal(none.resumed, false);

    fs.writeFileSync(recordPath('feat'), 'garbage{');
    const broken = cli(['start', 'feat', '--session', 's', '--resume']);
    assert.equal(broken.ok, true);
    assert.equal(broken.resumed, false);
    assert.equal(broken.record.fixRoundsUsed, 0);
    assert.deepEqual(cli(['get', 'feat']).record, broken.record);
  });

  it('an unsubstituted, empty or missing session is stored as null', () => {
    createFeature('feat');
    assert.equal(cli(['start', 'feat', '--session', '${CLAUDE_SESSION_ID}']).record.session, null);
    assert.equal(cli(['start', 'feat', '--session=${CLAUDE_SESSION_ID}']).record.session, null);
    assert.equal(cli(['start', 'feat', '--session', '']).record.session, null);
    assert.equal(cli(['start', 'feat', '--session=']).record.session, null);
    assert.equal(cli(['start', 'feat']).record.session, null);
    assert.equal(cli(['start', 'feat', '--session', '--resume']).record.session, null);
    assert.equal(cli(['start', 'feat', '--session=abc-123']).record.session, 'abc-123');
  });

  it('--fix-rounds accepts whole numbers 0-3 and treats anything else as absent', () => {
    createFeature('feat');
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds', '0']).record.fixRounds, 0);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds', '3']).record.fixRounds, 3);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds=1']).record.fixRounds, 1);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds', '4']).record.fixRounds, 2);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds', 'x']).record.fixRounds, 2);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds', '1.5']).record.fixRounds, 2);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds=-1']).record.fixRounds, 2);
    assert.equal(cli(['start', 'feat', '--session', 's', '--fix-rounds=']).record.fixRounds, 2);
  });
});

describe('auto-run record — verdict', () => {
  it('5 → fix-round, 2 → fix-round, then budget spent', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's']);

    const a = cli(['verdict', 'feat', '5']);
    assert.deepEqual(
      { ok: a.ok, next: a.next, used: a.used, budget: a.budget, trend: a.trend },
      { ok: true, next: 'fix-round', used: 1, budget: 2, trend: '5' }
    );
    assert.equal(typeof a.reason, 'string');

    const b = cli(['verdict', 'feat', '2']);
    assert.deepEqual(
      { next: b.next, used: b.used, budget: b.budget, trend: b.trend },
      { next: 'fix-round', used: 2, budget: 2, trend: '5→2' }
    );

    const c = cli(['verdict', 'feat', '1']);
    assert.deepEqual(
      { ok: c.ok, next: c.next, reason: c.reason, used: c.used, budget: c.budget, trend: c.trend },
      { ok: true, next: 'stop', reason: 'budget spent', used: 2, budget: 2, trend: '5→2→1' }
    );

    const record = cli(['get', 'feat']).record;
    assert.deepEqual(record.failingSets, [5, 2, 1]);
    assert.equal(record.fixRoundsUsed, 2);
  });

  it('5 then 5 → not shrinking', () => {
    createFeature('feat');
    autoRun.start('feat', { cwd: tmp, session: 's' });
    assert.equal(autoRun.verdict('feat', 5, { cwd: tmp }).next, 'fix-round');
    const r = autoRun.verdict('feat', 5, { cwd: tmp });
    assert.equal(r.next, 'stop');
    assert.equal(r.reason, 'not shrinking');
    assert.equal(r.used, 1, 'a refused round is not consumed');
    assert.equal(r.trend, '5→5');
  });

  it('a growing failing set is not shrinking either', () => {
    createFeature('feat');
    autoRun.start('feat', { cwd: tmp, session: 's', fixRounds: 3 });
    autoRun.verdict('feat', 2, { cwd: tmp });
    const r = autoRun.verdict('feat', 4, { cwd: tmp });
    assert.equal(r.next, 'stop');
    assert.equal(r.reason, 'not shrinking');
  });

  it('first verify with --fix-rounds 0 → budget spent', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's', '--fix-rounds', '0']);
    const r = cli(['verdict', 'feat', '5']);
    assert.equal(r.next, 'stop');
    assert.equal(r.reason, 'budget spent');
    assert.equal(r.used, 0);
    assert.equal(r.budget, 0);
    assert.equal(r.trend, '5');
  });

  it('no pending task → no fix task', () => {
    createFeature('all-done', planWith(['done', 'done']));
    cli(['start', 'all-done', '--session', 's']);
    const done = cli(['verdict', 'all-done', '3']);
    assert.equal(done.next, 'stop');
    assert.equal(done.reason, 'no fix task');
    assert.equal(done.used, 0);

    createFeature('no-plan', null);
    cli(['start', 'no-plan', '--session', 's']);
    const none = cli(['verdict', 'no-plan', '3']);
    assert.equal(none.next, 'stop');
    assert.equal(none.reason, 'no fix task');
  });

  it('a pending task outside any phase still counts as a fix task', () => {
    const plan =
      '<phase id="1" name="Build" status="done">\n\n<task id="1" status="done">\n  <name>a</name>\n</task>\n\n</phase>\n\n' +
      '<task id="2" status="pending">\n  <name>fix</name>\n</task>\n';
    createFeature('feat', plan);
    autoRun.start('feat', { cwd: tmp, session: 's' });
    assert.equal(autoRun.verdict('feat', 1, { cwd: tmp }).next, 'fix-round');
  });

  it('a plan the lister cannot parse falls back to a line-anchored count', () => {
    // The only task is never closed, so the lister reports a warning and no phases.
    createFeature('open-task', '<task id="1" status="pending">\n  <name>never closed</name>\n');
    autoRun.start('open-task', { cwd: tmp, session: 's' });
    assert.equal(autoRun.verdict('open-task', 2, { cwd: tmp }).next, 'fix-round');

    // Prose that mentions a pending task mid-line is not a task.
    createFeature('prose-only', 'The format is `<task id="1" status="pending">` and\n<task id="1" status="done">\n');
    autoRun.start('prose-only', { cwd: tmp, session: 's' });
    assert.equal(autoRun.verdict('prose-only', 2, { cwd: tmp }).reason, 'no fix task');
  });

  it('a non-numeric or negative count is refused and leaves the record unchanged', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's']);
    cli(['verdict', 'feat', '4']);
    const before = fs.readFileSync(recordPath('feat'), 'utf8');
    for (const bad of ['x', '-1', '1.5', '', '2e1']) {
      const r = cli(['verdict', 'feat', bad]);
      assert.equal(r.ok, false, `count '${bad}'`);
      assert.equal(typeof r.warning, 'string');
    }
    assert.equal(cli(['verdict', 'feat']).ok, false, 'missing count');
    assert.equal(fs.readFileSync(recordPath('feat'), 'utf8'), before);
  });

  it('verdict without a record is ok: false', () => {
    createFeature('feat');
    assert.equal(cli(['verdict', 'feat', '3']).ok, false);
    assert.equal(fs.existsSync(recordPath('feat')), false);
  });
});

describe('auto-run record — bump', () => {
  it('increments planRounds only while below the cap', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's']);
    assert.deepEqual(cli(['bump', 'feat', 'planRounds', '--cap', '2']), { ok: true, allowed: true, value: 1 });
    assert.deepEqual(cli(['bump', 'feat', 'planRounds', '--cap=2']), { ok: true, allowed: true, value: 2 });
    assert.deepEqual(cli(['bump', 'feat', 'planRounds', '--cap', '2']), { ok: true, allowed: false, value: 2 });
    assert.equal(cli(['get', 'feat']).record.planRounds, 2);
  });

  it('refuses an unknown counter, a bad cap, or a missing record', () => {
    createFeature('feat');
    assert.equal(cli(['bump', 'feat', 'planRounds', '--cap', '2']).ok, false, 'no record');
    cli(['start', 'feat', '--session', 's']);
    assert.equal(cli(['bump', 'feat', 'fixRoundsUsed', '--cap', '2']).ok, false);
    assert.equal(cli(['bump', 'feat', 'planRounds']).ok, false);
    assert.equal(cli(['bump', 'feat', 'planRounds', '--cap', 'x']).ok, false);
    const record = cli(['get', 'feat']).record;
    assert.equal(record.planRounds, 0);
    assert.equal(record.fixRoundsUsed, 0);
  });

  it('concurrent bumps do not lose an update', async () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's']);
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => cliAsync(['bump', 'feat', 'planRounds', '--cap', '100']))
    );
    for (const r of runs) {
      assert.equal(r.code, 0);
      assert.equal(JSON.parse(r.out).ok, true);
    }
    assert.deepEqual(runs.map((r) => JSON.parse(r.out).value).sort(), [1, 2, 3, 4, 5, 6]);
    assert.equal(cli(['get', 'feat']).record.planRounds, 6);
    assert.deepEqual(fs.readdirSync(featureDir('feat')).sort(), ['AUTO.json', 'CONTEXT.md', 'PLAN.md']);
  });
});

describe('auto-run record — bad input never touches the filesystem', () => {
  it('an invalid slug writes nothing, through the CLI and the module', () => {
    createFeature('feat');
    // A sibling the traversal slugs would resolve to if they were ever joined.
    fs.mkdirSync(path.join(tmp, '.planning', 'x'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'x', 'CONTEXT.md'), 'status: planned\n');
    const before = everyFile(tmp).sort();

    for (const slug of ['../x', '', '   ', 'a/b', 'a\\b', '..']) {
      for (const args of [
        ['start', slug, '--session', 's'],
        ['get', slug],
        ['workflow', slug, 'build', 't1'],
        ['workflow', slug, 'clear'],
        ['verdict', slug, '3'],
        ['bump', slug, 'planRounds', '--cap', '2'],
        ['end', slug],
      ]) {
        const r = cli(args);
        assert.equal(r.ok, false, `${JSON.stringify(args)} must be refused`);
        assert.equal(typeof r.warning, 'string');
      }
    }

    assert.equal(autoRun.start('../x', { cwd: tmp, session: 's' }).ok, false);
    assert.equal(autoRun.start(undefined, { cwd: tmp }).ok, false);
    assert.equal(autoRun.end('../x', { cwd: tmp }).ok, false);
    assert.equal(autoRun.get(null, { cwd: tmp }).ok, false);

    assert.deepEqual(everyFile(tmp).sort(), before);
  });

  it('every CLI call exits 0 with one parseable JSON line', () => {
    createFeature('feat');
    const calls = [
      [],
      ['nonsense'],
      ['nonsense', 'feat'],
      ['start'],
      ['start', 'missing-feature', '--session', 's'],
      ['get'],
      ['workflow', 'feat'],
      ['workflow', 'feat', 'deploy', 't1'],
      ['verdict', 'feat'],
      ['bump', 'feat'],
      ['end'],
      ['--resume'],
      ['start', 'feat', '--session', 's'],
      ['get', 'feat'],
      ['end', 'feat'],
    ];
    for (const args of calls) {
      const r = cli(args);
      assert.equal(typeof r.ok, 'boolean', `ok is a boolean for ${JSON.stringify(args)}`);
      if (!r.ok) assert.equal(typeof r.warning, 'string');
    }
    assert.equal(cli(['nonsense', 'feat']).ok, false, 'unknown command');
    assert.equal(cli([]).ok, false, 'no command');
  });

  it('the CLI reads the record relative to its cwd', () => {
    createFeature('feat');
    cli(['start', 'feat', '--session', 's']);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-auto-run-elsewhere-'));
    try {
      assert.deepEqual(cli(['get', 'feat'], elsewhere), { ok: true, record: null });
      assert.equal(cli(['start', 'feat', '--session', 's'], elsewhere).ok, false);
      assert.deepEqual(fs.readdirSync(elsewhere), []);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
