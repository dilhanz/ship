/**
 * Verifier-authored adversarial tests — hostile input to verify-scratch.cjs.
 *
 * The helper is the one rule whose silent failure reintroduces the bug the
 * feature exists to fix, and CONTEXT.md states its safe direction explicitly:
 * "a wrongly rejected record costs a re-verification, a wrongly accepted one
 * reports a verification that did not happen." These tests attack the accept
 * path from the directions that would make it wrongly accept or crash:
 *
 *   - `base_head` is interpolated into a `git` argument list. If it were ever
 *     passed through a shell, or placed where git reads options, a record could
 *     execute code or coax git into a bogus success.
 *   - `tests[]` and the record envelope come from a file on disk that a dead
 *     agent wrote mid-rewrite, so every shape is reachable — truncated,
 *     half-typed, or not an object at all.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SCRIPT = path.join(repoRoot, 'ship', 'verify-scratch.cjs');
const validator = require(SCRIPT);

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-hostile-')));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Ship Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

function commit(dir, file, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), message);
  git(['add', file], dir);
  git(['commit', '-q', '-m', message], dir);
  return git(['rev-parse', 'HEAD'], dir).stdout.trim();
}

function writeRecord(dir, record) {
  const file = path.join(dir, '.planning', 'features', 'demo', '.review-scratch', 'verify.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record));
}

function withFixture(fn) {
  const dir = fixture();
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('verify-scratch — a hostile base_head cannot reach git as an option', () => {
  it('an option-shaped base_head is rejected, and its payload never executes', () => {
    withFixture((dir) => {
      const marker = path.join(dir, 'pwned-marker');
      for (const base_head of ['--help', '-n', '--all', `--upload-pack=touch ${marker}`, '--exec=whoami']) {
        writeRecord(dir, { feature: 'demo', base_head, stage: 'criteria', tests: [] });
        const v = validator.validateRecord('demo', dir);
        assert.equal(v.valid, false, `option-shaped base_head ${base_head} must not validate`);
        assert.equal(typeof v.reason, 'string');
      }
      assert.equal(fs.existsSync(marker), false,
        'no base_head payload may reach a shell — the helper must spawn git without one');
    });
  });

  it('a base_head from a foreign repository is rejected rather than resolved', () => {
    withFixture((dir) => {
      commit(dir, 'src.js', 'feat: base');
      writeRecord(dir, {
        feature: 'demo', stage: 'criteria', tests: [],
        base_head: '136c13f8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
      });
      assert.equal(validator.validateRecord('demo', dir).valid, false);
    });
  });
});

describe('verify-scratch — a half-written record always fails closed', () => {
  it('every malformed tests[] entry shape is rejected, never crashed on', () => {
    withFixture((dir) => {
      const base = commit(dir, 'src.js', 'feat: base');
      const shapes = [
        [{ file: 'x', commit: null }],
        [{ file: 'x' }],
        [null],
        ['a bare string'],
        [{ file: 'x', commit: {} }],
        [{ file: 'x', commit: '' }],
      ];
      for (const tests of shapes) {
        writeRecord(dir, { feature: 'demo', base_head: base, stage: 'bughunt', tests });
        let v;
        assert.doesNotThrow(() => { v = validator.validateRecord('demo', dir); },
          `shape ${JSON.stringify(tests)} must not throw`);
        assert.equal(v.valid, false, `shape ${JSON.stringify(tests)} must not validate`);
        assert.equal(typeof v.reason, 'string');
      }
    });
  });

  it('an envelope that is not a JSON object is rejected', () => {
    withFixture((dir) => {
      const base = commit(dir, 'src.js', 'feat: base');
      for (const record of ['[1,2,3]', '"a string"', '42', 'null', 'true', '{', '']) {
        writeRecord(dir, record);
        const v = validator.validateRecord('demo', dir);
        assert.equal(v.valid, false, `envelope ${record} must not validate`);
      }
      // ...and tests present but not an array is a rejection too, not a crash.
      writeRecord(dir, { feature: 'demo', base_head: base, stage: 'bughunt', tests: 'nope' });
      assert.equal(validator.validateRecord('demo', dir).valid, false);
    });
  });

  it('a truncated record — the exact shape a mid-rewrite death leaves — is rejected', () => {
    withFixture((dir) => {
      const base = commit(dir, 'src.js', 'feat: base');
      const full = JSON.stringify({
        feature: 'demo', base_head: base, stage: 'bughunt',
        criteria: [{ criterion: 'c', verdict: 'PASS', evidence: 'e' }], tests: [],
      }, null, 2);
      // Cut at several points: the record is rewritten in full each time, so a
      // death during the write leaves a prefix of valid JSON text.
      for (const cut of [10, Math.floor(full.length / 3), Math.floor(full.length / 2), full.length - 5]) {
        writeRecord(dir, full.slice(0, cut));
        let v;
        assert.doesNotThrow(() => { v = validator.validateRecord('demo', dir); });
        assert.equal(v.valid, false, `a record truncated at ${cut} bytes must not validate`);
      }
    });
  });

  it('an empty slug is named as such rather than resolved to the features directory', () => {
    withFixture((dir) => {
      commit(dir, 'src.js', 'feat: base');
      const v = validator.validateRecord('', dir);
      assert.equal(v.valid, false);
      assert.match(v.reason, /no feature named/);
    });
  });
});

describe('verify-scratch — the CLI is a safe subprocess for a workflow to shell out to', () => {
  it('exits 0 and prints one parseable JSON object however it is called', () => {
    withFixture((dir) => {
      const base = commit(dir, 'src.js', 'feat: base');
      writeRecord(dir, { feature: 'demo', base_head: base, stage: 'complete', tests: [] });
      const invocations = [
        [], ['demo'], ['--cwd', dir, 'demo'], ['--cwd', dir], ['demo', '--cwd', dir],
        ['--cwd=/nonexistent', 'demo'], ['--', 'demo'], ['-'], ['--help'],
      ];
      for (const argv of invocations) {
        const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: dir, encoding: 'utf8' });
        assert.equal(r.status, 0, `exit 0 required for ${JSON.stringify(argv)} (stderr: ${r.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); },
          `stdout must be one JSON object for ${JSON.stringify(argv)}, got: ${r.stdout}`);
        assert.equal(typeof parsed.valid, 'boolean');
      }
    });
  });
});
