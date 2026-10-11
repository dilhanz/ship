'use strict';

// Adversarial tests for verify-checklist-gate: execute the trial-merge snippet
// exactly as agents/ship-verifier.md prints it, in scratch git repos, and check
// the promises the prose makes about it — the feature branch HEAD never moves,
// the merge happens only in the detached worktree, and the worktree is removed
// on every path (clean merge, conflict, red build).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const snippet = () => {
  const src = fs.readFileSync(path.join(ROOT, 'agents/ship-verifier.md'), 'utf8');
  const start = src.indexOf('#### Trial merge with main');
  assert.ok(start >= 0, 'trial merge section exists');
  const m = src.slice(start).match(/```bash\n([\s\S]*?)```/);
  assert.ok(m, 'trial merge section has a bash block');
  return m[1];
};

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
}).trim();

const write = (dir, file, body) => fs.writeFileSync(path.join(dir, file), body);

// A repo with main and a feature branch. `conflict` makes main and the feature
// edit the same line of the same file.
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const fixture = ({ conflict }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcg-trial-'));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'a.txt', 'base\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  write(dir, 'a.txt', 'feature\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'feature');
  git(dir, 'checkout', '-q', 'main');
  if (conflict) {
    write(dir, 'a.txt', 'main\n');
    git(dir, 'add', 'a.txt');
  } else {
    write(dir, 'b.txt', 'main\n');
    git(dir, 'add', 'b.txt');
  }
  git(dir, 'commit', '-q', '-m', 'main moves');
  git(dir, 'checkout', '-q', 'feature/x');
  return dir;
};

const runSnippet = (dir, buildCommand) => {
  const script = snippet().split('<build command>').join(buildCommand)
    // Expose $TRIAL so the test can check it is gone afterwards.
    + '\necho "TRIAL=$TRIAL"\n';
  return spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
};

const trialOf = (out) => (out.stdout.match(/^TRIAL=(.*)$/m) || [])[1];

describe('adversarial: the trial-merge snippet as printed', () => {
  it('a clean merge builds in the trial worktree and leaves the feature HEAD and tree untouched', () => {
    const dir = fixture({ conflict: false });
    const head = git(dir, 'rev-parse', 'HEAD');
    const out = runSnippet(dir, 'test -f a.txt && echo BUILD_OK');
    assert.equal(out.status, 0, out.stderr);
    // baseline + post-merge build both ran
    assert.equal((out.stdout.match(/BUILD_OK/g) || []).length, 2, out.stdout);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'feature HEAD unchanged');
    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/x');
    assert.equal(git(dir, 'status', '--porcelain'), '', 'feature checkout clean');
    assert.ok(!fs.existsSync(path.join(dir, 'b.txt')), 'main content did not land in the feature checkout');
    const trial = trialOf(out);
    assert.ok(trial && !fs.existsSync(trial), 'trial worktree removed');
    assert.ok(!git(dir, 'worktree', 'list').includes('trial-merge'), 'worktree unregistered');
  });

  it('a conflicting merge still removes the worktree and never touches the feature branch', () => {
    const dir = fixture({ conflict: true });
    const head = git(dir, 'rev-parse', 'HEAD');
    const out = runSnippet(dir, 'true');
    assert.match(out.stdout + out.stderr, /CONFLICT/, 'the conflict is visible in the output');
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'feature HEAD unchanged');
    assert.equal(git(dir, 'status', '--porcelain'), '', 'feature checkout clean, no merge state');
    assert.ok(!fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')), 'no merge in progress on the feature checkout');
    const trial = trialOf(out);
    assert.ok(trial && !fs.existsSync(trial), 'conflicted trial worktree removed');
    assert.ok(!git(dir, 'worktree', 'list').includes('trial-merge'), 'worktree unregistered');
  });

  it('a red build does not abort cleanup', () => {
    const dir = fixture({ conflict: false });
    const out = runSnippet(dir, 'false');
    const trial = trialOf(out);
    assert.ok(trial && !fs.existsSync(trial), 'trial worktree removed after a red build');
    assert.ok(!git(dir, 'worktree', 'list').includes('trial-merge'), 'worktree unregistered');
  });
});
