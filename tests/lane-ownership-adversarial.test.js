/**
 * Lane-ownership adversarial tests (verification stage).
 *
 * Independent of the builder's fixtures: these probe the ownership binding
 * from the angles a happy-path suite does not cover —
 *
 * - the measured scale (many feature dirs across two lanes) rather than three
 * - genuine cross-lane collisions must SURVIVE the ownership filter, or the
 *   fix has traded phantom overlaps for missed real ones
 * - branch matching edge cases: bare slug, case difference, two matching
 *   lanes (ambiguous → falls through), detached HEAD
 * - the stamp layer over a symlinked worktree path (macOS /tmp), where
 *   `git rev-parse --show-toplevel` and `git worktree list` could disagree
 * - prose that merely quotes `lane: {branch} @ {path}` is not testimony
 * - a slug argument that tries to escape the feature directory
 * - the failed stamp is silent on stderr too, not just stdout
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PM_UPDATE_PATH = path.join(ROOT, 'ship', 'pm-update.cjs');
const { sweep, resolveOwnership, parseLaneStamp } = require(path.join(ROOT, 'ship', 'lane-sweep.cjs'));
const { scanFeatures } = require(path.join(ROOT, 'hooks', 'scan-features.cjs'));

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

const slashes = (p) => String(p).replace(/\\/g, '/');
const key = (p) => slashes(fs.existsSync(p) ? fs.realpathSync(p) : p).toLowerCase();

function initRepo(dir, ignoreContent) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, '.gitignore'), ignoreContent);
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'init');
}

function createFeature(dir, name, status, files, extraFrontmatter) {
  const featureDir = path.join(dir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n${extraFrontmatter || ''}---\n\n## Problem\n\nTest.\n`
  );
  if (files) {
    fs.writeFileSync(
      path.join(featureDir, 'PLAN.md'),
      `---\ngoal: "g"\n---\n\n<files>\n${files.map((f) => `- ${f}`).join('\n')}\n</files>\n`
    );
  }
}

function commitPlanning(dir, message) {
  git(dir, 'add', '-A', '.planning');
  git(dir, 'commit', '-m', message);
}

function stamp(dir, name, value) {
  const file = path.join(dir, '.planning', 'features', name, 'CONTEXT.md');
  const content = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, content.replace(/^status: (.+)$/m, `status: $1\nlane: ${value}`));
}

describe('lane-ownership adversarial — fleet binding', { skip: !gitAvailable }, () => {
  let base;

  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-own-adv-')));
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('the measured scale: 23 feature dirs in two checkouts yield one owned row and zero overlaps', () => {
    const repo = path.join(base, 'scale');
    const lane = path.join(base, 'scale-lane');
    initRepo(repo, '.project-manager/\n');

    const slugs = [];
    for (let i = 0; i < 23; i++) {
      const slug = `feat-${String(i).padStart(2, '0')}`;
      slugs.push(slug);
      // every feature claims the same shared file — the phantom-overlap engine
      createFeature(repo, slug, 'building', ['src/shared.js', `src/${slug}.js`]);
    }
    commitPlanning(repo, 'add fleet');
    git(repo, 'worktree', 'add', '-b', 'feature/feat-07', lane);

    const result = sweep(repo);
    assert.equal(result.error, undefined);

    const laneRow = result.lanes.find((l) => !l.isMain);
    const mainRow = result.lanes.find((l) => l.isMain);
    assert.deepEqual(laneRow.features.map((f) => f.name), ['feat-07'], 'one owned row for the building lane');
    assert.equal(laneRow.features[0].ownedBy, 'branch');
    assert.deepEqual(mainRow.features, [], 'main proves nothing, claims nothing');
    assert.deepEqual(result.overlaps, [], 'zero overlaps where the pre-fix shape produced a wall of them');

    assert.equal(result.unowned.length, 22, 'the other 22 slugs are hoisted exactly once each');
    const names = result.unowned.map((u) => u.name);
    assert.equal(new Set(names).size, names.length, 'no slug is listed twice in unowned');
    assert.deepEqual(names, [...names].sort(), 'unowned is name-sorted for stable reporting');
    assert.ok(!names.includes('feat-07'), 'an owned slug is never also unowned');
    for (const slug of slugs) {
      const rows = result.lanes.reduce((n, l) => n + l.features.filter((f) => f.name === slug).length, 0);
      assert.ok(rows <= 1, `${slug} must never appear under two lanes`);
    }
  });

  it('a GENUINE cross-lane collision still surfaces after ownership filtering', () => {
    const repo = path.join(base, 'real');
    const laneA = path.join(base, 'real-a');
    const laneB = path.join(base, 'real-b');
    initRepo(repo, '.project-manager/\n');
    createFeature(repo, 'alpha', 'building', ['src/shared.js', 'src/alpha.js']);
    createFeature(repo, 'beta', 'building', ['SRC/Shared.js', 'src/beta.js']);
    commitPlanning(repo, 'add two');
    git(repo, 'worktree', 'add', '-b', 'feature/alpha', laneA);
    git(repo, 'worktree', 'add', '-b', 'beta', laneB); // bare-slug branch convention

    const result = sweep(repo);
    const a = result.lanes.find((l) => key(l.path) === key(laneA));
    const b = result.lanes.find((l) => key(l.path) === key(laneB));
    assert.deepEqual(a.features.map((f) => f.name), ['alpha'], 'feature/{slug} branch owns');
    assert.deepEqual(b.features.map((f) => f.name), ['beta'], 'bare {slug} branch owns too');
    assert.deepEqual(result.unowned, [], 'both slugs resolved');

    assert.equal(result.overlaps.length, 1, 'a real two-owner collision is not swallowed by the fix');
    assert.equal(result.overlaps[0].claims.length, 2);
    assert.deepEqual(
      result.overlaps[0].claims.map((c) => c.feature).sort(),
      ['alpha', 'beta'],
      'case-insensitive file match preserved'
    );
  });

  it('two branch-matching lanes are ambiguous and fall through to the stamp layer', () => {
    const repo = path.join(base, 'ambig');
    const laneA = path.join(base, 'ambig-a');
    const laneB = path.join(base, 'ambig-b');
    initRepo(repo, '.project-manager/\n');
    createFeature(repo, 'omega', 'building', ['src/omega.js']);
    commitPlanning(repo, 'add omega');
    git(repo, 'worktree', 'add', '-b', 'feature/omega', laneA);
    git(repo, 'worktree', 'add', '-b', 'omega', laneB);

    const ambiguous = sweep(repo);
    assert.deepEqual(ambiguous.unowned.map((u) => u.name), ['omega'], 'two branch candidates settle nothing');
    for (const l of ambiguous.lanes) assert.deepEqual(l.features, []);

    // Now break the tie with a self-consistent stamp on exactly one of them.
    stamp(laneB, 'omega', `omega @ ${slashes(laneB)}`);
    const settled = sweep(repo);
    const b = settled.lanes.find((l) => key(l.path) === key(laneB));
    assert.deepEqual(b.features.map((f) => f.name), ['omega']);
    assert.equal(b.features[0].ownedBy, 'stamp', 'the stamp layer is reachable, not dead code');
    assert.deepEqual(settled.unowned, []);
  });

  it('branch matching is case-insensitive and a detached lane never matches', () => {
    const repo = path.join(base, 'case');
    const laneA = path.join(base, 'case-a');
    const laneB = path.join(base, 'case-b');
    initRepo(repo, '.project-manager/\n');
    createFeature(repo, 'kappa', 'building');
    commitPlanning(repo, 'add kappa');
    git(repo, 'worktree', 'add', '-b', 'Feature/KAPPA', laneA);
    git(repo, 'worktree', 'add', '--detach', laneB);

    const result = sweep(repo);
    const a = result.lanes.find((l) => key(l.path) === key(laneA));
    const b = result.lanes.find((l) => key(l.path) === key(laneB));
    assert.equal(b.branch, null, 'detached lane has no branch');
    assert.deepEqual(a.features.map((f) => f.name), ['kappa']);
    assert.equal(a.features[0].ownedBy, 'branch');
    assert.deepEqual(b.features, []);
  });

  it('prose quoting the stamp format is not testimony — only frontmatter counts', () => {
    const repo = path.join(base, 'prose');
    const lane = path.join(base, 'prose-lane');
    initRepo(repo, '.project-manager/\n');
    createFeature(repo, 'iota', 'building');
    commitPlanning(repo, 'add iota');
    git(repo, 'worktree', 'add', '-b', 'chore/unrelated', lane);

    // main's copy only *documents* the format in its body
    const file = path.join(repo, '.planning', 'features', 'iota', 'CONTEXT.md');
    fs.appendFileSync(file, `\nThe stamp looks like \`lane: main @ ${slashes(repo)}\` in frontmatter.\n`);

    const result = sweep(repo);
    assert.deepEqual(result.unowned.map((u) => u.name), ['iota'], 'body prose must not win ownership');
    for (const l of result.lanes) assert.deepEqual(l.features, []);
  });

  it('the real pm-update stamp is self-consistent with the sweep, symlinked tmp included', () => {
    // /tmp is a symlink to /private/tmp on macOS: `git rev-parse --show-toplevel`
    // and `git worktree list` must agree, or the stamp layer silently never fires.
    const symBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-own-sym-'));
    try {
      const repo = path.join(symBase, 'repo');
      const lane = path.join(symBase, 'lane');
      initRepo(repo, '.project-manager/\n');
      createFeature(repo, 'sigma', 'building');
      commitPlanning(repo, 'add sigma');
      git(repo, 'worktree', 'add', '-b', 'chore/other', lane);

      const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'sigma'], { cwd: lane, encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);

      const stamped = fs.readFileSync(path.join(lane, '.planning', 'features', 'sigma', 'CONTEXT.md'), 'utf8');
      const line = (stamped.match(/^lane:\s*(.+)$/m) || [])[1];
      assert.ok(line, 'the CLI wrote a stamp');
      const parsed = parseLaneStamp(line);
      assert.ok(parsed, `stamp parses: ${line}`);
      assert.equal(parsed.branch, 'chore/other');

      const result = sweep(repo);
      const laneRow = result.lanes.find((l) => !l.isMain);
      assert.equal(
        key(parsed.path),
        key(laneRow.path),
        'the path pm-update stamps must be the path the sweep knows the lane by'
      );
      assert.deepEqual(laneRow.features.map((f) => f.name), ['sigma'], 'the real stamp wins ownership');
      assert.equal(laneRow.features[0].ownedBy, 'stamp');
      assert.deepEqual(result.unowned, []);
    } finally {
      fs.rmSync(symBase, { recursive: true, force: true });
    }
  });

  it('sweep never throws and degrades with an unowned array', () => {
    const outside = path.join(base, 'not-a-repo');
    fs.mkdirSync(outside, { recursive: true });
    const degraded = sweep(outside);
    assert.deepEqual(degraded.lanes, []);
    assert.deepEqual(degraded.overlaps, []);
    assert.deepEqual(degraded.unowned, []);
    assert.deepEqual(degraded.pendingHandoffs, []);
    assert.ok(degraded.error);

    assert.doesNotThrow(() => sweep(path.join(base, 'does-not-exist-at-all')));
    assert.doesNotThrow(() => sweep(undefined));
  });
});

describe('lane-ownership adversarial — resolveOwnership purity', () => {
  const lane = (p, branch, features) => ({ path: p, branch, isMain: p === '/main', features, handoffs: [] });

  it('does not mutate its input', () => {
    const input = [
      lane('/main', 'main', [{ name: 'a', status: 'building', lane: null }]),
      lane('/wt', 'feature/a', [{ name: 'a', status: 'building', lane: null }])
    ];
    const snapshot = JSON.stringify(input);
    resolveOwnership(input);
    assert.equal(JSON.stringify(input), snapshot, 'input lanes are untouched');
  });

  it('preserves every non-feature lane key', () => {
    const { lanes } = resolveOwnership([lane('/main', 'main', [{ name: 'a', status: 'built', lane: null }])]);
    assert.equal(lanes[0].isMain, true);
    assert.deepEqual(lanes[0].handoffs, []);
    assert.equal(lanes[0].branch, 'main');
    assert.equal(lanes[0].features[0].ownedBy, 'sole-lane');
  });

  it('survives malformed input without throwing', () => {
    assert.doesNotThrow(() => resolveOwnership(null));
    assert.deepEqual(resolveOwnership(null), { lanes: [], unowned: [] });
    assert.doesNotThrow(() => resolveOwnership([null, undefined, {}]));
    assert.doesNotThrow(() => resolveOwnership([{ path: '/x', branch: null, features: [null, { name: '' }, { name: 5 }] }]));
    const weird = resolveOwnership([{ path: '/x', branch: null, features: [{ name: 'ok', status: 'built' }] }]);
    assert.equal(weird.lanes[0].features.length, 1);
  });

  it('a stamp naming a different lane never wins, and a branchless fleet-of-two is unowned', () => {
    const { lanes, unowned } = resolveOwnership([
      lane('/main', null, [{ name: 'a', status: 'building', lane: 'x @ /elsewhere' }]),
      lane('/wt', null, [{ name: 'a', status: 'building', lane: 'y @ /nowhere' }])
    ]);
    assert.deepEqual(lanes.map((l) => l.features), [[], []]);
    assert.equal(unowned.length, 1);
    assert.deepEqual(unowned[0].lanes.map((l) => l.path), ['/main', '/wt']);
    assert.ok(!('files' in unowned[0]), 'unowned entries carry no file claims');
  });

  it('both copies stamping the SAME lane is ambiguous, not a win', () => {
    const { lanes, unowned } = resolveOwnership([
      lane('/main', null, [{ name: 'a', status: 'building', lane: 'main @ /main' }]),
      lane('/wt', null, [{ name: 'a', status: 'building', lane: 'main @ /main' }])
    ]);
    // only the lane whose own path matches is a candidate → exactly one → it owns
    assert.deepEqual(lanes[0].features.map((f) => f.ownedBy), ['stamp']);
    assert.deepEqual(lanes[1].features, []);
    assert.deepEqual(unowned, []);
  });
});

describe('lane-ownership adversarial — scanFeatures filter', () => {
  let dir;

  before(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-own-scan-')));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('excludes the tombstone set case-insensitively and keeps everything else', () => {
    for (const [slug, status] of [
      ['t-done', 'done'],
      ['t-superseded', 'superseded'],
      ['t-abandoned', 'abandoned'],
      ['t-cancelled', 'cancelled'],
      ['t-upper', 'SUPERSEDED'],
      ['t-mixed', 'Done'],
      ['t-spaced', '  done  '],
      ['live-typo', 'buidling'],
      ['live-unknown', 'wat']
    ]) {
      createFeature(dir, slug, status);
    }
    // status: line absent entirely
    const noStatus = path.join(dir, '.planning', 'features', 'live-nostatus');
    fs.mkdirSync(noStatus, { recursive: true });
    fs.writeFileSync(path.join(noStatus, 'CONTEXT.md'), '---\nfeature: "live-nostatus"\n---\n\nbody\n');

    const names = scanFeatures(dir).map((f) => f.name).sort();
    assert.deepEqual(names, ['live-nostatus', 'live-typo', 'live-unknown'], `got ${names.join(', ')}`);
    const nostatus = scanFeatures(dir).find((f) => f.name === 'live-nostatus');
    assert.equal(nostatus.status, 'unknown', 'an absent status surfaces as unknown rather than vanishing');
  });

  it('reads the lane stamp from frontmatter only, and never from the body', () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-own-scan2-'));
    try {
      createFeature(d2, 'stamped', 'building', null, 'lane: feature/x @ /tmp/x\n');
      const bodyOnly = path.join(d2, '.planning', 'features', 'bodyonly');
      fs.mkdirSync(bodyOnly, { recursive: true });
      fs.writeFileSync(
        path.join(bodyOnly, 'CONTEXT.md'),
        '---\nstatus: building\n---\n\nlane: feature/y @ /tmp/y\n'
      );
      const empty = path.join(d2, '.planning', 'features', 'emptylane');
      fs.mkdirSync(empty, { recursive: true });
      fs.writeFileSync(path.join(empty, 'CONTEXT.md'), '---\nstatus: building\nlane:   \n---\n\nbody\n');

      const byName = new Map(scanFeatures(d2).map((f) => [f.name, f]));
      assert.equal(byName.get('stamped').lane, 'feature/x @ /tmp/x');
      assert.equal(byName.get('bodyonly').lane, null, 'body text is not a stamp');
      assert.equal(byName.get('emptylane').lane, null, 'a blank stamp is absent, not empty-string');
    } finally {
      fs.rmSync(d2, { recursive: true, force: true });
    }
  });
});

describe('lane-ownership adversarial — the stamp writer', { skip: !gitAvailable }, () => {
  let base;

  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-own-stamp-')));
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function repoWithPm(name) {
    const repo = path.join(base, name);
    initRepo(repo, '');
    fs.mkdirSync(path.join(repo, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.project-manager', 'ROADMAP.md'),
      [
        '---',
        'project: "Fixture"',
        'updated: "2026-08-01"',
        '---',
        '',
        '## Backlog',
        '',
        '| Item | Status | Priority | Ship feature |',
        '| --- | --- | --- | --- |',
        '| Build widget | pending | P1 | widget |',
        ''
      ].join('\n')
    );
    fs.writeFileSync(path.join(repo, '.project-manager', 'STATUS.md'), '# Status\n\nnothing yet.\n');
    return repo;
  }

  it('a slug that tries to escape the feature directory writes nothing', () => {
    const repo = repoWithPm('escape');
    createFeature(repo, 'widget', 'building');
    const outside = path.join(base, 'escape-target.md');
    fs.writeFileSync(outside, 'untouched\n');

    for (const evil of ['../../escape-target', '..', 'a/b', 'wid get']) {
      const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, evil], { cwd: repo, encoding: 'utf8' });
      assert.equal(cli.status, 0, `${evil}: ${cli.stderr}`);
    }
    assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched\n', 'no traversal write');
  });

  it('a CONTEXT.md with no frontmatter is left byte-identical', () => {
    const repo = repoWithPm('nofm');
    const dir = path.join(repo, '.planning', 'features', 'widget');
    fs.mkdirSync(dir, { recursive: true });
    const original = '# Widget\n\nNo frontmatter here.\n';
    fs.writeFileSync(path.join(dir, 'CONTEXT.md'), original);

    const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8'), original, 'no invented structure');
  });

  it('CRLF line endings survive the stamp', () => {
    const repo = repoWithPm('crlf');
    const dir = path.join(repo, '.planning', 'features', 'widget');
    fs.mkdirSync(dir, { recursive: true });
    const original = '---\r\nfeature: "widget"\r\nstatus: building\r\n---\r\n\r\n## Problem\r\n\r\nbody\r\n';
    fs.writeFileSync(path.join(dir, 'CONTEXT.md'), original);

    const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const after = fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8');
    assert.ok(/^lane: .+ @ .+\r$/m.test(after), `stamp line keeps CRLF:\n${JSON.stringify(after)}`);
    assert.ok(!/[^\r]\n/.test(after), 'no LF-only line was introduced');
    assert.equal((after.match(/^lane:/gm) || []).length, 1);
  });

  it('a repeated stamp is idempotent and does not churn mtime', () => {
    const repo = repoWithPm('idem');
    createFeature(repo, 'widget', 'building');
    const file = path.join(repo, '.planning', 'features', 'widget', 'CONTEXT.md');

    spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    const first = fs.readFileSync(file, 'utf8');
    const mtime = fs.statSync(file).mtimeMs;

    spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(fs.readFileSync(file, 'utf8'), first, 'second run is byte-identical');
    assert.equal(fs.statSync(file).mtimeMs, mtime, 'and does not rewrite the file');
  });

  it('a failed stamp is silent on stderr as well as stdout, and still exits 0', { skip: isRoot }, () => {
    const repo = repoWithPm('readonly');
    createFeature(repo, 'widget', 'building');
    const dir = path.join(repo, '.planning', 'features', 'widget');
    const file = path.join(dir, 'CONTEXT.md');
    const before = fs.readFileSync(file, 'utf8');

    fs.chmodSync(file, 0o444);
    fs.chmodSync(dir, 0o555);
    try {
      const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
      assert.equal(cli.status, 0, 'a PM hiccup must never fail the lifecycle command');
      assert.equal(cli.stdout, '', 'nothing on stdout');
      assert.equal(cli.stderr, '', 'and nothing on stderr either — the stamp is best-effort insurance');
      assert.equal(fs.readFileSync(file, 'utf8'), before, 'CONTEXT.md untouched');
      const roadmap = fs.readFileSync(path.join(repo, '.project-manager', 'ROADMAP.md'), 'utf8');
      assert.ok(roadmap.includes('in-progress'), 'the .project-manager/ sync still completed');
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.chmodSync(file, 0o644);
    }
  });

  it('stamps even when .project-manager/ is absent', () => {
    const repo = path.join(base, 'nopm');
    initRepo(repo, '');
    createFeature(repo, 'widget', 'building');

    const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const after = fs.readFileSync(path.join(repo, '.planning', 'features', 'widget', 'CONTEXT.md'), 'utf8');
    assert.ok(/^lane: .+ @ .+$/m.test(after), 'ownership is not conditional on a PM directory');
  });
});
