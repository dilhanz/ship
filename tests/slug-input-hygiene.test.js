/**
 * Slug input hygiene — the two bugs left open by the worktree-aware-lookup
 * verification, both on the path a slug argument takes into the shared lookup.
 *
 * 1. Path escape. `ship/find-features.cjs` `listSlugs()` joins the slug under
 *    `{root}/.planning/{section}/` with no validation, so before 5.22.2 a
 *    relative slug walked out of the tree: from a scratch repo,
 *    `node ship/find-features.cjs '../../../outside'` returned an entry whose
 *    `status` was read from a CONTEXT.md that is not under `.planning/` at
 *    all. The fixture here reproduces that layout — a sibling `outside/`
 *    directory beside `repo/` carrying `status: leaked-status` — and asserts
 *    that string never reaches the result. The guard rejects a slug that is
 *    empty, whitespace-only, or contains `/`, `\`, or `..`: `features` is `{}`
 *    and `warning` names the slug, the process still exits 0 with one JSON
 *    line, and nothing throws. Rejected rather than `path.basename()`-ed,
 *    because coercion could resolve a different, real feature with no signal.
 *
 * 2. Misleading empty map. `/ship:resume` called the helper *filtered* by the
 *    name in `$ARGUMENTS`, then read an empty `features` as "no features
 *    exist" and suggested `/ship:start` — which, for a typo'd name, creates a
 *    second directory for work already in flight. Resume now makes one
 *    unfiltered call and picks `features[name]` itself, so a miss can be
 *    reported honestly with a listing of what does exist. The doctrine block
 *    (added with the resume rewiring) pins that prose.
 *
 * Note what the guard tests prove and the doctrine tests do not: block 1 runs
 * the helper against a real git repository on disk, so a regression in the
 * guard fails here regardless of how the skill prose reads. Skills are prose
 * executed by a model, so the doctrine block can only keep the prose from
 * drifting back to the shape that produced the bug — it cannot prove the
 * model follows it.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'ship', 'find-features.cjs');
const { findFeatures } = require(helperPath);

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch (e) {
  gitAvailable = false;
}

/**
 * A temp dir holding `repo/` (git-initialised, `.planning/` ignored, one live
 * feature `alpha` and one archived `beta`) and a sibling `outside/` directory
 * whose CONTEXT.md carries `status: leaked-status` — the string that proves the
 * outside file was read if it ever shows up in a result. The root is
 * realpath'd because macOS `os.tmpdir()` is `/var/...` while git and the
 * helper report `/private/var/...`.
 */
