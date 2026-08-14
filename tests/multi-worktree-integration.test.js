/**
 * Multi-worktree PM adversarial integration tests.
 *
 * Exercises the fleet machinery end-to-end against real `git worktree add`
 * lanes — the surfaces the unit/fixture tests cover only in isolation:
 *
 * - sweep() across two live worktrees, with a case-differing cross-lane
 *   file overlap (Windows path semantics)
 * - pm-sync-nudge fired from a linked lane: drift detected against the MAIN
 *   root's ROADMAP.md, debounce state written at the main root (not the lane)
 * - tracked .project-manager/ → per-worktree behavior: pm-update from a lane
 *   edits the lane's own roadmap and leaves the main root's untouched
 * - resolver boundary: a `.gitignore` pattern without the trailing slash
 *   (`.project-manager`) still resolves a lane to the main root
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SWEEP_PATH = path.join(ROOT, 'ship', 'lane-sweep.cjs');
const PM_UPDATE_PATH = path.join(ROOT, 'ship', 'pm-update.cjs');
const NUDGE_PATH = path.join(ROOT, 'hooks', 'pm-sync-nudge.cjs');
const { resolveStateRoot } = require(path.join(ROOT, 'ship', 'resolve-state-root.cjs'));
const { sweep } = require(SWEEP_PATH);

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

/** Init a repo with local identity and a committed .gitignore. */
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

