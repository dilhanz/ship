// Adversarial cases for ship/find-features.cjs — the edges the happy-path
// fixture in tests/find-features.test.js does not reach: a cwd deep inside a
// checkout rather than at its root, two branches that both claim a slug, a
// detached-HEAD worktree, junk beside real feature dirs, and the shape of an
// archive entry seen from a linked worktree (the data the ledger's marker
// rules have to special-case).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const helperPath = path.join(repoRoot, 'ship', 'find-features.cjs');
const { findFeatures } = require(helperPath);

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (e) {
  gitAvailable = false;
}

function withFixtureRepo(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-find-features-adv-')));
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

    const context = (slug, status) => `---\nfeature: "${slug}"\n${status === undefined ? '' : `status: ${status}\n`}---\n\n## Problem\n\nSomething.\n`;
    const writeFeature = (atRoot, slug, status) => {
      const dir = path.join(atRoot, '.planning', 'features', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CONTEXT.md'), context(slug, status));
      return dir;
    };
    const writeArchived = (atRoot, slug, status) => {
      const dir = path.join(atRoot, '.planning', 'archive', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CONTEXT.md'), context(slug, status));
      return dir;
    };
    const addWorktree = (name, branch) => {
      const wtPath = path.join(root, '.claude', 'worktrees', name);
      fs.mkdirSync(path.dirname(wtPath), { recursive: true });
      if (branch === null) git('worktree', 'add', '-q', '--detach', wtPath, 'main');
      else git('worktree', 'add', '-q', '-b', branch, wtPath, 'main');
      return fs.realpathSync(wtPath);
    };

    return fn({ root, writeFeature, writeArchived, addWorktree });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('find-features adversarial: cwd placement', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('a cwd deep inside a linked worktree still resolves that worktree as here', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      writeFeature(root, 'beta', 'planned');
      const deep = path.join(wt, 'src', 'lib', 'deep');
      fs.mkdirSync(deep, { recursive: true });

      const r = findFeatures({ cwd: deep });
      assert.equal(r.warning, null);
      assert.equal(r.cwdRoot, wt, 'the longest-prefix worktree is the cwd checkout');
      assert.equal(r.mainRoot, root);
      assert.equal(r.features.alpha.here, true);
      assert.equal(r.features.beta.here, false);
      assert.equal(r.features.beta.location, 'main');
    });
  });

  it('a cwd deep inside main (beside the nested worktree dirs) resolves main as here, not the worktree', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      writeFeature(root, 'beta', 'planned');
      const deep = path.join(root, '.claude', 'other');
      fs.mkdirSync(deep, { recursive: true });

      const r = findFeatures({ cwd: deep });
      assert.equal(r.cwdRoot, root, 'a sibling of the worktrees dir belongs to main, not to a worktree');
      assert.equal(r.features.alpha.here, false);
      assert.equal(r.features.alpha.branch, 'feature/alpha');
      assert.equal(r.features.beta.here, true);
    });
  });

  it('CLI parity holds from a worktree subdirectory', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeFeature(wt, 'alpha', 'building');
      const deep = path.join(wt, 'src');
      fs.mkdirSync(deep, { recursive: true });

      const viaCli = JSON.parse(execFileSync(process.execPath, [helperPath, 'alpha'], { cwd: deep, encoding: 'utf8' }));
      assert.equal(viaCli.cwdRoot, wt);
      assert.equal(viaCli.mainRoot, root);
      assert.equal(viaCli.features.alpha.here, true);
    });
  });
});

