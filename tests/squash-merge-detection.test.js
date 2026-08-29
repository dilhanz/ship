/**
 * Squash-merge detection — the defect 5.18.0's merge test shipped with, and
 * the four properties the fix has to hold at once.
 *
 * A squash merge replaces the branch's commits with a new one, so the
 * verifier's `**Head:**` stamp is a non-ancestor of the base forever. 5.18.0
 * read that as `awaiting-merge` and rewrote correct `done` rows. These cases
 * pin: the squash shape reads as unchanged, this repository's own history
 * reconciles without introducing a single `awaiting-merge`, no code path can
 * reach the network, and every new probe stays silent with an unchanged exit
 * code — including where git is absent entirely.
 *
 * Git-gated: the probes are real `git merge-base` and `git branch -r`.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'ship', 'pm-update.cjs');
const { archiveMergeStatus, mappedStatus, applyStatusUpdates } = require(SCRIPT_PATH);

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

/**
 * A repo whose stamped archive is in the squash shape: the tree landed on
 * `main` as a brand new commit, and the stamped side commit is reachable but
 * is not an ancestor of anything.
 */
function squashRepo(dir, slug) {
  initRepo(dir);
  git(dir, 'checkout', '-b', 'feature/widget');
  const head = commit(dir, 'widget.txt', 'work\n', 'build widget');
  git(dir, 'checkout', 'main');
  git(dir, 'merge', '--squash', 'feature/widget');
  git(dir, 'commit', '-m', 'squash: build widget');
  git(dir, 'branch', '-D', 'feature/widget');
  archive(dir, slug, verifyMd(head));
  return head;
}

describe('squash-merge-detection: the squash shape reads as unchanged', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-squash-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('answers inconclusive, and leaves both recorded statuses alone', () => {
    const repo = path.join(root, 'repo');
    squashRepo(repo, 'widget');

    assert.equal(archiveMergeStatus(repo, 'widget'), 'inconclusive');
    assert.equal(mappedStatus(repo, 'widget', 'done'), null, 'a correct done must survive a squash merge');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), null, 'undecidable is unchanged, not awaiting-merge');
  });

  it('a stale remote branch reaches awaiting-merge — but still never downgrades done', () => {
    const repo = path.join(root, 'repo');
    const head = squashRepo(repo, 'widget');

    // The squash landed but the branch was never deleted on the remote: the
    // probe honestly reads it as unlanded work. The never-downgrade rule, not
    // the probe, is what protects the recorded `done`.
    git(repo, 'update-ref', 'refs/remotes/origin/feature/widget', head);

    assert.equal(archiveMergeStatus(repo, 'widget'), 'awaiting-merge');
    assert.equal(mappedStatus(repo, 'widget', 'done'), null);
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'awaiting-merge');
  });

  it('a stamp-less archive in the same repo still reconciles to done', () => {
    const repo = path.join(root, 'repo');
    squashRepo(repo, 'widget');
    archive(repo, 'gadget');

    assert.equal(archiveMergeStatus(repo, 'gadget'), 'no-stamp');
    assert.equal(mappedStatus(repo, 'gadget', 'done'), 'done');
    assert.equal(mappedStatus(repo, 'gadget', 'in-progress'), 'done');
  });
});

/**
 * The dogfood check. `.planning/` and `.project-manager/` are both gitignored,
 * so a clean CI checkout has neither and must skip rather than fail — run the
 * suite locally to actually exercise criterion 5.
 */
const dogfoodReady =
  gitAvailable &&
  fs.existsSync(path.join(REPO_ROOT, '.planning', 'archive')) &&
  fs.existsSync(path.join(REPO_ROOT, '.project-manager', 'ROADMAP.md'));

describe(
  "squash-merge-detection: Ship's own history (skipped without .planning/ and .project-manager/, both gitignored)",
  { skip: !dogfoodReady },
  () => {
    /** Every archived slug whose VERIFY.md carries a `**Head:**` stamp. */
    function stampedSlugs() {
      const base = path.join(REPO_ROOT, '.planning', 'archive');
      return fs
        .readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(slug => {
          const verify = path.join(base, slug, 'VERIFY.md');
          if (!fs.existsSync(verify)) return false;
          return /^\*\*Head:\*\*\s*[0-9a-fA-F]{7,40}\b/m.test(fs.readFileSync(verify, 'utf8'));
        });
    }

    it('leaves every stamped archive recorded done unchanged', () => {
      const slugs = stampedSlugs();
      assert.ok(slugs.length > 0, 'expected at least one stamped archive in this repo');

      for (const slug of slugs) {
        assert.equal(
          mappedStatus(REPO_ROOT, slug, 'done'),
          null,
          `${slug}: a recorded done must be left unchanged by the merge test`
        );
        // Deliberately NOT `!== 'awaiting-merge'`: two of this repo's stamped
        // heads sit on undeleted remote branches (origin/pm-blind-spots,
        // origin/go-path-reliability), so the probe honestly answers
        // `awaiting-merge` for them. That is the designed behaviour; the
        // never-downgrade rule above is what takes the reconcile to zero.
        assert.ok(
          ['done', 'awaiting-merge', 'inconclusive'].includes(archiveMergeStatus(REPO_ROOT, slug)),
          `${slug}: a stamped archive must never answer no-stamp`
        );
      }
    });

    it('introduces zero awaiting-merge occurrences into the real ROADMAP.md', () => {
      const roadmapPath = path.join(REPO_ROOT, '.project-manager', 'ROADMAP.md');
      const before = fs.readFileSync(roadmapPath, 'utf8');
      const result = applyStatusUpdates(before, REPO_ROOT, []);

      // Counted, not asserted absent, so a row a human legitimately set to
      // awaiting-merge stays allowed — what must not happen is a new one.
      const count = text => text.split('awaiting-merge').length - 1;
      assert.equal(
        count(result.content),
        count(before),
        'the reconcile must not introduce a single awaiting-merge occurrence'
      );
    });
  }
);

