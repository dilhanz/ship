// The ledger lives at the main worktree root, and /ship:ledger and /ship:start
// resolve it with a Bash snippet in their SKILL.md. Prose pins say the snippet
// is present; this file extracts the snippet verbatim from the skill text and
// executes it, so the shell idiom itself is under test: from the main
// checkout, from a linked worktree, from a subdirectory of one, from a
// directory that is not a repository, and with git unreachable.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (e) {
  gitAvailable = false;
}
const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';

// The snippet under "## Locate the ledger" — three lines ending in LEDGER=...
function ledgerSnippet() {
  const c = readSrc('skills/ledger/SKILL.md');
  const m = c.match(/```bash\n(MAIN_ROOT=\$\(dirname[\s\S]*?\nLEDGER="\$MAIN_ROOT\/\.planning\/LEDGER\.md"\n)```/);
  assert.ok(m, 'skills/ledger/SKILL.md must carry the MAIN_ROOT/LEDGER resolution snippet in a bash fence');
  return m[1];
}

// The single MAIN_ROOT line /ship:start uses (ledger row + worktree offer).
function startMainRootLine() {
  const c = readSrc('skills/start/SKILL.md');
  const m = c.match(/^MAIN_ROOT=\$\(dirname "\$\(git rev-parse --path-format=absolute --git-common-dir\)"\)$/m);
  assert.ok(m, 'skills/start/SKILL.md must derive MAIN_ROOT through --git-common-dir');
  return m[0];
}

function withFixtureRepo(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ledger-main-root-')));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    git('config', 'user.email', 'ship-tests@example.com');
    git('config', 'user.name', 'Ship Tests');
    git('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'README'), 'fixture\n');
    fs.writeFileSync(path.join(root, '.gitignore'), '.planning/\n');
    git('add', 'README', '.gitignore');
    git('commit', '-q', '-m', 'init');
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'LEDGER.md'), '# Ledger\n\n## Now\n_(empty)_\n\n## Next\n_(empty)_\n\n## Someday\n_(empty)_\n\n## Shipped\n_(empty)_\n');
    const wtPath = path.join(root, '.claude', 'worktrees', 'alpha');
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git('worktree', 'add', '-q', '-b', 'feature/alpha', wtPath, 'main');
    return fn({ root, wt: fs.realpathSync(wtPath) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function resolveLedger(cwd, env) {
  const r = spawnSync(bash, ['-c', ledgerSnippet() + 'printf "%s\\n" "$MAIN_ROOT" "$LEDGER"'], { cwd, env: env || process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `snippet must exit 0: ${r.stderr}`);
  const [mainRoot, ledger] = r.stdout.trim().split('\n');
  return { mainRoot, ledger };
}

describe('ledger main-root snippet — /ship:ledger', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('from the main checkout resolves the local .planning/LEDGER.md', () => {
    withFixtureRepo(({ root }) => {
      const { mainRoot, ledger } = resolveLedger(root);
      assert.equal(mainRoot, root);
      assert.equal(ledger, path.join(root, '.planning', 'LEDGER.md'));
      assert.ok(fs.existsSync(ledger));
    });
  });

  it('from a linked worktree resolves the main root ledger and creates nothing in the worktree', () => {
    withFixtureRepo(({ root, wt }) => {
      const { mainRoot, ledger } = resolveLedger(wt);
      assert.equal(mainRoot, root, 'the git common dir sits under main');
      assert.equal(ledger, path.join(root, '.planning', 'LEDGER.md'));
      assert.ok(fs.existsSync(ledger), 'the one ledger is found, not reported empty');
      assert.ok(!fs.existsSync(path.join(wt, '.planning', 'LEDGER.md')), 'no second copy in the worktree');
    });
  });

  it('from a subdirectory of a linked worktree still resolves the main root', () => {
    withFixtureRepo(({ root, wt }) => {
      const deep = path.join(wt, 'src', 'deep');
      fs.mkdirSync(deep, { recursive: true });
      const { ledger } = resolveLedger(deep);
      assert.equal(ledger, path.join(root, '.planning', 'LEDGER.md'));
    });
  });

  it('outside any repository falls back to the cwd and exits 0', () => {
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ledger-plain-')));
    try {
      const { mainRoot, ledger } = resolveLedger(plain);
      assert.equal(mainRoot, plain, "today's behavior: the relative ledger");
      assert.equal(ledger, path.join(plain, '.planning', 'LEDGER.md'));
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('with git (and dirname) unreachable falls back to the cwd and exits 0', () => {
    withFixtureRepo(({ wt }) => {
      // PATH is hostile so neither git nor dirname resolves; bash is spawned by
      // absolute path so the test itself does not trip over the same PATH.
      const { mainRoot, ledger } = resolveLedger(wt, { ...process.env, PATH: '/nonexistent' });
      assert.equal(mainRoot, wt, 'no git → the cwd is the root, never an empty or "." path');
      assert.equal(ledger, path.join(wt, '.planning', 'LEDGER.md'));
    });
  });
});

describe('ledger main-root idiom — /ship:start', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('MAIN_ROOT equals CWD_ROOT in main and differs inside a linked worktree', () => {
    withFixtureRepo(({ root, wt }) => {
      const script = startMainRootLine() + '; CWD_ROOT=$(git rev-parse --show-toplevel); printf "%s\\n" "$MAIN_ROOT" "$CWD_ROOT"';
      const fromMain = spawnSync(bash, ['-c', script], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n');
      assert.deepEqual(fromMain, [root, root], 'in main the two agree, so the worktree offer is made');
      const fromWt = spawnSync(bash, ['-c', script], { cwd: wt, encoding: 'utf8' }).stdout.trim().split('\n');
      assert.deepEqual(fromWt, [root, wt], 'in a worktree MAIN_ROOT is main and CWD_ROOT is the worktree, so the offer is skipped and the row goes to main');
      assert.ok(fs.existsSync(path.join(fromWt[0], '.planning', 'LEDGER.md')), 'the row target exists at MAIN_ROOT');
    });
  });
});
