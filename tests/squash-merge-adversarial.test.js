/**
 * Squash-merge detection — adversarial verification.
 *
 * Written by the ship-verifier as an independent second opinion on the
 * feature's own suite. Three groups:
 *
 * 1. The carried review findings, each given a direct reproduction attempt
 *    rather than an inspection: the multi-remote (fork) shape that reads a
 *    merged head as positive proof of non-merge, and the finish stamp's
 *    behaviour on an empty PR URL and on CRLF frontmatter.
 * 2. A stricter network tripwire than the feature's own — network verbs are
 *    matched as tokens anywhere in the argv, so a future `git -C dir fetch`
 *    cannot slip past the guard acceptance criterion 8 rests on.
 * 3. Boundary and negative inputs the feature's suite does not cover:
 *    an abbreviated stamp, a stamp naming a commit this repo has never seen,
 *    an `origin/HEAD -> origin/main` symbolic entry, and a `master` base.
 *
 * Git-gated: the probes are real `git merge-base` and `git branch -r`.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'ship', 'pm-update.cjs');
const FINISH_SKILL = path.join(REPO_ROOT, 'skills', 'finish', 'SKILL.md');
const { archiveMergeStatus, mappedStatus } = require(SCRIPT_PATH);

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

function initRepo(dir, branch = 'main') {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return commit(dir, 'README.md', '# fixture\n', 'init');
}

function commit(dir, file, body, message) {
  fs.writeFileSync(path.join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

function archive(dir, slug, verifyBody) {
  const dst = path.join(dir, '.planning', 'archive', slug);
  fs.mkdirSync(dst, { recursive: true });
  if (verifyBody !== undefined) fs.writeFileSync(path.join(dst, 'VERIFY.md'), verifyBody);
  return dst;
}

const verifyMd = head => `# Verification: widget\n\n**Head:** ${head}\n\n**Overall Status:** PASS\n`;

/**
 * The `pr:` stamp program exactly as `skills/finish/SKILL.md` prints it,
 * extracted from the fenced block so the test can never drift from the doc.
 */
function stampProgram() {
  const body = fs.readFileSync(FINISH_SKILL, 'utf8');
  const section = body.slice(body.indexOf('### Stamp the PR URL'));
  const m = section.match(/node -e '\n([\s\S]*?)\n' "\$CTX" "\$PR_URL"/);
  assert.ok(m, 'the PR stamp program must still be a node -e block in the skill');
  return m[1];
}

/** Run the extracted stamp program over a fixture file. */
function stamp(file, url) {
  return spawnSync(process.execPath, ['-e', stampProgram(), file, url], { encoding: 'utf8' });
}

describe('squash-merge adversarial — carried review finding: multi-remote proof of non-merge', { skip: !gitAvailable }, () => {
  let root;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-sqadv-fork-'))); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('reads a fork remote holding the merged head as proof of non-merge', () => {
    // Phase 1 finding 1 (low): remoteBranchStillHolds excludes only the base
    // in its two spellings, so on a fork checkout `upstream/main` — which
    // legitimately contains the merged commit — counts as a live branch still
    // holding unlanded work.
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'w.txt', 'w\n', 'work');
    git(repo, 'checkout', 'main');
    git(repo, 'merge', '--no-ff', '-m', 'merge widget', 'feature/widget');
    git(repo, 'branch', '-D', 'feature/widget');

    // origin/main is one commit behind (the lane has not fetched the merge);
    // upstream/main is current and therefore contains the stamped head.
    git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD~1').trim());
    git(repo, 'update-ref', 'refs/remotes/upstream/main', git(repo, 'rev-parse', 'main').trim());
    archive(repo, 'widget', verifyMd(head));

    // Documents current behaviour: the answer is awaiting-merge even though
    // the work is merged. Direction-safe — it withholds `done`, never invents
    // one, and a recorded `done` is still left alone.
    assert.equal(archiveMergeStatus(repo, 'widget'), 'awaiting-merge');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'awaiting-merge');
    assert.equal(mappedStatus(repo, 'widget', 'done'), null, 'the never-downgrade gate still holds');
  });
});

