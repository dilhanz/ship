/**
 * Merge-aware archive status — ship/pm-update.cjs resolveBaseRef(),
 * archiveMergeStatus(), and the mappedStatus archive branch they gate.
 *
 * Archiving a feature is a directory move; it is not evidence the work
 * merged. These cases pin the whole gate: ancestry answers `done`, a stamped
 * head that never reached the base answers `awaiting-merge`, and every way
 * the question can fail to be answerable — no stamp, no base ref, an
 * unresolvable commit, no git at all — degrades toward "unchanged" or toward
 * today's `done`, never toward an invented status.
 *
 * Git-gated: the merge test is real `git merge-base --is-ancestor`.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { resolveBaseRef, archiveMergeStatus, mappedStatus, selectNext, computeUnblocks, parseRoadmap } = require(SCRIPT_PATH);

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
 * Init a repo on `main` with one commit. The identity is set per-repo so CI
 * without a global git identity still commits.
 */
function initRepo(dir, branch = 'main') {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return commit(dir, 'README.md', '# fixture\n', 'init');
}

/** Write a file, commit it, and return the new commit sha. */
function commit(dir, file, body, message) {
  fs.writeFileSync(path.join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

/** Create `.planning/archive/{slug}/` with an optional VERIFY.md body. */
function archive(dir, slug, verifyBody) {
  const archiveDir = path.join(dir, '.planning', 'archive', slug);
  fs.mkdirSync(archiveDir, { recursive: true });
  if (verifyBody !== undefined) {
    fs.writeFileSync(path.join(archiveDir, 'VERIFY.md'), verifyBody);
  }
  return archiveDir;
}

/** A VERIFY.md carrying the verifier's head stamp. */
function verifyMd(head) {
  return `# Verification — widget\n\n**Head:** ${head}\n**Overall Status:** PASS\n`;
}

describe('pm-merge-status: archiveMergeStatus', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-merge-status-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('answers done when the stamped head is an ancestor of the base', () => {
    const repo = path.join(root, 'repo');
    const head = initRepo(repo);
    archive(repo, 'widget', verifyMd(head));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'done');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'done');
  });

  it('answers awaiting-merge for a head on a side branch that never merged', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'widget.txt', 'work\n', 'build widget');
    git(repo, 'checkout', 'main');
    archive(repo, 'widget', verifyMd(head));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'awaiting-merge');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'awaiting-merge');
  });

  it('flips to done once the side branch is merged — ancestry self-heals', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'widget.txt', 'work\n', 'build widget');
    git(repo, 'checkout', 'main');
    archive(repo, 'widget', verifyMd(head));
    assert.equal(archiveMergeStatus(repo, 'widget'), 'awaiting-merge');

    git(repo, 'merge', '--no-ff', '-m', 'merge widget', 'feature/widget');
    assert.equal(archiveMergeStatus(repo, 'widget'), 'done');
  });

  it('is inconclusive — status unchanged — when neither main nor master exists', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo, 'work');
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    archive(repo, 'widget', verifyMd(head));

    assert.equal(resolveBaseRef(repo), null);
    assert.equal(archiveMergeStatus(repo, 'widget'), 'inconclusive');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), null, 'never invented');
  });

  it('is inconclusive when the stamp names a commit git cannot resolve', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    archive(repo, 'widget', verifyMd('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'inconclusive');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), null);
  });

  it('reports no-stamp — and keeps done — when the archive has no VERIFY.md', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    archive(repo, 'widget');

    assert.equal(archiveMergeStatus(repo, 'widget'), 'no-stamp');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'done');
  });

  it('reports no-stamp when VERIFY.md carries no **Head:** line', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    archive(repo, 'widget', '# Verification — widget\n\n**Overall Status:** PASS\n');

    assert.equal(archiveMergeStatus(repo, 'widget'), 'no-stamp');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'done');
  });

  it('keeps done for an archived feature in a directory that is not a git repo', () => {
    // The existing-suite guarantee: pm-update.test.js and pm-update-verify.js
    // both reconcile an archive to `done` in a bare temp dir.
    const plain = path.join(root, 'plain');
    archive(plain, 'widget');

    assert.equal(mappedStatus(plain, 'widget', 'in-progress'), 'done');
  });

  it('is inconclusive, never done, for a stamped archive outside a repo', () => {
    const plain = path.join(root, 'plain');
    archive(plain, 'widget', verifyMd('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));

    assert.equal(archiveMergeStatus(plain, 'widget'), 'inconclusive');
    assert.equal(mappedStatus(plain, 'widget', 'in-progress'), null);
  });
});

describe('pm-merge-status: resolveBaseRef', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-merge-base-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null outside a git repository', () => {
    assert.equal(resolveBaseRef(root), null);
  });

  it('prefers main over master when both exist', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'branch', 'master');
    assert.equal(resolveBaseRef(repo), 'main');
  });

  it('falls back to master when there is no main', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo, 'master');
    assert.equal(resolveBaseRef(repo), 'master');
  });

  it('prefers origin/main over a stale local main', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'widget.txt', 'work\n', 'build widget');
    git(repo, 'checkout', 'main');
    // The remote has the merge; the local base is behind.
    git(repo, 'update-ref', 'refs/remotes/origin/main', head);

    assert.equal(resolveBaseRef(repo), 'origin/main');

    archive(repo, 'widget', verifyMd(head));
    assert.equal(
      archiveMergeStatus(repo, 'widget'),
      'done',
      'the remote base is authoritative — a stale local main must not report awaiting-merge'
    );
  });
});

