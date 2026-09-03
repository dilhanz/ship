// Behavioral tests for ship/find-features.cjs — the worktree-aware feature
// lookup. The failure this guards: a consumer skill run from the main checkout
// cannot see a feature whose directory /ship:start moved into a worktree, and
// reports it as "not started"; or the helper dies (non-zero exit, invalid JSON)
// on a machine with no git, which would take /ship:ledger down with it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const helperPath = path.join(repoRoot, 'ship', 'find-features.cjs');
const { parseWorktreeList, listWorktrees, readStatus, findFeatures } = require(helperPath);

// An env where no `git` can be found. Only the helper's in-module git spawn
// resolves against this PATH; the tests spawn the CLI via process.execPath so
// the child itself is never looked up through it.
const noGitEnv = { ...process.env, PATH: '/nonexistent' };

function withTmpDir(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-find-features-')));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1 — parseWorktreeList
// ---------------------------------------------------------------------------

describe('find-features: parseWorktreeList', () => {
  const sample = [
    'worktree /repos/main',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repos/main/.claude/worktrees/alpha',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature/alpha',
    '',
    'worktree /repos/elsewhere',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
  ].join('\n');

  it('parses main, a branch worktree, and a detached worktree', () => {
    const list = parseWorktreeList(sample);
    assert.equal(list.length, 3);
    assert.deepEqual(list[0], {
      path: '/repos/main',
      branch: 'main',
      head: '1111111111111111111111111111111111111111',
      isMain: true,
    });
    assert.deepEqual(list[1], {
      path: '/repos/main/.claude/worktrees/alpha',
      branch: 'feature/alpha',
      head: '2222222222222222222222222222222222222222',
      isMain: false,
    });
    assert.deepEqual(list[2], {
      path: '/repos/elsewhere',
      branch: null,
      head: '3333333333333333333333333333333333333333',
      isMain: false,
    });
  });

  it('only the first block is main', () => {
    const mains = parseWorktreeList(sample).filter(w => w.isMain);
    assert.equal(mains.length, 1);
    assert.equal(mains[0].path, '/repos/main');
  });

  it('tolerates CRLF line endings', () => {
    const list = parseWorktreeList(sample.replace(/\n/g, '\r\n'));
    assert.equal(list.length, 3);
    assert.equal(list[1].branch, 'feature/alpha');
    assert.equal(list[1].path, '/repos/main/.claude/worktrees/alpha');
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(parseWorktreeList(''), []);
    assert.deepEqual(parseWorktreeList('\n\n'), []);
  });

  it('skips a block with no worktree line', () => {
    const list = parseWorktreeList('HEAD abc\nbranch refs/heads/x\n\nworktree /repos/main\nHEAD def\nbranch refs/heads/main\n');
    assert.equal(list.length, 1);
    assert.equal(list[0].path, '/repos/main');
    assert.ok(list[0].isMain, 'the first *kept* block is main');
  });

  it('a bare block has no branch and no head', () => {
    const list = parseWorktreeList('worktree /repos/bare.git\nbare\n\nworktree /repos/wt\nHEAD abc\nbranch refs/heads/main\n');
    assert.deepEqual(list[0], { path: '/repos/bare.git', branch: null, head: null, isMain: true });
    assert.equal(list[1].isMain, false);
  });
});

// ---------------------------------------------------------------------------
// 2 — listWorktrees: the no-git fallback and the cwd match
// ---------------------------------------------------------------------------

describe('find-features: listWorktrees', () => {
  it('falls back to the cwd as the sole main worktree when git is unreachable', () => {
    withTmpDir((root) => {
      const { worktrees, warning } = listWorktrees(root, { env: noGitEnv });
      assert.deepEqual(worktrees, [{ path: root, branch: null, head: null, isMain: true, isCwd: true }]);
      assert.ok(warning, 'the fallback is reported, never silent');
      assert.match(warning, /git worktree list unavailable/);
      assert.match(warning, /current checkout only/);
    });
  });

  it('in a plain directory returns either the fallback or a real list, never throws', () => {
    withTmpDir((root) => {
      const { worktrees } = listWorktrees(root);
      assert.ok(Array.isArray(worktrees));
      assert.ok(worktrees.length >= 1);
      assert.equal(worktrees.filter(w => w.isMain).length, 1, 'exactly one main');
      for (const w of worktrees) {
        for (const k of ['path', 'branch', 'head', 'isMain', 'isCwd']) assert.ok(k in w, `missing ${k}`);
      }
    });
  });

  it('marks this repo checkout as cwd when git is available', () => {
    const { worktrees, warning } = listWorktrees(repoRoot);
    const here = worktrees.find(w => w.isCwd);
    if (warning && /unavailable/.test(warning)) return; // no git on this host — covered above
    assert.ok(here, 'the cwd is inside a listed worktree');
    assert.equal(fs.realpathSync(here.path), fs.realpathSync(repoRoot));
  });
});

// ---------------------------------------------------------------------------
// 3 — readStatus
// ---------------------------------------------------------------------------

describe('find-features: readStatus', () => {
  function withContext(content, fn) {
    withTmpDir((root) => {
      const file = path.join(root, 'CONTEXT.md');
      fs.writeFileSync(file, content);
      fn(file);
    });
  }

  it('reads status from the frontmatter block', () => {
    withContext('---\nfeature: "x"\nstatus: building\n---\n\nBody.\n', (file) => {
      assert.equal(readStatus(file), 'building');
    });
  });

  it('strips one layer of quotes and trims', () => {
    withContext('---\nstatus:  "planned"  \n---\n', (file) => {
      assert.equal(readStatus(file), 'planned');
    });
    withContext("---\nstatus: 'built'\n---\n", (file) => {
      assert.equal(readStatus(file), 'built');
    });
  });

  it('ignores a status: line in the body — frontmatter only', () => {
    withContext('---\nfeature: "x"\n---\n\n## Notes\n\nstatus: done\n', (file) => {
      assert.equal(readStatus(file), 'unknown');
    });
  });

  it('is unknown with no frontmatter at all', () => {
    withContext('# No frontmatter\n\nstatus: done\n', (file) => {
      assert.equal(readStatus(file), 'unknown');
    });
  });

  it('is CRLF-tolerant', () => {
    withContext('---\r\nstatus: verified\r\n---\r\n\r\nBody.\r\n', (file) => {
      assert.equal(readStatus(file), 'verified');
    });
  });

  it('returns null when the file cannot be read', () => {
    assert.equal(readStatus(path.join(os.tmpdir(), 'ship-no-such-context-file.md')), null);
  });
});

// ---------------------------------------------------------------------------
// 4 — findFeatures shape and the CLI contract
// ---------------------------------------------------------------------------

describe('find-features: findFeatures result shape', () => {
  it('returns the full shape with cwdRoot and mainRoot from the fallback entry', () => {
    withTmpDir((root) => {
      const r = findFeatures({ cwd: root, env: noGitEnv });
      for (const k of ['cwd', 'cwdRoot', 'mainRoot', 'worktrees', 'features', 'warning']) assert.ok(k in r, `missing ${k}`);
      assert.equal(r.cwd, root);
      assert.equal(r.cwdRoot, root);
      assert.equal(r.mainRoot, root);
      assert.deepEqual(r.features, {});
      assert.ok(r.warning);
    });
  });
});

describe('find-features: CLI', () => {
  it('prints one line of valid JSON from a plain directory', () => {
    withTmpDir((root) => {
      const stdout = execFileSync(process.execPath, [helperPath], { cwd: root, encoding: 'utf8' });
      assert.equal(stdout.split('\n').filter(Boolean).length, 1, 'one JSON line');
      const r = JSON.parse(stdout);
      assert.deepEqual(r.features, {});
      assert.ok(Array.isArray(r.worktrees));
    });
  });

  it('exits 0 with valid JSON and a warning when git is unreachable', () => {
    withTmpDir((root) => {
      const stdout = execFileSync(process.execPath, [helperPath], { cwd: root, encoding: 'utf8', env: noGitEnv });
      const r = JSON.parse(stdout);
      assert.equal(r.mainRoot, root);
      assert.equal(r.cwdRoot, root);
      assert.ok(r.warning);
      assert.deepEqual(r.features, {});
    });
  });

  it('ignores -- flags and takes the first bare argument as the slug', () => {
    withTmpDir((root) => {
      const stdout = execFileSync(process.execPath, [helperPath, '--verbose', 'nothing'], { cwd: root, encoding: 'utf8', env: noGitEnv });
      const r = JSON.parse(stdout);
      assert.deepEqual(r.features, {});
    });
  });
});

describe('doctrine — the helper CLI cannot truncate its own output', () => {
  it('does not call process.exit after writing stdout', () => {
    const code = fs.readFileSync(helperPath, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/process\.exit\(/.test(code),
      'stdout to a pipe is async on Windows and the skills read this through one; an explicit exit can truncate the JSON payload',
    );
  });
});

// ---------------------------------------------------------------------------
// 5 — a fixture repo with a real linked worktree: the /ship:start handoff
// ---------------------------------------------------------------------------

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (e) {
  gitAvailable = false;
}

/**
 * Build a throwaway git repo (branch `main`, one commit, `.planning/`
 * gitignored — exactly this repo's shape) and hand `fn` helpers to write
 * feature dirs at any root and to add linked worktrees. The tmp root is
 * realpath-resolved up front because git reports realpaths in porcelain
 * output and macOS's tmpdir is a symlink.
 */
function withFixtureRepo(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-find-features-repo-')));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    git('config', 'user.email', 'ship-tests@example.com');
    git('config', 'user.name', 'Ship Tests');
    git('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'README'), 'fixture\n');
    fs.writeFileSync(path.join(root, '.gitignore'), '.planning/\n');
    git('add', 'README', '.gitignore');
    git('commit', '-q', '-m', 'init');

    const context = (slug, status, extraBody) => {
      const body = extraBody || '';
      return `---\nfeature: "${slug}"\n${status === undefined ? '' : `status: ${status}\n`}---\n\n## Problem\n\nSomething.\n${body}`;
    };
    const writeFeature = (atRoot, slug, status, opts) => {
      const dir = path.join(atRoot, '.planning', 'features', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CONTEXT.md'), (opts && opts.content) || context(slug, status, opts && opts.body));
      if (opts && opts.plan) fs.writeFileSync(path.join(dir, 'PLAN.md'), opts.plan);
      return dir;
    };
    const writeArchived = (atRoot, slug, status) => {
      const dir = path.join(atRoot, '.planning', 'archive', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CONTEXT.md'), context(slug, status));
      return dir;
    };
    const addWorktree = (slug, branch) => {
      const wtPath = path.join(root, '.claude', 'worktrees', slug);
      fs.mkdirSync(path.dirname(wtPath), { recursive: true });
      git('worktree', 'add', '-q', '-b', branch, wtPath, 'main');
      return fs.realpathSync(wtPath);
    };

    return fn({ root, writeFeature, writeArchived, addWorktree });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('find-features: fixture repo with a linked worktree', { skip: gitAvailable ? false : 'git is not on PATH — the worktree fixture cannot be built' }, () => {
  it('1. from the main root, a feature moved into feature/{slug} resolves with its real status', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');

      const r = findFeatures({ cwd: root });
      assert.equal(r.warning, null);
      assert.equal(r.mainRoot, root);
      const alpha = r.features.alpha;
      assert.ok(alpha, 'the moved feature is visible from main');
      assert.equal(alpha.status, 'building');
      assert.equal(alpha.location, 'worktree');
      assert.equal(alpha.branch, 'feature/alpha');
      assert.equal(alpha.here, false);
      assert.equal(alpha.owner, 'sole');
      assert.equal(alpha.path, wt, 'path is the worktree realpath');
      assert.equal(alpha.dir, path.join(wt, '.planning', 'features', 'alpha'));
    });
  });

  it('2. from inside the worktree, the same slug and a main-only feature both resolve', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      writeFeature(root, 'beta', 'planned');

      const r = findFeatures({ cwd: wt });
      assert.equal(r.cwdRoot, wt);
      assert.equal(r.mainRoot, root);
      assert.equal(r.features.alpha.here, true);
      assert.equal(r.features.alpha.status, 'building');
      assert.equal(r.features.beta.location, 'main');
      assert.equal(r.features.beta.here, false);
      assert.equal(r.features.beta.status, 'planned');
      assert.equal(r.features.beta.branch, 'main');
    });
  });

  it('3. duplicates: the worktree on feature/{slug} wins exactly once', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      writeFeature(root, 'gamma', 'planned');
      const wt = addWorktree('gamma', 'feature/gamma');
      writeFeature(wt, 'gamma', 'building');

      const gamma = findFeatures({ cwd: root }).features.gamma;
      assert.equal(gamma.owner, 'branch');
      assert.equal(gamma.copies, 2);
      assert.equal(gamma.status, 'building', 'the branch copy, not the furthest-along one');
      assert.equal(gamma.candidates.length, 2);
      assert.equal(gamma.path, wt);
      assert.equal(gamma.here, false);
    });
  });

  it('3b. duplicates: a bare-slug branch also wins', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      writeFeature(root, 'gamma2', 'verified');
      const wt = addWorktree('gamma2', 'gamma2');
      writeFeature(wt, 'gamma2', 'planned');

      const gamma2 = findFeatures({ cwd: root }).features.gamma2;
      assert.equal(gamma2.owner, 'branch');
      assert.equal(gamma2.branch, 'gamma2');
      assert.equal(gamma2.status, 'planned', 'branch match, not the higher status');
      assert.equal(gamma2.path, wt);
    });
  });

  it('4. honest ambiguity: no branch match and no cwd copy → ambiguous with null status', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const a = addWorktree('topic-a', 'topic-a');
      const b = addWorktree('topic-b', 'topic-b');
      writeFeature(a, 'delta', 'planned');
      writeFeature(b, 'delta', 'built');

      const delta = findFeatures({ cwd: root }).features.delta;
      assert.equal(delta.owner, 'ambiguous');
      assert.equal(delta.copies, 2);
      assert.equal(delta.status, null, 'disagreeing copies yield no status — never the furthest-along one');
      assert.equal(delta.dir, null);
      assert.equal(delta.branch, null);
      assert.equal(delta.path, null);
      assert.equal(delta.here, false);
      assert.deepEqual(delta.candidates.map(c => c.branch).sort(), ['topic-a', 'topic-b']);
    });
  });

  it('4b. ambiguity with identical statuses reports the shared status', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const a = addWorktree('topic-a', 'topic-a');
      const b = addWorktree('topic-b', 'topic-b');
      writeFeature(a, 'delta', 'planned');
      writeFeature(b, 'delta', 'planned');

      const delta = findFeatures({ cwd: root }).features.delta;
      assert.equal(delta.owner, 'ambiguous');
      assert.equal(delta.status, 'planned');
    });
  });

  it('5. cwd wins when no branch matches', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      writeFeature(root, 'epsilon', 'planned');
      const wt = addWorktree('topic-c', 'topic-c');
      writeFeature(wt, 'epsilon', 'building');

      const fromMain = findFeatures({ cwd: root }).features.epsilon;
      assert.equal(fromMain.owner, 'cwd');
      assert.equal(fromMain.status, 'planned');
      assert.equal(fromMain.location, 'main');
      assert.equal(fromMain.here, true);

      const fromWt = findFeatures({ cwd: wt }).features.epsilon;
      assert.equal(fromWt.owner, 'cwd');
      assert.equal(fromWt.status, 'building');
      assert.equal(fromWt.location, 'worktree');
      assert.equal(fromWt.here, true);
    });
  });

  it('6. a slug with no dir anywhere resolves to nothing', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');

      assert.deepEqual(findFeatures({ cwd: root, slug: 'nothing' }).features, {});
      assert.ok(!('nothing' in findFeatures({ cwd: root }).features));
    });
  });

  it('7. the archive is a fallback: location archive, and alsoArchived beside a live copy', () => {
    withFixtureRepo(({ root, writeFeature, writeArchived }) => {
      const zetaDir = writeArchived(root, 'zeta', 'done');
      writeFeature(root, 'eta', 'building');
      writeArchived(root, 'eta', 'done');

      const filtered = findFeatures({ cwd: root, slug: 'zeta' }).features.zeta;
      assert.equal(filtered.location, 'archive');
      assert.equal(filtered.status, 'done');
      assert.equal(filtered.copies, 0);
      assert.equal(filtered.owner, 'sole');
      assert.equal(filtered.dir, zetaDir);
      assert.equal(filtered.path, root);
      assert.equal(filtered.branch, null);
      assert.deepEqual(filtered.candidates, []);
      assert.equal(filtered.alsoArchived, false);

      const all = findFeatures({ cwd: root }).features;
      assert.ok(all.zeta, 'archived slugs appear without a filter so the ledger can flag them');
      assert.equal(all.zeta.location, 'archive');
      assert.equal(all.eta.location, 'main', 'a live copy beats the archive');
      assert.equal(all.eta.status, 'building');
      assert.equal(all.eta.alsoArchived, true);
    });
  });

  it('8. a terminal status is kept, unfiltered', () => {
    withFixtureRepo(({ root, writeFeature }) => {
      writeFeature(root, 'theta', 'done');
      const theta = findFeatures({ cwd: root }).features.theta;
      assert.ok(theta);
      assert.equal(theta.status, 'done');

      const { scanFeatures } = require(path.join(repoRoot, 'hooks', 'scan-features.cjs'));
      assert.deepEqual(scanFeatures(root), [], 'scanFeatures still drops done — its behavior is untouched');
    });
  });

  it('9. status is read from the frontmatter only', () => {
    withFixtureRepo(({ root, writeFeature }) => {
      writeFeature(root, 'iota', undefined, { body: '\nstatus: done\n' });
      assert.equal(findFeatures({ cwd: root }).features.iota.status, 'unknown');
    });
  });

  it('10. a slug filter returns exactly one key', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      writeFeature(root, 'beta', 'planned');

      const features = findFeatures({ cwd: root, slug: 'alpha' }).features;
      assert.deepEqual(Object.keys(features), ['alpha']);
      assert.equal(features.alpha.status, 'building');
    });
  });

  it('11. CLI parity, and the CLI survives an unreachable git', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      writeFeature(root, 'beta', 'planned');

      // process.execPath, never 'node': a bare name is resolved against the
      // child's env.PATH, and the hostile-PATH call below would fail the spawn
      // itself with ENOENT before the helper ever ran.
      const viaCli = JSON.parse(execFileSync(process.execPath, [helperPath, 'alpha'], { cwd: root, encoding: 'utf8' }));
      const viaModule = findFeatures({ cwd: root, slug: 'alpha' });
      assert.deepEqual(viaCli.features.alpha, viaModule.features.alpha);
      assert.deepEqual(Object.keys(viaCli.features), ['alpha']);

      const noGit = JSON.parse(execFileSync(process.execPath, [helperPath], { cwd: root, encoding: 'utf8', env: noGitEnv }));
      assert.ok(noGit.warning, 'the degraded lookup is reported');
      assert.equal(noGit.mainRoot, root);
      assert.equal(noGit.features.beta.here, true, 'main-only feature still resolves from the cwd');
      assert.equal(noGit.features.beta.location, 'main');
      assert.ok(!('alpha' in noGit.features), 'without git, other worktrees are invisible — today\'s behavior');
    });
  });

  it('12. a worktree whose directory was deleted is skipped, not fatal', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('gone', 'feature/gone');
      writeFeature(root, 'beta', 'planned');
      fs.rmSync(wt, { recursive: true, force: true });

      const r = findFeatures({ cwd: root });
      assert.equal(r.features.beta.status, 'planned');
      assert.equal(r.features.beta.here, true);
      assert.ok(r.worktrees.length >= 1);
      if (r.worktrees.some(w => w.path === wt)) {
        assert.match(r.warning || '', /gone/, 'the still-listed missing worktree is named in the warning');
      }
    });
  });

  it('13. an owned live copy is enriched with task progress from its own PLAN.md', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      const plan = [
        '---',
        'feature: "alpha"',
        'goal: "Do the thing"',
        '---',
        '',
        '<task id="1" status="done">',
        '</task>',
        '<task id="2" status="done">',
        '</task>',
        '<task id="3" status="pending">',
        '</task>',
        '',
      ].join('\n');
      writeFeature(wt, 'alpha', 'building', { plan });

      const alpha = findFeatures({ cwd: root }).features.alpha;
      assert.equal(alpha.tasks.total, 3);
      assert.equal(alpha.tasks.done, 2);
      assert.equal(alpha.tasks.pending, 1);
      assert.equal(alpha.goal, 'Do the thing');
    });
  });

  it('13b. a terminal-status feature gets no enrichment and no error', () => {
    withFixtureRepo(({ root, writeFeature }) => {
      writeFeature(root, 'theta', 'done', { plan: '<task id="1" status="done">\n</task>\n' });
      const theta = findFeatures({ cwd: root }).features.theta;
      assert.equal(theta.status, 'done');
      assert.ok(!('tasks' in theta), 'scanFeatures has no snapshot for a done feature');
    });
  });
});