describe('squash-merge adversarial — carried review findings: the finish PR stamp', () => {
  let root;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-sqadv-stamp-'))); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('leaves the pr: field absent when the PR URL could not be obtained', () => {
    // Phase 2 finding 1 (medium), fixed in verify fix round 1: acceptance
    // criterion 7 says an impossible stamp leaves the field "simply absent".
    // With both `gh pr create` and the `gh pr view` fallback producing
    // nothing, PR_URL is empty; the program now exits non-zero and writes
    // nothing, so the skill's trailing `grep -n 'pr: '` never runs and the
    // failure cannot read back as a successful stamp.
    const ctx = path.join(root, 'CONTEXT.md');
    const before = '---\nfeature: "widget"\nstatus: done\n---\n\nbody\n';
    fs.writeFileSync(ctx, before);

    const run = stamp(ctx, '');
    assert.notEqual(run.status, 0, 'the impossible case reports failure');

    const after = fs.readFileSync(ctx, 'utf8');
    assert.equal(after, before, 'the file is byte-identical — nothing recorded');
    assert.ok(!/^pr:/m.test(after), 'the field is simply absent');
  });

  it('flips CRLF line endings to LF when stamping a CRLF file', () => {
    // Phase 2 finding 2 (low): the skill claims the stamp "leaves every other
    // byte alone". It reassembles the frontmatter with literal \n, so a CRLF
    // CONTEXT.md loses \r on the opening delimiter and the anchor line, and
    // the inserted pr: line is LF-terminated inside an otherwise-CRLF block.
    const ctx = path.join(root, 'CONTEXT.md');
    fs.writeFileSync(ctx, '---\r\nfeature: "widget"\r\nstatus: done\r\n---\r\n\r\nbody\r\n');

    const run = stamp(ctx, 'https://github.com/o/r/pull/29');
    assert.equal(run.status, 0);

    const after = fs.readFileSync(ctx, 'utf8');
    assert.match(after, /^---\nfeature/, 'the opening delimiter loses its \\r');
    assert.match(after, /status: done\npr: https/, 'the anchor and inserted lines are LF');
    assert.equal((after.match(/\r\n/g) || []).length, 4, 'two of the six original CRLFs were rewritten');
  });

  it('leaves a frontmatter-less file byte-identical and exits non-zero', () => {
    const ctx = path.join(root, 'CONTEXT.md');
    const before = '# widget\n\nstatus: done\n';
    fs.writeFileSync(ctx, before);

    const run = stamp(ctx, 'https://github.com/o/r/pull/29');
    assert.equal(run.status, 1, 'the failure is reported, not swallowed');
    assert.equal(fs.readFileSync(ctx, 'utf8'), before);
  });

  it('replaces an existing pr: line exactly once for a real GitHub URL', () => {
    const ctx = path.join(root, 'CONTEXT.md');
    fs.writeFileSync(ctx, '---\nfeature: "widget"\nstatus: done\npr: https://github.com/o/r/pull/1\n---\n');

    assert.equal(stamp(ctx, 'https://github.com/o/r/pull/29').status, 0);
    const after = fs.readFileSync(ctx, 'utf8');
    assert.equal((after.match(/^pr:/gm) || []).length, 1, 'exactly one pr: line survives');
    assert.ok(!after.includes('/pull/1\n'), 'the old value is gone');
  });

  it('expands $-sequences in the URL because the value is used as a replacement string', () => {
    // Latent, not reachable from `gh`: a GitHub PR URL contains no `$`. Both
    // branches pass the URL straight into String.replace, so `$&` and `$1`
    // are interpolated rather than written literally. Characterised here so a
    // future change of URL source is not a silent corruption.
    const ctx = path.join(root, 'CONTEXT.md');
    fs.writeFileSync(ctx, '---\nfeature: "widget"\nstatus: done\n---\n');

    assert.equal(stamp(ctx, 'https://x/$1/1').status, 0);
    assert.match(fs.readFileSync(ctx, 'utf8'), /^pr: https:\/\/x\/status: done\/1$/m);
  });
});

