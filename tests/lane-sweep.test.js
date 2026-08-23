const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'lane-sweep.cjs');
const { parseWorktrees, planFiles, findOverlaps, parseLaneStamp, resolveOwnership, sweep } = require(SCRIPT_PATH);

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
      assert.deepEqual(result.unowned, [], 'the degrade shape is identical on every path');
      assert.deepEqual(result.pendingHandoffs, []);
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
      assert.ok(Array.isArray(result.unowned), 'the CLI JSON always carries an unowned array');
      assert.deepEqual(result.unowned, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('lane-sweep: parseLaneStamp', () => {
  it('splits a well-formed stamp into branch and path', () => {
    assert.deepEqual(parseLaneStamp('feature/x @ C:/repos/lanes/x'), {
      branch: 'feature/x',
      path: 'C:/repos/lanes/x',
    });
  });

  it('strips one layer of surrounding quotes and normalizes slashes', () => {
    assert.deepEqual(parseLaneStamp('"main @ C:\\repos\\main"'), {
      branch: 'main',
      path: 'C:/repos/main',
    });
  });

  it('splits on the LAST separator', () => {
    assert.deepEqual(parseLaneStamp('feature/a @ b @ /repos/main'), {
      branch: 'feature/a @ b',
      path: '/repos/main',
    });
  });

  it('malformed stamps → null', () => {
    assert.equal(parseLaneStamp('no-separator'), null);
    assert.equal(parseLaneStamp(' @ /repos/main'), null, 'empty branch');
    assert.equal(parseLaneStamp('main @ '), null, 'empty path');
    assert.equal(parseLaneStamp(''), null);
    assert.equal(parseLaneStamp(null), null);
    assert.equal(parseLaneStamp(undefined), null);
    assert.equal(parseLaneStamp({ branch: 'main' }), null, 'non-string input');
  });
});

describe('lane-sweep: resolveOwnership', () => {
  const lane = (p, branch, features, extra = {}) =>
    ({ path: p, branch, isMain: false, features, handoffs: [], ...extra });
  const feat = (name, status, files, laneStamp = null) =>
    ({ name, status, currentPhase: null, tasks: null, files, lane: laneStamp });

  const ownedNames = (l) => l.features.map(f => f.name);

  it('a fleet of one owns every feature it holds, reason sole-lane', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [
        feat('alpha', 'building', ['src/a.js']),
        feat('beta', 'planned', ['src/b.js']),
      ], { isMain: true }),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), ['alpha', 'beta']);
    assert.deepEqual(result.lanes[0].features.map(f => f.ownedBy), ['sole-lane', 'sole-lane']);
    assert.deepEqual(result.unowned, []);
  });

  it('a slug held by one of three lanes resolves sole-lane', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [])], { isMain: true }),
      lane('/repos/lanes/x', 'feature/x', []),
      lane('/repos/lanes/y', 'feature/y', []),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), ['alpha']);
    assert.equal(result.lanes[0].features[0].ownedBy, 'sole-lane');
    assert.deepEqual(ownedNames(result.lanes[1]), []);
    assert.deepEqual(result.unowned, []);
  });

  it('copy-into-worktree tie: branch outranks two self-consistent stamps', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [
        feat('alpha', 'building', ['src/a.js'], 'main @ /repos/main'),
      ], { isMain: true }),
      lane('/repos/lanes/alpha', 'feature/alpha', [
        feat('alpha', 'building', ['src/a.js'], 'feature/alpha @ /repos/lanes/alpha'),
      ]),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), [], 'main reports zero rows for alpha');
    assert.deepEqual(ownedNames(result.lanes[1]), ['alpha']);
    assert.equal(result.lanes[1].features[0].ownedBy, 'branch');
    assert.deepEqual(result.unowned, []);
    assert.deepEqual(findOverlaps(result.lanes), [], 'one owner, so no phantom overlap');
  });

  it('a bare-{slug} branch matches, case-insensitively', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [])], { isMain: true }),
      lane('/repos/lanes/alpha', ' Alpha ', [feat('alpha', 'building', [])]),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), []);
    assert.equal(result.lanes[1].features[0].ownedBy, 'branch');
  });

  it('a detached lane never branch-matches', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [])], { isMain: true }),
      lane('/repos/lanes/alpha', null, [feat('alpha', 'building', [], 'x @ /repos/lanes/alpha')]),
    ]);

    assert.equal(result.lanes[1].features[0].ownedBy, 'stamp', 'falls through to the stamp layer');
  });

  it('two branch-matching lanes fall through to the stamp layer', () => {
    const result = resolveOwnership([
      lane('/repos/one', 'feature/alpha', [feat('alpha', 'building', [])]),
      lane('/repos/two', 'alpha', [feat('alpha', 'building', [], 'alpha @ /repos/two')]),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), []);
    assert.deepEqual(ownedNames(result.lanes[1]), ['alpha']);
    assert.equal(result.lanes[1].features[0].ownedBy, 'stamp');
    assert.deepEqual(result.unowned, []);
  });

  it('resolves by stamp when no branch matches, comparing path case-insensitively', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [])]),
      lane('C:/Repos/Lanes/Alpha', 'wip', [feat('alpha', 'building', [], 'renamed @ c:/repos/lanes/alpha')]),
    ]);

    assert.equal(result.lanes[1].features[0].ownedBy, 'stamp',
      'the worktree path is the identity — the branch component need not match');
    assert.deepEqual(ownedNames(result.lanes[0]), []);
  });

  it('two self-consistent stamps and no branch match → unowned', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', ['src/a.js'], 'main @ /repos/main')], { isMain: true }),
      lane('/repos/lanes/wip', 'wip', [feat('alpha', 'planned', ['src/a.js'], 'wip @ /repos/lanes/wip')]),
    ]);

    assert.deepEqual(ownedNames(result.lanes[0]), []);
    assert.deepEqual(ownedNames(result.lanes[1]), []);
    assert.equal(result.unowned.length, 1, 'hoisted once, not once per lane');
    assert.deepEqual(result.unowned[0], {
      name: 'alpha',
      lanes: [
        { path: '/repos/main', branch: 'main', status: 'building' },
        { path: '/repos/lanes/wip', branch: 'wip', status: 'planned' },
      ],
    });
    assert.deepEqual(findOverlaps(result.lanes), [], 'an unowned copy contributes no claim');
  });

  it('unowned entries carry no file claims', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', ['src/a.js'])]),
      lane('/repos/other', 'other', [feat('alpha', 'building', ['src/a.js'])]),
    ]);

    assert.equal(result.unowned.length, 1);
    assert.ok(!('files' in result.unowned[0]), 'an unowned feature is not a collision participant');
    for (const holder of result.unowned[0].lanes) {
      assert.deepEqual(Object.keys(holder).sort(), ['branch', 'path', 'status']);
    }
  });

  it('a stamp naming a different lane is not self-consistent', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [], 'main @ /repos/elsewhere')]),
      lane('/repos/other', 'other', [feat('alpha', 'building', [], 'other @ /repos/elsewhere')]),
    ]);

    assert.equal(result.unowned.length, 1, 'neither stamp vouches for its own lane');
  });

  it('a malformed stamp is never self-consistent', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [], 'no-separator')]),
      lane('/repos/other', 'other', [feat('alpha', 'building', [], 42)]),
    ]);

    assert.equal(result.unowned.length, 1);
    assert.deepEqual(ownedNames(result.lanes[0]), []);
    assert.deepEqual(ownedNames(result.lanes[1]), []);
  });

  it('unowned is sorted by name ascending', () => {
    const twice = (name) => [
      feat(name, 'building', []),
    ];
    const result = resolveOwnership([
      lane('/repos/main', 'main', [...twice('zulu'), ...twice('alpha'), ...twice('mike')]),
      lane('/repos/other', 'other', [...twice('mike'), ...twice('zulu'), ...twice('alpha')]),
    ]);

    assert.deepEqual(result.unowned.map(u => u.name), ['alpha', 'mike', 'zulu']);
  });

  it('does not mutate its input', () => {
    const mainFeature = feat('alpha', 'building', ['src/a.js']);
    const laneFeature = feat('alpha', 'building', ['src/a.js']);
    const input = [
      lane('/repos/main', 'main', [mainFeature]),
      lane('/repos/lanes/alpha', 'feature/alpha', [laneFeature]),
    ];

    const result = resolveOwnership(input);

    assert.equal(input[0].features.length, 1, 'the original lane still holds every copy');
    assert.equal(input[1].features.length, 1);
    assert.ok(!('ownedBy' in mainFeature), 'original records are untouched');
    assert.ok(!('ownedBy' in laneFeature));
    assert.notEqual(result.lanes[0], input[0], 'new lane objects are returned');
  });

  it('preserves every other lane key', () => {
    const result = resolveOwnership([
      lane('/repos/main', 'main', [feat('alpha', 'building', [])], {
        isMain: true,
        handoffs: [{ feature: 'alpha' }],
      }),
    ]);

    assert.equal(result.lanes[0].isMain, true);
    assert.deepEqual(result.lanes[0].handoffs, [{ feature: 'alpha' }]);
  });

  it('never throws on degenerate input', () => {
    assert.deepEqual(resolveOwnership(null), { lanes: [], unowned: [] });
    assert.deepEqual(resolveOwnership(undefined), { lanes: [], unowned: [] });
    assert.deepEqual(resolveOwnership([]), { lanes: [], unowned: [] });

    const noFeatures = resolveOwnership([{ path: '/repos/main', branch: 'main' }]);
    assert.deepEqual(noFeatures.lanes[0].features, []);
    assert.deepEqual(noFeatures.unowned, []);
  });
});