describe('find-features adversarial: ownership edges', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('two branches that both claim the slug (feature/x and x) are ambiguous, never picked', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const a = addWorktree('x-long', 'feature/x');
      const b = addWorktree('x-short', 'x');
      writeFeature(a, 'x', 'planned');
      writeFeature(b, 'x', 'built');

      const x = findFeatures({ cwd: root }).features.x;
      assert.equal(x.owner, 'ambiguous');
      assert.equal(x.copies, 2);
      assert.equal(x.status, null);
      assert.equal(x.path, null);
      assert.deepEqual(x.candidates.map(c => c.branch).sort(), ['feature/x', 'x']);
    });
  });

  it('a branch match beats the cwd copy even when the cwd holds the slug', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      writeFeature(root, 'y', 'verified');
      const wt = addWorktree('y', 'feature/y');
      writeFeature(wt, 'y', 'planned');

      const fromMain = findFeatures({ cwd: root }).features.y;
      assert.equal(fromMain.owner, 'branch');
      assert.equal(fromMain.here, false, 'main holds a copy, but the branch rule outranks self-testimony');
      assert.equal(fromMain.status, 'planned');
      assert.equal(fromMain.path, wt);
    });
  });

  it('a detached-HEAD worktree holding a feature resolves as a worktree with a null branch', () => {
    withFixtureRepo(({ root, writeFeature, addWorktree }) => {
      const wt = addWorktree('loose', null);
      writeFeature(wt, 'loose', 'building');

      const r = findFeatures({ cwd: root });
      assert.equal(r.warning, null);
      const loose = r.features.loose;
      assert.equal(loose.location, 'worktree');
      assert.equal(loose.branch, null);
      assert.equal(loose.owner, 'sole');
      assert.equal(loose.here, false);
      assert.equal(loose.path, wt);
      const entry = r.worktrees.find(w => w.path === wt);
      assert.ok(entry);
      assert.equal(entry.branch, null);
      assert.ok(entry.head, 'a detached worktree still reports a HEAD sha');
    });
  });

  it('an archive entry seen from a linked worktree is not here and carries no branch', () => {
    // This is the payload the ledger's marker rules receive for every
    // `## Shipped` row when the session sits in a worktree. `here` is false
    // and `branch` is null, so a rule that reads "here false → [status · branch]"
    // before checking `location` would render `[done · detached]`.
    withFixtureRepo(({ root, writeArchived, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeArchived(root, 'shipped', 'done');

      const fromWt = findFeatures({ cwd: wt }).features.shipped;
      assert.equal(fromWt.location, 'archive');
      assert.equal(fromWt.here, false);
      assert.equal(fromWt.branch, null);
      assert.equal(fromWt.owner, 'sole');
      assert.equal(fromWt.path, root, 'the archive lives at the main root');

      const fromMain = findFeatures({ cwd: root }).features.shipped;
      assert.equal(fromMain.location, 'archive');
      assert.equal(fromMain.here, true);
    });
  });
});

describe('find-features adversarial: junk on disk', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('a file, an empty dir, and a dir without CONTEXT.md under .planning/features are all skipped', () => {
    withFixtureRepo(({ root, writeFeature }) => {
      writeFeature(root, 'real', 'planned');
      const featuresDir = path.join(root, '.planning', 'features');
      fs.writeFileSync(path.join(featuresDir, 'stray.md'), 'not a feature\n');
      fs.mkdirSync(path.join(featuresDir, 'empty'));
      fs.mkdirSync(path.join(featuresDir, 'planless'));
      fs.writeFileSync(path.join(featuresDir, 'planless', 'PLAN.md'), '<task id="1" status="pending">\n</task>\n');

      const r = findFeatures({ cwd: root });
      assert.deepEqual(Object.keys(r.features), ['real']);
      assert.equal(r.warning, null);
    });
  });

  it('an empty status: is unknown, a quoted terminal status is kept', () => {
    withFixtureRepo(({ root }) => {
      const mk = (slug, body) => {
        const dir = path.join(root, '.planning', 'features', slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'CONTEXT.md'), body);
      };
      mk('blank', '---\nfeature: "blank"\nstatus:\n---\n');
      mk('quoted', '---\nfeature: "quoted"\nstatus: "done"\n---\n');
      mk('spaced', '---\nfeature: "spaced"\nstatus:    built   \n---\n');

      const f = findFeatures({ cwd: root }).features;
      assert.equal(f.blank.status, 'unknown');
      assert.equal(f.quoted.status, 'done');
      assert.equal(f.spaced.status, 'built');
    });
  });

  it('a CONTEXT.md that is a directory, not a file, is skipped without throwing', () => {
    withFixtureRepo(({ root, writeFeature }) => {
      writeFeature(root, 'real', 'planned');
      fs.mkdirSync(path.join(root, '.planning', 'features', 'weird', 'CONTEXT.md'), { recursive: true });

      const r = findFeatures({ cwd: root });
      assert.deepEqual(Object.keys(r.features), ['real']);
    });
  });

  it('a slug filter that matches only the archive from a worktree returns exactly that entry', () => {
    withFixtureRepo(({ root, writeArchived, addWorktree }) => {
      const wt = addWorktree('alpha', 'feature/alpha');
      writeArchived(root, 'old', 'done');

      const out = JSON.parse(execFileSync(process.execPath, [helperPath, 'old'], { cwd: wt, encoding: 'utf8' }));
      assert.deepEqual(Object.keys(out.features), ['old']);
      assert.equal(out.features.old.location, 'archive');
      assert.equal(out.features.old.status, 'done');
    });
  });
});
