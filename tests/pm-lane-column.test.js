/**
 * Kind-aware reconciliation and the derived Lane column —
 * ship/pm-update.cjs applyStatusUpdates(), applyLaneColumn(), laneOwnershipMap().
 *
 * Two properties are pinned here. A `Kind: debt` row is never reconciled off
 * the archive of the feature it is *about*, because that would auto-close the
 * row it exists to keep open. And the `Lane` cell the spec has always called
 * derived is now written from sweep ownership — but only when the sweep can
 * actually answer: a failed sweep writing `—` would be inventing "unowned",
 * which is the failure class this feature exists to close.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { applyStatusUpdates, applyLaneColumn, laneOwnershipMap } = require(SCRIPT_PATH);

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

/** Run git in a directory, asserting success. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

/** Spawn the pm-update CLI in a given cwd. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-m', 'init');
}

/** An archived feature directory (no VERIFY.md → no-stamp → `done`). */
function archive(dir, slug) {
  fs.mkdirSync(path.join(dir, '.planning', 'archive', slug), { recursive: true });
}

/** An active feature CONTEXT.md. */
function activeFeature(dir, slug, status = 'building') {
  const featureDir = path.join(dir, '.planning', 'features', slug);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${slug}"\nstatus: ${status}\ncreated: "2026-08-23"\n---\n\n## Problem\n\nFixture.\n`
  );
}

function writeRoadmap(dir, content) {
  const pm = path.join(dir, '.project-manager');
  fs.mkdirSync(pm, { recursive: true });
  const file = path.join(pm, 'ROADMAP.md');
  fs.writeFileSync(file, content);
  return file;
}

const KIND_ROADMAP = [
  '---',
  'updated: "2026-08-01"',
  '---',
  '',
  '## Backlog',
  '',
  '### Now',
  '',
  '| Item | Status | Priority | Kind | Depends on | Ship feature |',
  '|---|---|---|---|---|---|',
  '| Verify widget | pending | P1 | debt | — | widget |',
  '| Ship widget | pending | P0 | work | — | widget |',
  ''
].join('\n');

const LEGACY_ROADMAP = [
  '---',
  'updated: "2026-08-01"',
  '---',
  '',
  '## Backlog',
  '',
  '### Now',
  '',
  '| Item | Status | Priority | Depends on | Ship feature |',
  '|---|---|---|---|---|',
  '| Ship widget | pending | P0 | — | widget |',
  ''
].join('\n');

describe('pm-lane-column: Kind-aware reconciliation', () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-kind-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('never touches a debt row, even when its slug is archived', () => {
    archive(root, 'widget');

    const result = applyStatusUpdates(KIND_ROADMAP, root, []);
    assert.equal(result.changed, true, 'the work row beside it did change');

    const lines = result.content.split('\n');
    assert.equal(
      lines.find(l => l.startsWith('| Verify widget')),
      '| Verify widget | pending | P1 | debt | — | widget |',
      'the debt row is byte-identical — debt closes when a human says so'
    );
    assert.equal(
      lines.find(l => l.startsWith('| Ship widget')),
      '| Ship widget | done | P0 | work | — | widget |',
      'the work row beside it reconciles exactly as today'
    );
  });

  it('reconciles a `work` row and an empty Kind cell alike', () => {
    archive(root, 'widget');
    const roadmap = KIND_ROADMAP.replace('| P1 | debt |', '| P1 | — |');

    const result = applyStatusUpdates(roadmap, root, []);
    assert.match(result.content, /\| Verify widget \| done \| P1 \| — \|/, 'an empty Kind means work');
  });

  it('matches Kind case-insensitively and tolerates padding', () => {
    archive(root, 'widget');
    const roadmap = KIND_ROADMAP.replace('| debt |', '|  Debt  |');

    const result = applyStatusUpdates(roadmap, root, []);
    assert.match(result.content, /\| Verify widget \| pending \| P1 \|  Debt  \|/);
  });

  it('reconciles a table with no Kind column exactly as it does today', () => {
    archive(root, 'widget');

    const result = applyStatusUpdates(LEGACY_ROADMAP, root, []);
    assert.equal(result.changed, true);
    assert.equal(
      result.content.split('\n').find(l => l.startsWith('| Ship widget')),
      '| Ship widget | done | P0 | — | widget |'
    );
  });
});

