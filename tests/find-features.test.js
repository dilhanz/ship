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