/** Feature with CONTEXT.md status and an optional PLAN.md <files> claim set. */
function createFeature(dir, name, status, files) {
  const featureDir = path.join(dir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`
  );
  if (files) {
    fs.writeFileSync(
      path.join(featureDir, 'PLAN.md'),
      [
        '---',
        `feature: "${name}"`,
        'goal: "test"',
        '---',
        '',
        '<task id="1" status="pending">',
        `  <files>${files.join(', ')}</files>`,
        '</task>',
        '',
      ].join('\n')
    );
  }
}

function roadmap(rows) {
  const lines = [
    '---',
    'project: "Fleet Test"',
    'updated: "2026-08-10"',
    '---',
    '',
    '## Milestones',
    '',
    '### M1 — Fleet (status: active)',
    '',
    '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(`| ${r.item} | ${r.status} | P1 | — | — | test | ${r.slug} | ${r.lane || '—'} |`);
  }
  return lines.join('\n') + '\n';
}

function writeRoadmap(dir, rows) {
  const pmDir = path.join(dir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  const content = roadmap(rows);
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), content);
  return content;
}

/** Run the nudge hook with a given cwd (stdin JSON), resolve parsed stdout. */
function runNudge(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NUDGE_PATH], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) => {
      let output = null;
      if (stdout.trim()) {
        try { output = JSON.parse(stdout); } catch (e) { /* raw kept below */ }
      }
      resolve({ code, output, raw: stdout });
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ cwd }));
    child.stdin.end();
  });
}

const realKey = (p) => {
  const real = fs.realpathSync(p);
  return process.platform === 'win32' ? real.toLowerCase() : real;
};

describe('multi-worktree integration', { skip: !gitAvailable }, () => {
  let base, repoDir, laneDir;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-mw-int-')));
    repoDir = path.join(base, 'repo');
    laneDir = path.join(base, 'lane');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('sweep() across two live worktrees detects a case-differing cross-lane overlap', () => {
    initRepo(repoDir, '.project-manager/\n.planning/\n');
    git(repoDir, 'worktree', 'add', '-b', 'feature/x', laneDir);

    // Same file claimed with different case across lanes — must still collide.
    createFeature(repoDir, 'feat-main', 'building', ['src/Shared.js', 'src/main-only.js']);
    createFeature(laneDir, 'feat-x', 'planned', ['src/shared.js', 'src/lane-only.js']);

    const result = sweep(laneDir); // run FROM the lane — enumeration must not be lane-relative
    assert.equal(result.error, undefined, 'live repo sweep must not degrade');
    assert.equal(result.lanes.length, 2, 'both worktrees enumerated');

    const main = result.lanes.find((l) => l.isMain);
    const lane = result.lanes.find((l) => !l.isMain);
    assert.ok(main && lane, 'exactly one main and one linked lane');
    assert.equal(realKey(main.path), realKey(repoDir), 'main lane is the main worktree');
    assert.equal(lane.branch, 'feature/x', 'linked lane carries its branch name');
    assert.deepEqual(main.features.map((f) => f.name), ['feat-main'], 'feature attributed to its own lane');
    assert.deepEqual(lane.features.map((f) => f.name), ['feat-x'], 'lane feature not leaked to main');

    assert.equal(result.overlaps.length, 1, 'exactly one overlapping file');
    assert.equal(result.overlaps[0].file.toLowerCase(), 'src/shared.js');
    const claimants = result.overlaps[0].claims.map((c) => c.feature).sort();
    assert.deepEqual(claimants, ['feat-main', 'feat-x'], 'both lanes named as claimants');
  });

  it('nudge from a linked lane reads the MAIN roadmap and debounces at the main root', async () => {
    initRepo(repoDir, '.project-manager/\n.planning/\n');
    writeRoadmap(repoDir, [{ item: 'Lane thing', status: 'pending', slug: 'lane-feature' }]);
    git(repoDir, 'worktree', 'add', laneDir);
    createFeature(laneDir, 'lane-feature', 'building'); // actual in-progress vs recorded pending → drift

    const first = await runNudge(laneDir);
    assert.ok(first.output, `nudge must fire from the lane (raw: ${first.raw})`);
    const ctx = first.output.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('lane-feature'), 'nudge names the drifted slug');

    const mainState = path.join(repoDir, '.project-manager', '.nudge-state.json');
    assert.ok(fs.existsSync(mainState), 'debounce state written at the MAIN root');
    assert.ok(
      !fs.existsSync(path.join(laneDir, '.project-manager')),
      'lane must not grow a .project-manager/ of its own'
    );

    const second = await runNudge(laneDir);
    assert.equal(second.output, null, 'identical drift set is debounced via the shared state');
  });

  it('tracked .project-manager/ stays per-worktree: lane update never touches the main root', () => {
    initRepo(repoDir, '.planning/\n'); // .project-manager NOT ignored → tracked-state mode
    const mainBefore = writeRoadmap(repoDir, [{ item: 'Main thing', status: 'pending', slug: 'main-feature' }]);
    git(repoDir, 'worktree', 'add', laneDir);
    writeRoadmap(laneDir, [{ item: 'Lane thing', status: 'in-progress', slug: 'lane-feature' }]);
    fs.mkdirSync(path.join(laneDir, '.planning', 'archive', 'lane-feature'), { recursive: true });

    const r = resolveStateRoot(laneDir);
    assert.equal(r.gitignored, false);
    assert.equal(realKey(r.root), realKey(laneDir), 'tracked state resolves to the lane itself');

    const cli = spawnSync(process.execPath, [PM_UPDATE_PATH, 'lane-feature'], { cwd: laneDir, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);

    const laneAfter = fs.readFileSync(path.join(laneDir, '.project-manager', 'ROADMAP.md'), 'utf8');
    assert.ok(laneAfter.includes('| Lane thing | done |'), 'lane-local roadmap updated');
    assert.equal(
      fs.readFileSync(path.join(repoDir, '.project-manager', 'ROADMAP.md'), 'utf8'),
      mainBefore,
      'main root roadmap untouched in tracked mode'
    );
  });

  it('gitignore pattern without trailing slash still anchors a lane to the main root', () => {
    initRepo(repoDir, '.project-manager\n.planning\n'); // no trailing slashes
    git(repoDir, 'worktree', 'add', laneDir);

    const r = resolveStateRoot(laneDir);
    assert.equal(r.gitignored, true, 'slashless ignore pattern still counts as gitignored');
    assert.equal(r.fallback, false);
    assert.equal(realKey(r.root), realKey(repoDir), 'lane resolves to the main root');
  });
});
