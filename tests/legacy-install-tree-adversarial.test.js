/**
 * Legacy install-tree guard — adversarial tests (verification stage).
 *
 * `tests/legacy-install-tree.test.js` asserts a hardcoded list of paths is
 * absent. That list is only as good as its agreement with what `install.js`
 * actually writes — and `install.js` is still functional, which is the entire
 * reason the guard exists. Two failure modes the happy-path guard cannot see:
 *
 *   1. `install.js` grows a fifth destination under `.claude/` (its own
 *      `uninstall()` already reaches for `.claude/commands/ship` and
 *      `.claude/cache/`, so that surface has moved before). The guard would
 *      stay green while a new fossil directory landed and loaded.
 *   2. Someone weakens or deletes one of the five absence assertions. The
 *      guard would stay green against a fully restored tree.
 *
 * Both are probed behaviourally: `install.js` is run inside a throwaway
 * sandbox (never this repo — it writes `.claude/` into `process.cwd()`), and
 * the real guard file is executed against the tree it produces.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(__dirname, 'legacy-install-tree.test.js');

// Everything the guard asserts absent. `.claude/agent-memory` is the one entry
// deliberately preserved, so it is expected in the sandbox tree and is not a
// coverage gap. `settings.local.json` is excluded from the guard on purpose
// (the harness recreates it) and install.js never writes it.
const GUARDED = new Set(['agents', 'hooks', 'skills', 'ship', 'settings.json']);
const PRESERVED = new Set(['agent-memory']);

let sandbox = null;
let installStatus = null;

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-install-guard-'));
  // SHIP_ROOT is install.js's own __dirname, so the four source trees must sit
  // beside the copied installer.
  for (const dir of ['skills', 'agents', 'ship', 'hooks']) {
    fs.cpSync(path.join(ROOT, dir), path.join(sandbox, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, 'install.js'), path.join(sandbox, 'install.js'));

  // The two paths the guard requires to SURVIVE, so a red run in the sandbox
  // can only be the absence assertions firing.
  fs.mkdirSync(path.join(sandbox, '.claude', 'agent-memory', 'ship-ship-verifier'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, '.claude', 'agent-memory', 'ship-ship-verifier', 'MEMORY.md'), '# Memory Index\n');
  fs.mkdirSync(path.join(sandbox, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(sandbox, '.claude-plugin', 'plugin.json'));

  const r = spawnSync(process.execPath, ['install.js'], { cwd: sandbox, encoding: 'utf8' });
  installStatus = r.status;
});

after(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('legacy install-tree guard vs. the installer it guards against', () => {
  it('install.js still runs, so the guard is not defending against a dead script', () => {
    assert.equal(installStatus, 0, 'install.js exited non-zero in the sandbox — the probe below proves nothing');
  });

  it('the guard covers every path install.js writes under .claude/', () => {
    const written = fs.readdirSync(path.join(sandbox, '.claude'));
    const uncovered = written.filter((entry) => !GUARDED.has(entry) && !PRESERVED.has(entry));
    assert.deepEqual(
      uncovered,
      [],
      `install.js writes .claude/${uncovered.join(', .claude/')} — tests/legacy-install-tree.test.js does not assert on it, ` +
        'so the fossil could return unnoticed. Add the path to that test\'s legacyDirs (and to GUARDED here).',
    );
    // And the coverage is not vacuous the other way: the installer really did
    // lay down the tree this test claims to have measured.
    for (const entry of GUARDED) {
      assert.ok(written.includes(entry), `install.js did not create .claude/${entry} — GUARDED is stale`);
    }
  });

  it('the guard goes red — on all five absence assertions — against a restored tree', () => {
    const sandboxTests = path.join(sandbox, 'tests');
    fs.mkdirSync(sandboxTests, { recursive: true });
    fs.copyFileSync(GUARD, path.join(sandboxTests, 'legacy-install-tree.test.js'));

    // TAP reporter: the local spec reporter is unparseable for assertions.
    //
    // NODE_TEST_CONTEXT must be stripped. Node sets it to `child-v8` inside a
    // test process, and an inherited copy makes the nested runner emit nothing
    // and exit 0 — a silent pass that would make this whole case vacuous.
    // Measured: inherited env → status 0, empty stdout; stripped → status 1.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;

    const r = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', 'tests/legacy-install-tree.test.js'],
      { cwd: sandbox, encoding: 'utf8', env: childEnv },
    );

    assert.ok(
      (r.stdout || '').includes('TAP version'),
      `the nested test runner produced no TAP output — this case would pass vacuously.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );

    assert.notEqual(r.status, 0, 'the guard passed against a tree install.js had just restored — an assertion has been weakened or removed');

    const out = r.stdout || '';
    const failed = new Set(
      out
        .split('\n')
        .filter((line) => /^\s*not ok /.test(line))
        .map((line) => line.replace(/^\s*not ok \d+ - /, '').trim()),
    );
    for (const rel of ['.claude/agents', '.claude/hooks', '.claude/skills', '.claude/ship']) {
      assert.ok(failed.has(`${rel} is absent`), `the guard did not fail on ${rel} — TAP output:\n${out}`);
    }
    assert.ok(
      failed.has('.claude/settings.json is absent'),
      `the guard did not fail on .claude/settings.json, the activation mechanism — TAP output:\n${out}`,
    );

    // The preservation half must NOT be collateral damage: those two cases pass
    // in the sandbox, so a red run cannot be mistaken for a broken fixture.
    assert.ok(
      !failed.has('.claude/agent-memory/ship-ship-verifier survives'),
      `the preserved-memory case failed in the sandbox fixture — TAP output:\n${out}`,
    );
    assert.ok(
      !failed.has('.claude-plugin/plugin.json is untouched'),
      `the plugin-manifest case failed in the sandbox fixture — TAP output:\n${out}`,
    );
  });

  it('the real repo tree carries no .claude entry other than the preserved memory', () => {
    const entries = fs.readdirSync(path.join(ROOT, '.claude'));
    const unexpected = entries.filter((e) => !PRESERVED.has(e) && e !== 'settings.local.json');
    assert.deepEqual(unexpected, [], `.claude/ holds unexpected entries: ${unexpected.join(', ')}`);
  });
});
