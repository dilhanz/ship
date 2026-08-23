/**
 * CONTEXT.md `lane:` stamp tests — ship/pm-update.cjs stampLane().
 *
 * The stamp is the fleet sweep's last ownership layer, so these cases pin
 * both halves of its contract: the splice is byte-conservative (frontmatter
 * keys, body, and line endings survive), and every failure is silent and
 * non-fatal — a broken stamp must never cost the caller its exit code or the
 * .project-manager/ sync that follows it.
 *
 * Git-gated: the lane identity comes from real `git rev-parse`.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { stampLane } = require(SCRIPT_PATH);

const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Run git in a directory, asserting success. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

/** Spawn the pm-update CLI in a given cwd. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

/** Init a repo with a local identity and one commit. */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-m', 'init');
}

/** Write .planning/features/{slug}/CONTEXT.md verbatim. */
function writeContext(dir, slug, content) {
  const featureDir = path.join(dir, '.planning', 'features', slug);
  fs.mkdirSync(featureDir, { recursive: true });
  const file = path.join(featureDir, 'CONTEXT.md');
  fs.writeFileSync(file, content);
  return file;
}

/** The repo's current branch, as git reports it. */
function branchOf(dir) {
  return git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
}

/** The repo's toplevel, forward-slashed — what the stamp must record. */
function toplevelOf(dir) {
  return git(dir, 'rev-parse', '--show-toplevel').trim().replace(/\\/g, '/');
}

/** The frontmatter block of a CONTEXT.md. */
function frontmatterOf(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

const BODY = '\n## Problem\n\nA fixture feature.\n\nDocs sometimes quote `lane: main @ /somewhere` as prose.\n';
const CONTEXT = `---\nfeature: "widget"\nstatus: building\ncreated: "2026-08-23"\n---\n${BODY}`;

describe('lane-stamp: stampLane', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    // realpath: macOS /var is a symlink to /private/var and --show-toplevel
    // returns the real path, so the fixture must compare against the same.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-stamp-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes the stamp into frontmatter, keeping other keys and the body byte-identical', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);

    assert.equal(stampLane(repo, 'widget'), true);

    const after = fs.readFileSync(file, 'utf8');
    const fm = frontmatterOf(file);
    assert.match(fm, /^lane: .+ @ .+$/m);
    assert.equal(fm.match(/^lane:.*$/m)[0], `lane: ${branchOf(repo)} @ ${toplevelOf(repo)}`);

    assert.match(fm, /^feature: "widget"$/m, 'existing frontmatter keys survive');
    assert.match(fm, /^status: building$/m);
    assert.match(fm, /^created: "2026-08-23"$/m);
    assert.equal(after.slice(after.indexOf('\n---\n') + '\n---\n'.length), BODY, 'body untouched');
  });

  it('rewrites an existing stamp in place rather than appending a duplicate', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);

    assert.equal(stampLane(repo, 'widget'), true);
    const first = frontmatterOf(file).match(/^lane:.*$/m)[0];

    git(repo, 'checkout', '-b', 'feature/widget');
    assert.equal(stampLane(repo, 'widget'), true);

    const fm = frontmatterOf(file);
    const laneLines = fm.split(/\r?\n/).filter(l => /^lane:/.test(l));
    assert.equal(laneLines.length, 1, 'exactly one lane: line');
    assert.notEqual(laneLines[0], first, 'the stamp names the new branch');
    assert.equal(laneLines[0], `lane: feature/widget @ ${toplevelOf(repo)}`);
    assert.match(fm, /^status: building$/m, 'sibling keys still intact after the rewrite');
  });

  it('is a no-op that still reports true when the stamp is already byte-identical', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);

    assert.equal(stampLane(repo, 'widget'), true);
    const stamped = fs.readFileSync(file, 'utf8');

    assert.equal(stampLane(repo, 'widget'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), stamped, 'no rewrite when nothing changed');
  });

  it('refuses a CONTEXT.md with no frontmatter instead of inventing one', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const raw = '# Widget\n\nNo frontmatter here.\n';
    const file = writeContext(repo, 'widget', raw);

    assert.equal(stampLane(repo, 'widget'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'file unchanged');
  });

  it('returns false for a missing CONTEXT.md', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    assert.equal(stampLane(repo, 'nonexistent'), false);
  });

  it('rejects an invalid slug without touching the filesystem', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);
    const escapeTarget = path.join(root, 'CONTEXT.md');
    fs.writeFileSync(escapeTarget, CONTEXT);

    assert.equal(stampLane(repo, '../escape'), false);
    assert.equal(stampLane(repo, '.planning'), false);

    assert.equal(fs.readFileSync(file, 'utf8'), CONTEXT, 'the real feature is untouched');
    assert.equal(fs.readFileSync(escapeTarget, 'utf8'), CONTEXT, 'nothing written outside .planning/features');
  });

  it('returns false outside a git repo', () => {
    const bare = path.join(root, 'not-a-repo');
    fs.mkdirSync(bare, { recursive: true });
    const file = writeContext(bare, 'widget', CONTEXT);

    assert.equal(stampLane(bare, 'widget'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), CONTEXT);
  });

  it('preserves CRLF line endings', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const crlf = CONTEXT.replace(/\n/g, '\r\n');
    const file = writeContext(repo, 'widget', crlf);

    assert.equal(stampLane(repo, 'widget'), true);

    const after = fs.readFileSync(file, 'utf8');
    assert.ok(!/[^\r]\n/.test(after), 'every newline is still preceded by a carriage return');
    assert.match(after, /\r\nlane: .+ @ .+\r\n---\r\n/, 'the stamp is the last frontmatter line, CRLF-terminated');
  });

  it('stamps a detached HEAD as `detached`', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);
    git(repo, 'checkout', '--detach', 'HEAD');

    assert.equal(stampLane(repo, 'widget'), true);
    assert.equal(frontmatterOf(file).match(/^lane:.*$/m)[0], `lane: detached @ ${toplevelOf(repo)}`);
  });
});