describe('squash-merge adversarial — no network verb anywhere in a lifecycle run', { skip: !gitAvailable }, () => {
  let root;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-sqadv-net-'))); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('matches network verbs as tokens anywhere in the argv, not only at its head', () => {
    // Strengthens the feature suite's tripwire, which only tested
    // argv.startsWith(verb): `git -C dir fetch` would slip past that.
    const repo = path.join(root, 'repo');
    const head = initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const branchHead = commit(repo, 'w.txt', 'w\n', 'work');
    git(repo, 'checkout', 'main');
    commit(repo, 'w.txt', 'w\n', 'squashed work (#1)');
    git(repo, 'branch', '-D', 'feature/widget');
    archive(repo, 'widget', verifyMd(branchHead));
    archive(repo, 'other', verifyMd(head));

    const pmDir = path.join(repo, '.project-manager');
    fs.mkdirSync(pmDir, { recursive: true });
    fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), [
      '---', 'updated: "2026-01-01"', '---', '',
      '## Backlog', '',
      '| Item | Status | Priority | Size | Depends | Source | Slug |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Widget | done | P1 | S | — | src | widget |',
      '| Other | in-progress | P1 | S | — | src | other |', ''
    ].join('\n'));

    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const log = path.join(root, 'calls.log');
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${realGit} "$@"\n`);
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);

    const run = spawnSync(process.execPath, [SCRIPT_PATH, 'widget', 'other'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
    });
    assert.equal(run.status, 0, `exit code changed:\n${run.stderr}`);

    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    assert.ok(calls.length > 0, 'the shim must actually have been on PATH');
    assert.deepEqual(calls.filter(c => c.startsWith('gh ')), [], 'nothing may shell out to gh');

    const networkVerbs = new Set(['fetch', 'ls-remote', 'push', 'pull', 'clone', 'submodule']);
    for (const call of calls) {
      const tokens = call.split(/\s+/).slice(1);
      for (const token of tokens) {
        assert.ok(!networkVerbs.has(token), `a network verb appears in: "${call}"`);
      }
      assert.ok(!/\bremote\s+update\b/.test(call), `remote update reaches the network: "${call}"`);
    }
  });
});

describe('squash-merge adversarial — probe boundaries', { skip: !gitAvailable }, () => {
  let root;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-sqadv-edge-'))); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('is inconclusive for a stamp naming a commit the repo has never seen', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    archive(repo, 'widget', verifyMd('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'inconclusive');
    assert.equal(mappedStatus(repo, 'widget', 'done'), null, 'never downgraded');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), null, 'never invented');
  });

  it('accepts an abbreviated stamp and still resolves ancestry', () => {
    const repo = path.join(root, 'repo');
    const head = initRepo(repo);
    archive(repo, 'widget', verifyMd(head.slice(0, 7)));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'done');
    assert.equal(mappedStatus(repo, 'widget', 'in-progress'), 'done');
  });

  it('never counts an origin/HEAD symbolic entry as a live branch', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'w.txt', 'w\n', 'work');
    git(repo, 'checkout', 'main');
    commit(repo, 'w.txt', 'w\n', 'squashed work (#1)');
    git(repo, 'branch', '-D', 'feature/widget');
    // origin/main is stale (pre-squash) so it does not contain the head, and
    // origin/HEAD is the symbolic pointer git prints as "origin/HEAD -> ...".
    git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD').trim());
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    archive(repo, 'widget', verifyMd(head));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'inconclusive');
  });

  it('excludes a master base in both spellings', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo, 'master');
    git(repo, 'checkout', '-b', 'feature/widget');
    const head = commit(repo, 'w.txt', 'w\n', 'work');
    git(repo, 'checkout', 'master');
    git(repo, 'merge', '--no-ff', '-m', 'merge', 'feature/widget');
    git(repo, 'branch', '-D', 'feature/widget');
    git(repo, 'update-ref', 'refs/remotes/origin/master', git(repo, 'rev-parse', 'master').trim());
    archive(repo, 'widget', verifyMd(head));

    assert.equal(archiveMergeStatus(repo, 'widget'), 'done', 'origin/master is the base, not a live branch');
  });

  it('stays silent and exits 0 when git is not on PATH at all', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    archive(repo, 'widget', verifyMd(git(repo, 'rev-parse', 'HEAD').trim()));

    const empty = path.join(root, 'emptybin');
    fs.mkdirSync(empty, { recursive: true });
    const run = spawnSync(process.execPath, [SCRIPT_PATH, 'widget'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: empty }
    });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, '');
  });
});