describe('squash-merge-detection: no network call is reachable', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-squash-net-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * A repo carrying everything one CLI run touches: a stamped archive, a
   * matching roadmap row, and a features tree for the lane stamp.
   */
  function lifecycleRepo(dir, slug) {
    const head = squashRepo(dir, slug);

    const feature = path.join(dir, '.planning', 'features', slug);
    fs.mkdirSync(feature, { recursive: true });
    fs.writeFileSync(
      path.join(feature, 'CONTEXT.md'),
      ['---', `feature: "${slug}"`, 'status: done', '---', '', '## Problem', '', 'fixture', ''].join('\n')
    );

    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.project-manager', 'ROADMAP.md'),
      [
        '---',
        'updated: "2026-08-01"',
        '---',
        '',
        '## Backlog',
        '',
        '| Item | Status | Priority | Depends on | Ship feature | Source |',
        '|---|---|---|---|---|---|',
        `| Ship ${slug} | done | P0 | — | ${slug} | brainstorm |`,
        ''
      ].join('\n')
    );

    return head;
  }

  /**
   * A PATH shim recording every `git` and `gh` invocation. The real git is
   * resolved BEFORE the shim goes on PATH, or the shim execs itself forever.
   */
  function tripwire(dir) {
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const log = path.join(dir, 'calls.log');

    fs.writeFileSync(
      path.join(bin, 'git'),
      `#!/bin/sh\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`
    );
    fs.chmodSync(path.join(bin, 'git'), 0o755);

    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`
    );
    fs.chmodSync(path.join(bin, 'gh'), 0o755);

    return {
      bin,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
    };
  }

  it('runs a full lifecycle reconcile without invoking gh or any remote git command', () => {
    const repo = path.join(root, 'repo');
    lifecycleRepo(repo, 'widget');
    const shim = tripwire(root);

    const run = spawnSync(process.execPath, [SCRIPT_PATH, 'widget'], {
      cwd: repo,
      encoding: 'utf8',
      env: shim.env
    });
    assert.equal(run.status, 0);

    const calls = shim.lines();
    assert.ok(calls.length > 0, 'the shim must actually have been on PATH');
    assert.deepEqual(calls.filter(c => c.startsWith('gh ')), [], 'nothing may shell out to gh');

    const networkVerbs = ['fetch', 'ls-remote', 'push', 'pull', 'clone', 'remote update'];
    for (const call of calls) {
      const argv = call.replace(/^git\s*/, '');
      for (const verb of networkVerbs) {
        assert.ok(!argv.startsWith(verb), `git ${verb} reaches the network: "${call}"`);
      }
    }
  });
});

describe('squash-merge-detection: silent, exit code unchanged', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-squash-quiet-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Assert a CLI run exits 0 with both streams empty. */
  function assertQuiet(cwd, env) {
    const run = spawnSync(process.execPath, [SCRIPT_PATH, 'widget'], { cwd, encoding: 'utf8', env });
    assert.equal(run.status, 0, `exit code changed:\n${run.stderr}`);
    assert.equal(run.stdout, '', `stdout must stay silent, got: ${JSON.stringify(run.stdout)}`);
    assert.equal(run.stderr, '', `stderr must stay silent, got: ${JSON.stringify(run.stderr)}`);
  }

  it('stays quiet for a stamped archive where the new probe runs', () => {
    const repo = path.join(root, 'repo');
    squashRepo(repo, 'widget');

    assertQuiet(repo, process.env);
  });

  it('stays quiet for a stamped archive in a directory that is not a git repo', () => {
    const plain = path.join(root, 'plain');
    archive(plain, 'widget', verifyMd('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));

    assertQuiet(plain, process.env);
  });

  it('stays quiet when there is no git binary on PATH at all', () => {
    const repo = path.join(root, 'repo');
    squashRepo(repo, 'widget');

    // A PATH holding an empty directory: every `git` spawn fails with ENOENT,
    // which the layer must degrade to a value rather than a message.
    const emptyBin = path.join(root, 'no-git-bin');
    fs.mkdirSync(emptyBin, { recursive: true });

    assertQuiet(repo, { ...process.env, PATH: emptyBin });
  });
});