describe('lane-stamp: pm-update CLI wiring', { skip: !gitAvailable }, () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-stamp-cli-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Minimal .project-manager/ so the roadmap sync actually runs. */
  function writePm(dir) {
    const pm = path.join(dir, '.project-manager');
    fs.mkdirSync(pm, { recursive: true });
    fs.writeFileSync(
      path.join(pm, 'ROADMAP.md'),
      [
        '---',
        'project: "Fixture"',
        'updated: "2026-08-01"',
        '---',
        '',
        '## Backlog',
        '',
        '| Item | Status | Priority | Ship feature |',
        '| --- | --- | --- | --- |',
        '| Build widget | pending | P1 | widget |',
        '',
      ].join('\n')
    );
  }

  it('stamps from a repo with no .project-manager/ and still exits 0', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    const file = writeContext(repo, 'widget', CONTEXT);

    const cli = runCli(repo, ['widget']);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(
      frontmatterOf(file).match(/^lane:.*$/m)[0],
      `lane: ${branchOf(repo)} @ ${toplevelOf(repo)}`,
      'the stamp does not depend on a PM directory existing'
    );
  });

  it('--next writes no stamp', () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    writePm(repo);
    const file = writeContext(repo, 'widget', CONTEXT);

    const cli = runCli(repo, ['widget', '--next']);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), CONTEXT, '--next means write nothing');
  });

  it('a failed stamp still syncs .project-manager/, exits 0, and prints nothing to stdout', { skip: isRoot }, () => {
    const repo = path.join(root, 'repo');
    initRepo(repo);
    writePm(repo);
    const file = writeContext(repo, 'widget', CONTEXT);
    const featureDir = path.dirname(file);

    // Read-only file AND read-only containing directory: writeFileAtomic
    // renames a sibling temp file over the target, so a writable directory
    // would let the write through regardless of the file's own mode.
    fs.chmodSync(file, 0o444);
    fs.chmodSync(featureDir, 0o555);
    try {
      assert.equal(stampLane(repo, 'widget'), false, 'the stamp genuinely fails in this fixture');
      assert.equal(fs.readFileSync(file, 'utf8'), CONTEXT, 'CONTEXT.md unchanged by the failed stamp');

      const cli = runCli(repo, ['widget']);
      assert.equal(cli.status, 0, cli.stderr);
      assert.equal(cli.stdout, '', 'no error to stdout');
      assert.equal(cli.stderr, '', 'a failed stamp is silent on stderr too');

      const roadmap = fs.readFileSync(path.join(repo, '.project-manager', 'ROADMAP.md'), 'utf8');
      assert.ok(roadmap.includes('| Build widget | in-progress |'), 'roadmap sync still happened');
      assert.ok(
        fs.existsSync(path.join(repo, '.project-manager', 'dashboard.html')),
        'dashboard still regenerated'
      );
    } finally {
      fs.chmodSync(featureDir, 0o755);
      fs.chmodSync(file, 0o644);
    }
  });
});
