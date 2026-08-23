/**
 * Lane-stamp / tombstone-filter integration tests (verification stage).
 *
 * The `lane:` stamp is a new write into a file half of Ship reads, and the
 * widened tombstone set changes what `scan-features.cjs` feeds every session
 * hook. These cases cover the blast radius rather than the unit:
 *
 * - concurrent pm-update runs in one lane never corrupt CONTEXT.md
 * - a stamped CONTEXT.md still parses for status sync and the `--next` pick
 * - guide.cjs / post-compact.cjs stop offering a `superseded` feature but
 *   still offer one with an unrecognised status
 * - pm-sync-nudge.cjs tolerates the widened filter
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PM_UPDATE_PATH = path.join(ROOT, 'ship', 'pm-update.cjs');
const GUIDE_PATH = path.join(ROOT, 'hooks', 'guide.cjs');
const POST_COMPACT_PATH = path.join(ROOT, 'hooks', 'post-compact.cjs');
const NUDGE_PATH = path.join(ROOT, 'hooks', 'pm-sync-nudge.cjs');

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
  return r.stdout;
}

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

function feature(dir, slug, status) {
  const fd = path.join(dir, '.planning', 'features', slug);
  fs.mkdirSync(fd, { recursive: true });
  fs.writeFileSync(
    path.join(fd, 'CONTEXT.md'),
    `---\nfeature: "${slug}"\nstatus: ${status}\ncreated: "2026-08-23"\n---\n\n## Problem\n\nfixture\n`
  );
  return path.join(fd, 'CONTEXT.md');
}

function roadmap(dir, rows) {
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
      ...rows,
      ''
    ].join('\n')
  );
}

/** Feed a hook its stdin payload and return parsed stdout (or null). */
function runHook(scriptPath, cwd, payload) {
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify(payload)
  });
  assert.equal(r.status, 0, `${path.basename(scriptPath)} exited ${r.status}: ${r.stderr}`);
  if (!r.stdout.trim()) return null;
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`${path.basename(scriptPath)} emitted non-JSON: ${r.stdout}`);
  }
}

const hookText = (out) =>
  (out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) || '';

describe('lane-stamp integration — concurrency and status round-trip', { skip: !gitAvailable }, () => {
  let base;

  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-stamp-int-')));
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('six concurrent pm-update runs leave exactly one intact stamp', async () => {
    const repo = path.join(base, 'concurrent');
    initRepo(repo);
    roadmap(repo, ['| Build widget | pending | P1 | widget |']);
    const file = feature(repo, 'widget', 'building');
    const before = fs.readFileSync(file, 'utf8');

    const runs = await Promise.all(
      Array.from({ length: 6 }, () =>
        new Promise((resolve) => {
          const { spawn } = require('node:child_process');
          const child = spawn(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo });
          let out = '';
          let err = '';
          child.stdout.on('data', (d) => (out += d));
          child.stderr.on('data', (d) => (err += d));
          child.on('close', (code) => resolve({ code, out, err }));
        })
      )
    );

    for (const r of runs) assert.equal(r.code, 0, `a concurrent run failed: ${r.err}`);

    const after = fs.readFileSync(file, 'utf8');
    assert.equal((after.match(/^lane:/gm) || []).length, 1, 'exactly one stamp line, never duplicated');
    assert.ok(after.startsWith('---\n'), 'frontmatter intact');
    assert.ok(after.includes('## Problem'), 'body intact');
    assert.equal(after.replace(/^lane:.*\n/m, ''), before, 'the stamp is the only change');
    const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, [], 'no temp files survive a concurrent write');
  });

  it('a stamped CONTEXT.md still drives status sync and --next', () => {
    const repo = path.join(base, 'roundtrip');
    initRepo(repo);
    roadmap(repo, [
      '| Build widget | pending | P1 | widget |',
      '| Build gadget | pending | P2 | gadget |'
    ]);
    feature(repo, 'widget', 'building');

    const first = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const roadmapAfter = fs.readFileSync(path.join(repo, '.project-manager', 'ROADMAP.md'), 'utf8');
    assert.ok(/\| Build widget \| in-progress \|/.test(roadmapAfter), 'status sync survives the stamp');

    // Second run over an already-stamped file: the frontmatter parse must not
    // trip over the new key.
    const second = spawnSync(process.execPath, [PM_UPDATE_PATH, 'widget'], { cwd: repo, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);

    const contextBefore = fs.readFileSync(
      path.join(repo, '.planning', 'features', 'widget', 'CONTEXT.md'), 'utf8');
    const next = spawnSync(process.execPath, [PM_UPDATE_PATH, '--next'], { cwd: repo, encoding: 'utf8' });
    assert.equal(next.status, 0, next.stderr);
    const picked = JSON.parse(next.stdout);
    // in-progress P1 still outranks a pending P2 — the stamp changes nothing
    // about the selection, and `--next` must write nothing at all.
    assert.equal(picked.item, 'Build widget', 'the stamp does not disturb the next-item pick');
    assert.equal(
      fs.readFileSync(path.join(repo, '.planning', 'features', 'widget', 'CONTEXT.md'), 'utf8'),
      contextBefore,
      '--next leaves CONTEXT.md byte-identical'
    );
  });
});

describe('lane-stamp integration — session hooks under the widened filter', () => {
  let dir;

  before(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-stamp-hooks-')));
    feature(dir, 'ghost', 'superseded');
    feature(dir, 'buried', 'abandoned');
    feature(dir, 'shipped', 'done');
    feature(dir, 'typo', 'buidling');
    feature(dir, 'alive', 'building');
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('guide.cjs no longer offers tombstoned features but still offers live and typo ones', () => {
    const text = hookText(runHook(GUIDE_PATH, dir, { hook_event_name: 'SessionStart', source: 'startup' }));
    assert.ok(text.includes('alive'), 'a live feature is still injected');
    assert.ok(text.includes('typo'), 'an unrecognised status must never silently disappear');
    for (const gone of ['ghost', 'buried', 'shipped']) {
      assert.ok(!text.includes(gone), `${gone} is tombstoned and must not be offered for resumption`);
    }
  });

  it('post-compact.cjs applies the same filter', () => {
    const text = hookText(runHook(POST_COMPACT_PATH, dir, { hook_event_name: 'PostCompact' }));
    assert.ok(text.includes('alive'));
    assert.ok(!text.includes('ghost'), 'a superseded feature is not re-injected after compaction');
  });

  it('pm-sync-nudge.cjs survives a tombstoned fleet without throwing', () => {
    const r = spawnSync(process.execPath, [NUDGE_PATH], {
      cwd: dir,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write' })
    });
    assert.equal(r.status, 0, `nudge exited ${r.status}: ${r.stderr}`);
    assert.equal(r.stderr, '', 'a hook never writes to stderr');
  });
});
