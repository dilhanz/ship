/**
 * ship/finish-record.cjs — archive modes and the run record.
 *
 * Tracked `.planning/` archives inside the branch, untracked moves to the main
 * worktree, and an auto run's AUTO.json is never committed or archived.
 *
 * These tests run the helper against real throwaway repositories.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { archive, closeLedgerRow } = require(path.join(ROOT, 'ship', 'finish-record.cjs'));
const autoRun = require(path.join(ROOT, 'ship', 'auto-run.cjs'));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
delete GIT_ENV.GIT_DIR;
delete GIT_ENV.GIT_WORK_TREE;
delete GIT_ENV.GIT_INDEX_FILE;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const LEDGER = '# Ledger\n\n## Now\n- [ ] **foo** — the thing\n- [ ] **bar** — other\n\n## Next\n\n## Someday\n\n## Shipped\n_(empty)_\n';
const CONTEXT = '---\nfeature: foo\nstatus: done\n---\n\n# foo\n';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe('finish-record archive — tracked .planning', () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-finish-tracked-'));
    git(repo, ['init', '-q', '-b', 'main']);
    write(path.join(repo, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT);
    write(path.join(repo, '.planning', 'features', 'foo', 'AUTO.json'), '{}\n');
    write(path.join(repo, '.planning', 'LEDGER.md'), LEDGER);
    git(repo, ['add', '--', '.planning']);
    git(repo, ['commit', '-q', '-m', 'init']);
    git(repo, ['checkout', '-q', '-b', 'feature/foo']);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('archives inside the branch in one commit, ledger included', () => {
    const r = archive('foo', { cwd: repo });
    assert.equal(r.ok, true, r.warning);
    assert.equal(r.mode, 'tracked');
    assert.equal(r.ledger, 'moved');
    assert.ok(r.commit);

    assert.equal(git(repo, ['status', '--porcelain']), '', 'nothing left uncommitted');
    const files = git(repo, ['show', '--name-status', '--format=', 'HEAD']);
    assert.match(files, /\.planning\/archive\/foo\/CONTEXT\.md/);
    assert.match(files, /\.planning\/LEDGER\.md/);
    assert.match(git(repo, ['log', '-1', '--format=%s']), /^chore\(foo\): archive the feature record$/);

    const ledger = fs.readFileSync(path.join(repo, '.planning', 'LEDGER.md'), 'utf8');
    assert.ok(!ledger.includes('**foo**'), 'the open row is gone');
    assert.match(ledger, /## Shipped\n- \[x\] foo → \.planning\/archive\/foo\/\n$/);
    assert.ok(ledger.includes('**bar**'), 'other rows are untouched');
  });

  it('removes AUTO.json from the index and the disk, so it is never archived', () => {
    archive('foo', { cwd: repo });
    assert.equal(git(repo, ['ls-files', '--', '.planning/archive/foo/AUTO.json']), '');
    assert.equal(git(repo, ['ls-files', '--', '.planning/features/foo']), '');
    assert.ok(!fs.existsSync(path.join(repo, '.planning', 'archive', 'foo', 'AUTO.json')));
  });

  it('carries uncommitted stamps into the archive commit', () => {
    write(path.join(repo, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT.replace('status: done', 'status: done\noutcome: shipped'));
    archive('foo', { cwd: repo });
    assert.match(git(repo, ['show', 'HEAD:.planning/archive/foo/CONTEXT.md']), /^outcome: shipped$/m);
  });

  it('commits only the record and the ledger, not unrelated staged work', () => {
    write(path.join(repo, 'unrelated.txt'), 'x\n');
    git(repo, ['add', '--', 'unrelated.txt']);
    archive('foo', { cwd: repo });
    assert.ok(!git(repo, ['show', '--name-only', '--format=', 'HEAD']).includes('unrelated.txt'));
    assert.match(git(repo, ['status', '--porcelain']), /^A  unrelated\.txt$/m, 'still staged, not lost');
  });

  it('works from a linked worktree and leaves the main checkout alone', () => {
    git(repo, ['checkout', '-q', 'main']);
    const wt = path.join(repo, '.claude', 'worktrees', 'foo');
    git(repo, ['worktree', 'add', '-q', wt, 'feature/foo']);
    const r = archive('foo', { cwd: wt });
    assert.equal(r.ok, true, r.warning);
    assert.equal(r.mode, 'tracked');
    assert.ok(fs.existsSync(path.join(wt, '.planning', 'archive', 'foo', 'CONTEXT.md')));
    assert.ok(!fs.existsSync(path.join(repo, '.planning', 'archive')), 'no untracked copy in the main checkout');
    assert.equal(fs.readFileSync(path.join(repo, '.planning', 'LEDGER.md'), 'utf8'), LEDGER, 'main ledger changes only by merge');
  });

  it('refuses when the archive already holds the slug, moving nothing', () => {
    write(path.join(repo, '.planning', 'archive', 'foo', 'CONTEXT.md'), CONTEXT);
    const r = archive('foo', { cwd: repo });
    assert.equal(r.ok, false);
    assert.ok(fs.existsSync(path.join(repo, '.planning', 'features', 'foo', 'CONTEXT.md')));
  });
});

describe('finish-record archive — untracked .planning', () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-finish-untracked-'));
    git(repo, ['init', '-q', '-b', 'main']);
    write(path.join(repo, 'README.md'), 'x\n');
    git(repo, ['add', '--', 'README.md']);
    git(repo, ['commit', '-q', '-m', 'init']);
    write(path.join(repo, '.planning', 'LEDGER.md'), LEDGER);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('moves a linked worktree record to the main root archive and ledger, no commit', () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'foo');
    git(repo, ['worktree', 'add', '-q', '-b', 'feature/foo', wt]);
    write(path.join(wt, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT);
    write(path.join(wt, '.planning', 'features', 'foo', 'AUTO.json'), '{}\n');
    const head = git(wt, ['rev-parse', 'HEAD']);

    const r = archive('foo', { cwd: wt });
    assert.equal(r.ok, true, r.warning);
    assert.equal(r.mode, 'untracked');
    assert.equal(r.commit, null);
    assert.equal(git(wt, ['rev-parse', 'HEAD']), head, 'nothing committed');
    assert.ok(fs.existsSync(path.join(fs.realpathSync(repo), '.planning', 'archive', 'foo', 'CONTEXT.md')));
    assert.ok(!fs.existsSync(path.join(repo, '.planning', 'archive', 'foo', 'AUTO.json')));
    assert.ok(!fs.existsSync(path.join(wt, '.planning', 'features', 'foo')));
    assert.match(fs.readFileSync(path.join(repo, '.planning', 'LEDGER.md'), 'utf8'), /- \[x\] foo →/);
  });

  it('reports an absent ledger without failing', () => {
    fs.rmSync(path.join(repo, '.planning', 'LEDGER.md'));
    write(path.join(repo, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT);
    const r = archive('foo', { cwd: repo });
    assert.equal(r.ok, true);
    assert.equal(r.ledger, 'absent');
  });
});

describe('finish-record — input hygiene and CLI', () => {
  it('rejects a slug that is not one path segment', () => {
    assert.equal(archive('../foo', { cwd: os.tmpdir() }).ok, false);
  });

  it('the CLI exits 0 with one JSON line on failure', () => {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'ship', 'finish-record.cjs'), 'archive', 'nope'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0);
    assert.equal(JSON.parse(run.stdout.trim()).ok, false);
  });
});

describe('finish-record closeLedgerRow — placement', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ledger-row-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('puts the row above existing Shipped rows and keeps the trailing newline', () => {
    const f = path.join(dir, 'L.md');
    fs.writeFileSync(f, '## Now\n- [ ] **foo** — x\n\n## Shipped\n\n- [x] old → .planning/archive/old/\n');
    closeLedgerRow(f, 'foo');
    assert.equal(
      fs.readFileSync(f, 'utf8'),
      '## Now\n\n## Shipped\n\n- [x] foo → .planning/archive/foo/\n- [x] old → .planning/archive/old/\n'
    );
  });

  it('adds a Shipped section when there is none', () => {
    const f = path.join(dir, 'L.md');
    fs.writeFileSync(f, '## Now\n- [ ] **foo**\n');
    closeLedgerRow(f, 'foo');
    assert.equal(fs.readFileSync(f, 'utf8'), '## Now\n\n## Shipped\n- [x] foo → .planning/archive/foo/\n');
  });
});

describe('auto-run start — the run record is excluded from git', () => {
  let repo;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-auto-exclude-'));
    git(repo, ['init', '-q', '-b', 'main']);
    write(path.join(repo, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT);
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('adds the patterns once, and staging the directory skips AUTO.json', () => {
    assert.equal(autoRun.start('foo', { cwd: repo, session: 's' }).excluded, true);
    autoRun.start('foo', { cwd: repo, session: 's', resume: true });
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    for (const p of autoRun.EXCLUDE_PATTERNS) {
      assert.equal(exclude.split('\n').filter((l) => l === p).length, 1, `${p} written exactly once`);
    }
    git(repo, ['add', '--', '.planning/features/foo']);
    const staged = git(repo, ['diff', '--cached', '--name-only']);
    assert.match(staged, /CONTEXT\.md/);
    assert.ok(!staged.includes('AUTO.json'));
  });

  it('a directory that is not a repository still starts the run', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-auto-plain-'));
    try {
      write(path.join(plain, '.planning', 'features', 'foo', 'CONTEXT.md'), CONTEXT);
      const r = autoRun.start('foo', { cwd: plain, session: 's' });
      assert.equal(r.ok, true);
      assert.equal(r.excluded, false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