function withFixtureRepo(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-slug-hygiene-')));
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const context = (slug, status) => `---\nfeature: "${slug}"\nstatus: ${status}\n---\n\n## Problem\n\nSomething.\n`;
  try {
    fs.mkdirSync(repo, { recursive: true });
    git('init', '-q');
    git('config', 'user.email', 'ship-tests@example.com');
    git('config', 'user.name', 'Ship Tests');
    git('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'README'), 'fixture\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.planning/\n');
    git('add', 'README', '.gitignore');
    git('commit', '-q', '-m', 'init');

    const alphaDir = path.join(repo, '.planning', 'features', 'alpha');
    fs.mkdirSync(alphaDir, { recursive: true });
    fs.writeFileSync(path.join(alphaDir, 'CONTEXT.md'), context('alpha', 'planned'));

    const betaDir = path.join(repo, '.planning', 'archive', 'beta');
    fs.mkdirSync(betaDir, { recursive: true });
    fs.writeFileSync(path.join(betaDir, 'CONTEXT.md'), context('beta', 'done'));

    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'CONTEXT.md'), context('outside', 'leaked-status'));

    // Relative from the features section dir, so it is right on every platform
    // (`../../../outside` on POSIX, `..\..\..\outside` on Windows).
    const escapeSlug = path.relative(path.join(repo, '.planning', 'features'), outside);

    return fn({ repo, outside, escapeSlug });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const rejectedInputs = ['a/b', 'a\\b', '', '   ', 'a..b', '..'];

describe('guard — findFeatures() rejects path-like slugs', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('path escape: a relative slug that leaves .planning/ is rejected and the outside file is never read', () => {
    withFixtureRepo(({ repo, escapeSlug }) => {
      const result = findFeatures({ cwd: repo, slug: escapeSlug });
      assert.deepEqual(result.features, {}, 'a rejected slug must yield an empty features map');
      assert.ok(result.warning, 'a rejected slug must be reported through warning');
      assert.match(result.warning, /invalid slug '.*outside'/, 'the warning must name the rejected slug');
      assert.ok(result.warning.includes('one path segment'), 'the warning must say what a slug is');
      for (const entry of Object.values(result.features)) {
        assert.ok(!String(entry.dir).includes('leaked-status'), 'no entry may point outside the checkout');
      }
      assert.ok(
        !JSON.stringify(result).includes('leaked-status'),
        'leaked-status is the status line of the CONTEXT.md outside .planning/ — its presence proves the outside file was read',
      );
    });
  });

  for (const input of rejectedInputs) {
    it(`rejects ${JSON.stringify(input)} with an empty map and a warning naming it`, () => {
      withFixtureRepo(({ repo }) => {
        const result = findFeatures({ cwd: repo, slug: input });
        assert.deepEqual(result.features, {}, `slug ${JSON.stringify(input)} must not scan anything`);
        assert.notEqual(result.warning, null, `slug ${JSON.stringify(input)} must produce a warning`);
        assert.ok(result.warning.includes('invalid slug'), 'the warning must say the slug was invalid');
        if (input.trim() !== '') {
          assert.ok(result.warning.includes(`'${input}'`), 'the warning must echo the rejected slug');
        }
      });
    });
  }

  it('a legitimate slug is unaffected: exactly that entry, same shape and values as the unfiltered scan', () => {
    withFixtureRepo(({ repo }) => {
      const filtered = findFeatures({ cwd: repo, slug: 'alpha' }).features;
      const all = findFeatures({ cwd: repo }).features;
      assert.deepEqual(Object.keys(filtered), ['alpha'], 'a valid filter returns only the named feature');
      assert.deepEqual(filtered.alpha, all.alpha, 'the filtered entry must equal the unfiltered one byte-for-byte');
      assert.equal(findFeatures({ cwd: repo, slug: 'beta' }).features.beta.location, 'archive', 'a valid filter still reaches the archive');
    });
  });

  it('an omitted, null, or undefined slug is still an unfiltered scan', () => {
    withFixtureRepo(({ repo }) => {
      for (const opts of [{ cwd: repo }, { cwd: repo, slug: null }, { cwd: repo, slug: undefined }]) {
        const { features, warning } = findFeatures(opts);
        assert.deepEqual(Object.keys(features).sort(), ['alpha', 'beta'], `${JSON.stringify(opts)} must not be treated as a filter`);
        assert.equal(warning, null, 'absence of a slug is not an invalid slug');
      }
    });
  });

  it('never throws on a rejected input', () => {
    withFixtureRepo(({ repo, escapeSlug }) => {
      for (const input of [escapeSlug, ...rejectedInputs]) {
        assert.doesNotThrow(() => findFeatures({ cwd: repo, slug: input }), `slug ${JSON.stringify(input)} must be rejected, not thrown`);
      }
    });
  });
});

