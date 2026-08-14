const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'lane-sweep.cjs');
const { parseWorktrees, planFiles, findOverlaps, sweep } = require(SCRIPT_PATH);

/** Real git is needed only for the CLI smoke suite. */
const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

describe('lane-sweep: parseWorktrees', () => {
  const porcelain = [
    'worktree C:/repos/main',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree C:/repos/lanes/feature-x',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature/x',
    '',
    'worktree C:/repos/lanes/spike',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
  ].join('\n');

  it('parses main, linked, and detached worktrees', () => {
    const wts = parseWorktrees(porcelain);
    assert.equal(wts.length, 3);

    assert.equal(wts[0].path, 'C:/repos/main');
    assert.equal(wts[0].branch, 'main', 'refs/heads/ prefix stripped');
    assert.equal(wts[0].head, '1111111111111111111111111111111111111111');
    assert.equal(wts[0].isMain, true, 'first block is the main worktree');

    assert.equal(wts[1].path, 'C:/repos/lanes/feature-x');
    assert.equal(wts[1].branch, 'feature/x');
    assert.equal(wts[1].isMain, false);

    assert.equal(wts[2].branch, null, 'detached worktree has no branch');
    assert.equal(wts[2].isMain, false);
  });

  it('normalizes backslash paths to forward slashes', () => {
    const wts = parseWorktrees('worktree C:\\repos\\main\nHEAD 1111\nbranch refs/heads/main\n');
    assert.equal(wts[0].path, 'C:/repos/main');
  });

  it('tolerates bare and unknown attribute lines', () => {
    const wts = parseWorktrees([
      'worktree C:/repos/main',
      'HEAD 1111111111111111111111111111111111111111',
      'bare',
      'locked reason unknown to this parser',
      '',
      'worktree C:/repos/lanes/x',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/x',
      '',
    ].join('\n'));
    assert.equal(wts.length, 2);
    assert.equal(wts[0].isMain, true);
    assert.equal(wts[1].branch, 'x');
  });

  it('empty or garbage input → empty array, no throw', () => {
    assert.deepEqual(parseWorktrees(''), []);
    assert.deepEqual(parseWorktrees('not porcelain at all\n\nstill not'), []);
  });
});

describe('lane-sweep: planFiles', () => {
  it('extracts, splits, trims, and dedupes <files> bodies', () => {
    const plan = [
      '<phase id="1" name="Core" status="pending">',
      '',
      '<task id="1" status="done">',
      '  <files>src/auth/login.ts, src/auth/session.ts</files>',
      '</task>',
      '',
      '<task id="2" status="pending">',
      '  <files>src/auth/login.ts,',
      '  tests\\auth.test.ts</files>',
      '</task>',
      '',
      '</phase>',
    ].join('\n');

    assert.deepEqual(planFiles(plan), [
      'src/auth/login.ts',
      'src/auth/session.ts',
      'tests/auth.test.ts',
    ]);
  });

  it('no <files> tags → empty array', () => {
    assert.deepEqual(planFiles('# A plan with no tasks yet\n'), []);
    assert.deepEqual(planFiles(''), []);
  });
});

describe('lane-sweep: findOverlaps', () => {
  const lane = (p, branch, features) => ({ path: p, branch, features });
  const feat = (name, status, files) => ({ name, status, files });

  it('flags a file claimed by in-flight features in two lanes', () => {
    const overlaps = findOverlaps([
      lane('C:/repos/main', 'main', [feat('feat-a', 'building', ['src/shared.js', 'src/a.js'])]),
      lane('C:/repos/lanes/x', 'feature/x', [feat('feat-b', 'planned', ['src/shared.js', 'src/b.js'])]),
    ]);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].file, 'src/shared.js');
    assert.deepEqual(overlaps[0].claims, [
      { lane: 'C:/repos/main', branch: 'main', feature: 'feat-a' },
      { lane: 'C:/repos/lanes/x', branch: 'feature/x', feature: 'feat-b' },
    ]);
  });

  it('disjoint plans → empty array', () => {
    const overlaps = findOverlaps([
      lane('C:/repos/main', 'main', [feat('feat-a', 'building', ['src/a.js'])]),
      lane('C:/repos/lanes/x', 'feature/x', [feat('feat-b', 'building', ['src/b.js'])]),
    ]);
    assert.deepEqual(overlaps, []);
  });

  it('two features in the same lane sharing a file is not a collision', () => {
    const overlaps = findOverlaps([
      lane('C:/repos/main', 'main', [
        feat('feat-a', 'building', ['src/shared.js']),
        feat('feat-b', 'planned', ['src/shared.js']),
      ]),
    ]);
    assert.deepEqual(overlaps, []);
  });

  it('path comparison is case-insensitive (Windows)', () => {
    const overlaps = findOverlaps([
      lane('C:/repos/main', 'main', [feat('feat-a', 'building', ['Src/Shared.js'])]),
      lane('C:/repos/lanes/x', 'feature/x', [feat('feat-b', 'building', ['src/shared.js'])]),
    ]);
    assert.equal(overlaps.length, 1, 'Src/Shared.js and src/shared.js are the same file');
  });

  it('done features claim nothing', () => {
    const overlaps = findOverlaps([
      lane('C:/repos/main', 'main', [feat('feat-a', 'done', ['src/shared.js'])]),
      lane('C:/repos/lanes/x', 'feature/x', [feat('feat-b', 'building', ['src/shared.js'])]),
    ]);
    assert.deepEqual(overlaps, [], 'a done feature is not in flight');
  });
});

describe('lane-sweep: sweep degrade', () => {
  it('non-repo directory → empty sweep with error, no throw', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-sweep-'));
    try {
      const result = sweep(tmpDir);
      assert.deepEqual(result.lanes, []);
      assert.deepEqual(result.overlaps, []);
      assert.equal(result.error, 'not a git repository or git unavailable');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('lane-sweep: CLI smoke', { skip: !gitAvailable }, () => {
  it('prints valid JSON with one lane for a plain repo', () => {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-sweep-cli-')));
    try {
      const git = (...args) => {
        const r = spawnSync('git', args, { cwd: tmpDir, encoding: 'utf8' });
        assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
      };
      git('init');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Ship Test');
      git('config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'smoke\n');
      git('add', 'README.md');
      git('commit', '-m', 'init');

      const r = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: tmpDir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const result = JSON.parse(r.stdout);
      assert.equal(result.lanes.length, 1, 'a plain repo is a single lane');
      assert.equal(result.lanes[0].isMain, true);
      assert.deepEqual(result.lanes[0].features, [], 'no .planning/ → no features');
      assert.deepEqual(result.overlaps, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