describe('pm-merge-status: base ref resolution is bounded', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-merge-cost-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A roadmap whose backlog carries `count` archived, stamped rows. */
  function seed(count, head) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const slug = `feat-${i}`;
      archive(root, slug, verifyMd(head));
      rows.push(`| Ship ${slug} | pending | ${slug} |`);
    }
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.project-manager', 'ROADMAP.md'),
      [
        '---',
        'updated: "2026-08-01"',
        '---',
        '',
        '### Now',
        '',
        '| Item | Status | Ship feature |',
        '|---|---|---|',
        ...rows,
        ''
      ].join('\n')
    );
  }

  /** A PATH shim that counts every git invocation, delegating to the real one. */
  function gitCountingEnv(dir) {
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const log = path.join(dir, 'git-calls.log');
    fs.writeFileSync(
      path.join(bin, 'git'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`
    );
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    return {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      revParses: () =>
        fs.existsSync(log)
          ? fs.readFileSync(log, 'utf8').split('\n').filter(l => l.includes('rev-parse --verify --quiet')).length
          : 0
    };
  }

  it('resolves the base ref a bounded number of times, whatever the row count', () => {
    const head = initRepo(root);

    const small = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-merge-shim-'));
    seed(5, head);
    const shimSmall = gitCountingEnv(small);
    assert.equal(
      spawnSync(process.execPath, [SCRIPT_PATH], { cwd: root, encoding: 'utf8', env: shimSmall.env }).status,
      0
    );
    const few = shimSmall.revParses();
    fs.rmSync(small, { recursive: true, force: true });

    const big = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-merge-shim-'));
    seed(40, head);
    const shimBig = gitCountingEnv(big);
    const started = Date.now();
    assert.equal(
      spawnSync(process.execPath, [SCRIPT_PATH], { cwd: root, encoding: 'utf8', env: shimBig.env }).status,
      0
    );
    const elapsed = Date.now() - started;
    const many = shimBig.revParses();
    fs.rmSync(big, { recursive: true, force: true });

    assert.equal(many, few, 'base ref resolution must not grow with the number of archived rows');
    assert.ok(elapsed < 5000, `40 stamped archived rows reconciled in ${elapsed}ms`);
  });
});

describe('pm-merge-status: selectNext', () => {
  it('never recommends an awaiting-merge row', () => {
    const roadmap = [
      '## Milestone: Now',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Ship widget | awaiting-merge | P0 | — | widget |',
      '| Ship gadget | pending | P2 | — | gadget |',
      ''
    ].join('\n');

    const next = selectNext(parseRoadmap(roadmap));
    assert.equal(next.item, 'Ship gadget', 'archived work cannot be worked on next');
  });

  it('still recommends a row whose only dependency is awaiting-merge', () => {
    const roadmap = [
      '## Milestone: Now',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Ship widget | awaiting-merge | P1 | — | widget |',
      '| Ship gadget | pending | P0 | Ship widget | gadget |',
      ''
    ].join('\n');

    const next = selectNext(parseRoadmap(roadmap));
    assert.equal(
      next && next.item,
      'Ship gadget',
      'awaiting-merge is finished work — it satisfies a dependency even though it cannot be selected'
    );
  });

  it('still refuses a dependency that is merely pending', () => {
    const roadmap = [
      '## Milestone: Now',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Ship widget | pending | P1 | — | widget |',
      '| Ship gadget | pending | P0 | Ship widget | gadget |',
      ''
    ].join('\n');

    const next = selectNext(parseRoadmap(roadmap));
    assert.equal(next.item, 'Ship widget', 'an unfinished dependency is still unmet');
  });
});

describe('pm-merge-status: computeUnblocks', () => {
  it('does not count an awaiting-merge dependent as waiting', () => {
    const roadmap = [
      '## Milestone: Now',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Ship widget | pending | P1 | — | widget |',
      '| Ship gadget | awaiting-merge | P0 | Ship widget | gadget |',
      ''
    ].join('\n');

    const unblocks = computeUnblocks(parseRoadmap(roadmap));
    assert.equal(
      unblocks.get('Ship widget').count,
      0,
      'finishing an item cannot unblock a dependent that is already finished'
    );
    assert.equal(unblocks.get('Ship widget').inProgress, false);
  });

  it('still counts a pending dependent', () => {
    const roadmap = [
      '## Milestone: Now',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Ship widget | pending | P1 | — | widget |',
      '| Ship gadget | pending | P0 | Ship widget | gadget |',
      ''
    ].join('\n');

    assert.equal(computeUnblocks(parseRoadmap(roadmap)).get('Ship widget').count, 1);
  });
});