describe('guard — CLI', { skip: gitAvailable ? false : 'git is not on PATH' }, () => {
  it('exits 0 and prints one JSON line with an empty map and a warning for every rejected slug', () => {
    withFixtureRepo(({ repo, escapeSlug }) => {
      for (const input of [escapeSlug, 'a/b', 'a\\b', '', '   ']) {
        // execFileSync throws on a non-zero exit, so returning at all proves exit 0.
        const stdout = execFileSync(process.execPath, [helperPath, input], { cwd: repo, encoding: 'utf8' });
        assert.equal(stdout.trim().split('\n').length, 1, `slug ${JSON.stringify(input)} must produce exactly one line`);
        const result = JSON.parse(stdout);
        assert.deepEqual(result.features, {}, `slug ${JSON.stringify(input)} must yield an empty map from the CLI`);
        assert.notEqual(result.warning, null, `slug ${JSON.stringify(input)} must carry a warning from the CLI`);
        assert.ok(!stdout.includes('leaked-status'), 'the outside file must never be read through the CLI');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The resume doctrine — prose pins; see the header for what they can prove.
// ---------------------------------------------------------------------------

describe('doctrine — /ship:resume resolves a name from the unfiltered map', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'skills', 'resume', 'SKILL.md'), 'utf8');
  const paragraphs = (text) => text.split(/\n[ \t]*\n/);

  const step1Start = src.indexOf('1. Find the feature');
  const step2Start = src.indexOf('2. Pick the feature');
  const step3Start = src.indexOf('3. **Hop');
  const step1 = src.slice(step1Start, step2Start);
  const step2 = src.slice(step2Start, step3Start);

  it('step 1 makes exactly one helper call and never a filtered one', () => {
    assert.doesNotMatch(
      src,
      /find-features\.cjs"\s+\{name\}/,
      'a `{name}` argument on the helper command line is the filtered call that made a typo look like an empty map',
    );
    assert.doesNotMatch(
      src,
      /find-features\.cjs"\s+\$ARGUMENTS/,
      'passing `$ARGUMENTS` on the helper command line is the same filtered call under another name',
    );
    assert.ok(
      src.includes('node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"'),
      'resume must still shell out to the helper with the unfiltered command line',
    );
    const quotedInvocations = src.split('find-features.cjs"').length - 1;
    assert.equal(
      quotedInvocations,
      1,
      'counts the quoted fenced invocation `find-features.cjs"` only — unquoted prose mentions of find-features.cjs stay allowed; a second quoted form means a second (filtered) command line came back',
    );
  });

  it('the named-miss branch exists, lists what does exist, and never suggests /ship:start', () => {
    const chunk = paragraphs(src).find((p) => p.includes('was not found in any checkout or the archive'));
    assert.ok(
      chunk,
      'resume must carry a not-found branch for a name that matched no key — without it a miss falls into "no features exist"',
    );
    assert.ok(
      !chunk.includes('/ship:start'),
      'the named-miss branch must not suggest /ship:start — a near-miss name is a typo far more often than new work, and starting from here creates a second directory for work already in flight',
    );
    assert.match(
      chunk,
      /list/i,
      'the named-miss branch must list the entries that do exist so the typo is visible',
    );
  });

  it('the genuinely-empty branch is the only /ship:start source in step 1', () => {
    assert.ok(step1Start >= 0 && step2Start > step1Start, 'step 1 must be locatable between "1. Find the feature" and "2. Pick the feature"');
    const suggesting = paragraphs(step1).filter((p) => p.includes('/ship:start'));
    assert.ok(
      suggesting.length >= 1,
      'step 1 must still suggest /ship:start when the map is genuinely empty — that case is real and the suggestion is correct there',
    );
    for (const chunk of suggesting) {
      assert.ok(
        chunk.includes('genuinely empty'),
        `every step-1 paragraph that suggests /ship:start must be the genuinely-empty case; this one is not:\n${chunk}`,
      );
    }
  });

  it('step 2 looks the name up in the map', () => {
    assert.ok(step2Start >= 0 && step3Start > step2Start, 'step 2 must be locatable between "2. Pick the feature" and "3. **Hop"');
    assert.ok(
      step2.includes('features[name]'),
      'step 2 must pick the named feature by exact key lookup on the unfiltered map — that is what replaced the filtered call',
    );
  });
});
