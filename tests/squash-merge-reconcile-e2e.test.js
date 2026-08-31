/**
 * Squash-merge detection — end-to-end reconcile, CI-safe.
 *
 * Verify round 2. The feature's own criterion-5 evidence is a dogfood check
 * against this repo's real `.planning/archive/` and `.project-manager/`, both
 * of which are gitignored — so on a clean checkout it skips and criterion 5
 * is proved by nothing. These cases rebuild the same property on a synthetic
 * squash-merge repository, so the "a reconcile introduces zero
 * `awaiting-merge` occurrences" guarantee is exercised everywhere the suite
 * runs, not only on a developer's machine.
 *
 * They go through the two real seams a user hits — `applyStatusUpdates` and
 * the `reconcile` CLI verb — rather than `mappedStatus` alone, so a
 * never-downgrade rule that held at the mapping layer but leaked at the row
 * layer would be visible.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'ship', 'pm-update.cjs');
const { applyStatusUpdates } = require(SCRIPT_PATH);

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
  return r.stdout.trim();
}

function commit(dir, file, body, message) {
  fs.writeFileSync(path.join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/**
 * A repository shaped exactly like a squash merge: the feature commit exists
 * on its own branch and a *different* commit carrying the same content sits
 * on the base. The feature head is therefore a non-ancestor forever.
 */
function squashRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commit(dir, 'README.md', '# fixture\n', 'init');

  git(dir, 'checkout', '-b', 'feature-work');
  const featureHead = commit(dir, 'feature.js', 'module.exports = 1;\n', 'feature work');

  git(dir, 'checkout', 'main');
  commit(dir, 'feature.js', 'module.exports = 1;\n', 'squashed feature work (#1)');
  git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'main'));

  return featureHead;
}

function archive(dir, slug, head) {
  const target = path.join(dir, '.planning', 'archive', slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'VERIFY.md'),
    head === null
      ? '# Verification Report\n\n**Overall Status:** PASS\n'
      : `# Verification Report\n\n**Head:** ${head}\n**Overall Status:** PASS\n`
  );
}

function roadmap(dir, rows) {
  fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
  const content = [
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
  ].join('\n');
  fs.writeFileSync(path.join(dir, '.project-manager', 'ROADMAP.md'), content);
  return content;
}

describe('squash-merge reconcile — end to end on a synthetic squash repo', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-squash-e2e-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('leaves a recorded done row byte-identical and reports no change', () => {
    const head = squashRepo(root);
    archive(root, 'feature-work', head);
    const before = roadmap(root, ['| Ship feature-work | done | feature-work |']);

    const result = applyStatusUpdates(before, root, []);

    assert.equal(result.changed, false, 'a squash-merged done row must not be rewritten');
    assert.equal(result.content, before, 'every byte of the roadmap must survive untouched');
    assert.equal(
      (result.content.match(/awaiting-merge/g) || []).length,
      0,
      'a reconcile must never introduce awaiting-merge'
    );
  });

  it('still leaves the done row alone when a live remote branch holds the head', () => {
    const head = squashRepo(root);
    // The branch was never deleted after the squash merge — the probe now has
    // positive proof of non-merge, and the never-downgrade rule is the only
    // thing standing between that and five wrong rows.
    git(root, 'update-ref', 'refs/remotes/origin/feature-work', head);
    archive(root, 'feature-work', head);
    const before = roadmap(root, ['| Ship feature-work | done | feature-work |']);

    const result = applyStatusUpdates(before, root, []);

    assert.equal(result.changed, false);
    assert.equal(result.content, before);
    assert.ok(!result.content.includes('awaiting-merge'));
  });

  it('does record awaiting-merge for a row that is not already done', () => {
    const head = squashRepo(root);
    git(root, 'update-ref', 'refs/remotes/origin/feature-work', head);
    archive(root, 'feature-work', head);
    const before = roadmap(root, ['| Ship feature-work | in-progress | feature-work |']);

    const result = applyStatusUpdates(before, root, []);

    assert.equal(result.changed, true, 'awaiting-merge must stay reachable');
    assert.match(result.content, /\| Ship feature-work \| awaiting-merge \| feature-work \|/);
  });

  it('reconciles a stamp-less archive to done in the same repo', () => {
    squashRepo(root);
    archive(root, 'legacy-feature', null);
    const before = roadmap(root, ['| Ship legacy | in-progress | legacy-feature |']);

    const result = applyStatusUpdates(before, root, []);

    assert.equal(result.changed, true);
    assert.match(result.content, /\| Ship legacy \| done \| legacy-feature \|/);
    assert.ok(!result.content.includes('awaiting-merge'));
  });

  it('never downgrades a done row whatever case the cell records it in', () => {
    const head = squashRepo(root);
    git(root, 'update-ref', 'refs/remotes/origin/feature-work', head);
    archive(root, 'feature-work', head);

    for (const recorded of ['done', 'Done', 'DONE']) {
      const before = roadmap(root, [`| Ship feature-work | ${recorded} | feature-work |`]);
      const result = applyStatusUpdates(before, root, []);
      assert.equal(result.changed, false, `recorded "${recorded}" must not be rewritten`);
      assert.equal(result.content, before);
    }
  });

  it('the reconcile CLI verb rewrites nothing, stays silent, and exits 0', () => {
    const head = squashRepo(root);
    archive(root, 'feature-work', head);
    const before = roadmap(root, [
      '| Ship feature-work | done | feature-work |',
      '| Ship legacy | done | legacy-feature |'
    ]);
    archive(root, 'legacy-feature', null);

    const run = spawnSync(process.execPath, [SCRIPT_PATH, 'reconcile'], {
      cwd: root,
      encoding: 'utf8'
    });

    assert.equal(run.status, 0, 'the CLI exit code is never touched by the probe');
    assert.equal(run.stdout, '', 'nothing may reach stdout');
    assert.equal(run.stderr, '', 'nothing may reach stderr');
    assert.equal(
      fs.readFileSync(path.join(root, '.project-manager', 'ROADMAP.md'), 'utf8'),
      before,
      'no cell may change: one row is already done, the other is stamp-less and already done'
    );
  });
});
