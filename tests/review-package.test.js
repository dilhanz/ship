// Tests for ship/review-package.cjs — the one-file log + stat + diff package a
// per-task phase reviewer reads instead of running git diff itself.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'ship', 'review-package.cjs');
const { buildPackage, isValidRange } = require(SCRIPT);

const SLUG = 'sample-feature';

function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
    return r.stdout.trim();
  };
}

/** Repo with two commits: a 30-line file, then a change at line 15. */
function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pkg-')));
  const git = gitIn(dir);
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Ship Test');
  git('config', 'commit.gpgsign', 'false');
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  fs.writeFileSync(path.join(dir, 'f.txt'), lines.join('\n') + '\n');
  git('add', 'f.txt');
  git('commit', '-q', '-m', 'first');
  const base = git('rev-parse', 'HEAD');
  lines[14] = 'line 15 changed';
  fs.writeFileSync(path.join(dir, 'f.txt'), lines.join('\n') + '\n');
  git('add', 'f.txt');
  git('commit', '-q', '-m', 'second change');
  return { dir, base };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const pkgPath = (dir, scope) => path.join(dir, '.planning', 'features', SLUG, '.review-scratch', `package-${scope}.md`);

describe('review-package', () => {
  it('writes the three sections in order with 10 lines of context', () => {
    const { dir, base } = makeRepo();
    try {
      const r = buildPackage({ cwd: dir, feature: SLUG, range: `${base}..HEAD`, scope: 'phase-1' });
      assert.equal(r.ok, true, r.line);
      assert.equal(r.line, `.planning/features/${SLUG}/.review-scratch/package-phase-1.md — 1 commit(s), 1 file(s), ${r.line.match(/(\d+) diff line/)[1]} diff line(s)`);
      const text = fs.readFileSync(pkgPath(dir, 'phase-1'), 'utf8');
      assert.ok(text.startsWith(`# Review package — ${SLUG} — phase-1\n\nRange: ${base}..HEAD\n`));
      const iLog = text.indexOf('\n## Log\n');
      const iStat = text.indexOf('\n## Stat\n');
      const iDiff = text.indexOf('\n## Diff\n');
      assert.ok(iLog > 0 && iLog < iStat && iStat < iDiff, 'sections in order');
      assert.ok(text.slice(iLog, iStat).includes('second change'));
      assert.ok(text.slice(iStat, iDiff).includes('f.txt'));
      const diff = text.slice(iDiff);
      assert.ok(diff.includes('+line 15 changed'));
      assert.ok(diff.includes('\n line 7\n'), 'a line 8 lines before the change is in the hunk');
      assert.ok(diff.includes('\n line 23\n'), 'a line 8 lines after the change is in the hunk');
      assert.ok(diff.includes('\n line 5\n'), '10 lines of context reach line 5');
      assert.ok(!diff.includes('\n line 4\n'), 'line 4 is outside 10 lines of context');
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a hostile range before git runs', () => {
    const { dir } = makeRepo();
    try {
      for (const range of ['--output=/tmp/x..HEAD', '-x..HEAD', 'HEAD..-x', 'HEAD', 'a..b c', '..HEAD', '']) {
        assert.equal(isValidRange(range), false, range);
        const r = buildPackage({ cwd: dir, feature: SLUG, range, scope: 'phase-1' });
        assert.deepEqual([r.code, r.line], [1, 'review-package: invalid range'], range);
      }
      assert.equal(buildPackage({ cwd: dir, feature: '../x', range: 'HEAD~1..HEAD', scope: 'p' }).line, 'review-package: invalid feature');
      assert.equal(buildPackage({ cwd: dir, feature: SLUG, range: 'HEAD~1..HEAD', scope: 'a/b' }).line, 'review-package: invalid scope');
      assert.equal(fs.existsSync(path.join(dir, '.planning')), false);
    } finally {
      cleanup(dir);
    }
  });

  it('a range git cannot resolve exits 1 and writes nothing', () => {
    const { dir } = makeRepo();
    try {
      const r = spawnSync(process.execPath, [SCRIPT, SLUG, 'nosuchref..HEAD', 'phase-1'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /^review-package: git failed — .+\n$/);
      assert.equal(fs.existsSync(pkgPath(dir, 'phase-1')), false);
    } finally {
      cleanup(dir);
    }
  });

  it('an empty range is written and reports 0 files', () => {
    const { dir } = makeRepo();
    try {
      const r = buildPackage({ cwd: dir, feature: SLUG, range: 'HEAD..HEAD', scope: 'all' });
      assert.equal(r.code, 0);
      assert.ok(r.line.endsWith('— 0 commit(s), 0 file(s), 0 diff line(s)'), r.line);
      assert.ok(fs.existsSync(pkgPath(dir, 'all')));
    } finally {
      cleanup(dir);
    }
  });

  it('the CLI prints exactly one line', () => {
    const { dir } = makeRepo();
    try {
      const r = spawnSync(process.execPath, [SCRIPT, SLUG, 'HEAD~1..HEAD', 'phase-1'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trimEnd().split('\n').length, 1);
      assert.match(r.stdout, /^\.planning\/features\/sample-feature\/\.review-scratch\/package-phase-1\.md — 1 commit\(s\), 1 file\(s\), \d+ diff line\(s\)\n$/);
    } finally {
      cleanup(dir);
    }
  });
});