describe('pm-lane-column: applyLaneColumn', () => {
  const LANE_ROADMAP = [
    '### Now',
    '',
    '| Item | Status | Lane | Ship feature |',
    '|---|---|---|---|',
    '| Ship widget | in-progress |  | widget |',
    '| Ship gadget | in-progress | — | gadget |',
    '| Ship doodad | in-progress | — | doodad |',
    '| Chores | pending | — | — |',
    ''
  ].join('\n');

  const laneMap = () => new Map([['widget', 'feature/widget @ /repos/widget']]);

  it('writes the owning lane label and — for everything the map does not hold', () => {
    const result = applyLaneColumn(LANE_ROADMAP, laneMap());
    assert.equal(result.changed, true);

    const lines = result.content.split('\n');
    assert.equal(
      lines.find(l => l.startsWith('| Ship widget')),
      '| Ship widget | in-progress | feature/widget @ /repos/widget | widget |'
    );
    assert.equal(
      lines.find(l => l.startsWith('| Ship gadget')),
      '| Ship gadget | in-progress | — | gadget |',
      'a slug the sweep reported unowned renders —, never a guess'
    );
    assert.equal(
      lines.find(l => l.startsWith('| Ship doodad')),
      '| Ship doodad | in-progress | — | doodad |',
      'a finished feature the sweep no longer scans renders — too'
    );
    assert.equal(
      lines.find(l => l.startsWith('| Chores')),
      '| Chores | pending | — | — |',
      'a slugless row is left alone'
    );
  });

  it('leaves a table with no Lane column byte-identical', () => {
    const result = applyLaneColumn(LEGACY_ROADMAP, laneMap());
    assert.equal(result.changed, false, 'pm-update.cjs never widens a table on its own');
    assert.equal(result.content, LEGACY_ROADMAP);
  });

  it('reports changed: false and returns the input when every cell is already correct', () => {
    const once = applyLaneColumn(LANE_ROADMAP, laneMap());
    const twice = applyLaneColumn(once.content, laneMap());
    assert.equal(twice.changed, false, 'no mtime churn on a settled roadmap');
    assert.equal(twice.content, once.content);
  });

  it('preserves padding and CRLF on untouched cells', () => {
    const crlf = [
      '| Item | Status | Lane | Ship feature |',
      '|---|---|---|---|',
      '| Ship widget   | in-progress   |  | widget   |',
      '| Ship gadget   | in-progress   | — | gadget   |',
      ''
    ].join('\r\n');

    const result = applyLaneColumn(crlf, laneMap());
    const lines = result.content.split('\n');
    assert.equal(
      lines.find(l => l.startsWith('| Ship widget')),
      '| Ship widget   | in-progress   | feature/widget @ /repos/widget | widget   |\r',
      'only the Lane segment moved — padding and the CR survive'
    );
    assert.equal(
      lines.find(l => l.startsWith('| Ship gadget')),
      '| Ship gadget   | in-progress   | — | gadget   |\r'
    );
  });

  it('degrades to — for a null or non-Map argument rather than throwing', () => {
    const result = applyLaneColumn(LANE_ROADMAP, null);
    assert.equal(result.changed, true);
    assert.match(result.content, /\| Ship widget \| in-progress \| — \| widget \|/);
  });
});

describe('pm-lane-column: laneOwnershipMap', () => {
  it('labels each owned feature with its lane, in stampLane\'s own format', () => {
    const map = laneOwnershipMap({
      lanes: [
        { path: '/repos/ship', branch: 'main', features: [{ name: 'widget' }, { name: 'gadget' }] },
        { path: '/repos/wt', branch: 'feature/doodad', features: [{ name: 'doodad' }] }
      ],
      unowned: [{ name: 'contested' }]
    });

    assert.equal(map.get('widget'), 'main @ /repos/ship');
    assert.equal(map.get('gadget'), 'main @ /repos/ship');
    assert.equal(map.get('doodad'), 'feature/doodad @ /repos/wt');
    assert.equal(map.has('contested'), false, 'an unowned slug is deliberately absent');
  });

  it('labels a detached lane `detached` and normalises Windows separators', () => {
    const map = laneOwnershipMap({
      lanes: [
        { path: 'C:\\repos\\ship', branch: 'HEAD', features: [{ name: 'widget' }] },
        { path: '/repos/other', branch: null, features: [{ name: 'gadget' }] }
      ]
    });

    assert.equal(map.get('widget'), 'detached @ C:/repos/ship');
    assert.equal(map.get('gadget'), 'detached @ /repos/other');
  });

  it('returns an empty map for null, an error sweep, or malformed input', () => {
    assert.equal(laneOwnershipMap(null).size, 0);
    assert.equal(laneOwnershipMap({ error: 'not a git repository or git unavailable', lanes: [] }).size, 0);
    assert.equal(laneOwnershipMap({ lanes: 'nonsense' }).size, 0);
    assert.equal(laneOwnershipMap({ lanes: [{ features: [{}, { name: '' }, null] }] }).size, 0);
  });
});

describe('pm-lane-column: CLI wiring', () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-col-cli-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('leaves every Lane cell exactly as authored when the sweep is unavailable', () => {
    // A non-repo directory: sweep() returns an `error` result, so the Lane
    // pass must be skipped entirely rather than stamping — over live values.
    const authored = [
      '---',
      'updated: "2026-08-01"',
      '---',
      '',
      '### Now',
      '',
      '| Item | Status | Lane | Ship feature |',
      '|---|---|---|---|',
      '| Ship widget | pending | hand-written @ /somewhere | widget |',
      ''
    ].join('\n');
    const file = writeRoadmap(root, authored);
    activeFeature(root, 'widget');

    const cli = runCli(root);
    assert.equal(cli.status, 0, cli.stderr);

    const after = fs.readFileSync(file, 'utf8');
    assert.match(
      after,
      /\| Ship widget \| in-progress \| hand-written @ \/somewhere \| widget \|/,
      'the status reconciled, the Lane cell did not move'
    );
  });

  it('writes the Lane cell from the sweep in a real repo', { skip: !gitAvailable }, () => {
    initRepo(root);
    const file = writeRoadmap(root, [
      '---',
      'updated: "2026-08-01"',
      '---',
      '',
      '### Now',
      '',
      '| Item | Status | Lane | Ship feature |',
      '|---|---|---|---|',
      '| Ship widget | pending | — | widget |',
      '| Ship ghost | pending | stale @ /gone | ghost |',
      ''
    ].join('\n'));
    activeFeature(root, 'widget');

    const cli = runCli(root);
    assert.equal(cli.status, 0, cli.stderr);

    const after = fs.readFileSync(file, 'utf8');
    assert.match(
      after,
      new RegExp(`\\| Ship widget \\| in-progress \\| main @ ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| widget \\|`),
      'the owning lane is written in {branch} @ {path} form'
    );
    assert.match(
      after,
      /\| Ship ghost \| pending \| — \| ghost \|/,
      'a slug no lane holds is corrected to —'
    );
  });
});
