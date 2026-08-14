const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveStateRoot } = require(path.join(__dirname, '..', 'ship', 'resolve-state-root.cjs'));

/** Real git repos are required for everything but the fallback case. */
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

/**
 * Comparison key for paths: realpath (resolves 8.3 short names and symlinked
 * temp dirs), case-folded on Windows. Tolerant of separator differences
 * because realpathSync returns native separators for both inputs.
 */
function realKey(p) {
  const real = fs.realpathSync(p);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Init a repo with local identity and a committed .gitignore. The .gitignore
 * must be committed (not just present) so linked worktrees check out a copy
 * and `git check-ignore` sees it from every lane.
 */
function initRepo(dir, { ignorePm = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    ignorePm ? '.project-manager/\n.planning/\n' : '.planning/\n'
  );
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'init');
}

describe('resolve-state-root: git repos', { skip: !gitAvailable }, () => {
  let base;

  beforeEach(() => {
    // realpath immediately: os.tmpdir() can be a short (8.3) or symlinked
    // path, and every later comparison keys on the real path.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-resolver-')));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('main worktree, gitignored .project-manager/ → main root, gitignored', () => {
    const repo = path.join(base, 'repo');
    initRepo(repo);

    const r = resolveStateRoot(repo);
    assert.equal(r.gitignored, true);
    assert.equal(r.fallback, false);
    assert.equal(realKey(r.root), realKey(repo));
    assert.equal(realKey(r.mainRoot), realKey(repo));
  });

  it('linked worktree, gitignored → root is the MAIN root, not the lane', () => {
    const repo = path.join(base, 'repo');
    const lane = path.join(base, 'lane');
    initRepo(repo);
    git(repo, 'worktree', 'add', lane);

    const r = resolveStateRoot(lane);
    assert.equal(r.gitignored, true);
    assert.equal(r.fallback, false);
    assert.equal(realKey(r.root), realKey(repo), 'root must be the main worktree root');
    assert.notEqual(realKey(r.root), realKey(lane), 'root must not be the lane');
    assert.equal(realKey(r.mainRoot), realKey(repo), 'mainRoot set to the main worktree root');
  });

  it('.project-manager/ NOT gitignored → root is cwd, gitignored false', () => {
    const repo = path.join(base, 'repo');
    initRepo(repo, { ignorePm: false });

    const r = resolveStateRoot(repo);
    assert.equal(r.gitignored, false);
    assert.equal(r.fallback, false);
    assert.equal(realKey(r.root), realKey(repo), 'tracked state stays per-worktree at cwd');
    assert.equal(realKey(r.mainRoot), realKey(repo), 'mainRoot still resolved');
  });

  it('normalization: forward-slash cwd input resolves to the same real root', () => {
    const repo = path.join(base, 'repo');
    initRepo(repo);

    const r = resolveStateRoot(repo.replace(/\\/g, '/'));
    assert.ok(path.isAbsolute(r.root), 'root is absolute');
    assert.equal(realKey(r.root), realKey(repo), 'separator style of the input is irrelevant');
  });
});

describe('resolve-state-root: fallback', () => {
  let base;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-resolver-plain-')));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('non-repo directory → cwd fallback, never throws', () => {
    const dir = path.join(base, 'plain');
    fs.mkdirSync(dir);

    const r = resolveStateRoot(dir);
    assert.equal(r.fallback, true);
    assert.equal(r.gitignored, false);
    assert.equal(r.mainRoot, null);
    assert.equal(r.root, dir, 'fallback returns the cwd untouched');
  });
});
