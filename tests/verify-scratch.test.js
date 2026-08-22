// Tests for ship/verify-scratch.cjs — the base-head validity rule that decides
// whether the verifier's incremental scratch record describes THIS build.
//
// Every rejection path is exercised against a real fixture git repository
// rather than asserted as prose: this helper is the one component whose silent
// failure reintroduces the bug the feature exists to fix.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'verify-scratch.cjs');
const { RECORD_STAGES, recordPath, parseRecord, validateRecord } = require(SCRIPT_PATH);

/** Real git is needed for every fixture-repo suite. */
const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

const SLUG = 'sample-feature';

/** Make a temp dir; the caller removes it in a finally block. */
function makeTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A git runner bound to a fixture repo, asserting exit 0. */
function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
    return r.stdout.trim();
  };
}

/** Initialise a fixture repo with one commit; returns { dir, git, head }. */
function makeRepo(prefix) {
  const dir = makeTmp(prefix);
  const git = gitIn(dir);
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Ship Test');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('commit', '-m', 'init');
  return { dir, git, head: git('rev-parse', 'HEAD') };
}

/** Write file + commit; returns the new HEAD sha. */
function commitFile(dir, git, name, body) {
  fs.writeFileSync(path.join(dir, name), body);
  git('add', name);
  git('commit', '-m', `add ${name}`);
  return git('rev-parse', 'HEAD');
}

/** Write a scratch record (object or raw string) for SLUG in dir. */
function writeRecord(dir, record, slug = SLUG) {
  const file = recordPath(slug, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record, null, 2));
  return file;
}

function assertRejected(verdict) {
  assert.equal(verdict.valid, false);
  assert.equal(typeof verdict.reason, 'string');
  assert.ok(verdict.reason.length > 0, 'a rejection always says why');
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('verify-scratch: module shape', () => {
  it('exports the three record stages in order', () => {
    assert.deepEqual([...RECORD_STAGES], ['criteria', 'bughunt', 'complete']);
  });

  it('recordPath points at .review-scratch/verify.json under the feature', () => {
    const p = recordPath('my-feature', path.join(path.sep, 'repo'));
    assert.ok(p.endsWith(path.join('.planning', 'features', 'my-feature', '.review-scratch', 'verify.json')), p);
  });

  it('parseRecord accepts a well-formed record', () => {
    const parsed = parseRecord(JSON.stringify({ feature: SLUG, base_head: 'abc123', stage: 'criteria' }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.record.stage, 'criteria');
  });
});

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

describe('verify-scratch: accept', { skip: !gitAvailable }, () => {
  it('accepts a base head with only the record\'s own test commits after it', () => {
    const { dir, git, head } = makeRepo('ship-vs-accept-');
    try {
      const c1 = commitFile(dir, git, 'test-a.js', 'a\n');
      const c2 = commitFile(dir, git, 'test-b.js', 'b\n');
      writeRecord(dir, {
        feature: SLUG,
        base_head: head,
        stage: 'bughunt',
        criteria: [{ criterion: 'one', verdict: 'PASS', evidence: 'node --test' }],
        carried_findings: [],
        tests: [{ file: 'test-a.js', commit: c1 }, { file: 'test-b.js', commit: c2 }],
      });

      const verdict = validateRecord(SLUG, dir);
      assert.equal(verdict.valid, true, verdict.reason || '');
      assert.equal(verdict.reason, null);
      assert.equal(verdict.stage, 'bughunt', 'the stage is echoed back so the retry knows where to resume');
      assert.equal(verdict.record.feature, SLUG);
    } finally {
      cleanup(dir);
    }
  });

  it('accepts short hashes in tests[].commit', () => {
    const { dir, git, head } = makeRepo('ship-vs-short-');
    try {
      commitFile(dir, git, 'test-a.js', 'a\n');
      const short = git('rev-parse', '--short', 'HEAD');
      writeRecord(dir, { feature: SLUG, base_head: head, stage: 'criteria', tests: [{ file: 'test-a.js', commit: short }] });

      const verdict = validateRecord(SLUG, dir);
      assert.equal(verdict.valid, true, verdict.reason || '');
    } finally {
      cleanup(dir);
    }
  });

  it('accepts an empty base_head..HEAD range (nothing committed yet)', () => {
    const { dir, head } = makeRepo('ship-vs-empty-');
    try {
      writeRecord(dir, { feature: SLUG, base_head: head, stage: 'criteria', criteria: [], tests: [] });

      const verdict = validateRecord(SLUG, dir);
      assert.equal(verdict.valid, true, verdict.reason || '');
      assert.equal(verdict.stage, 'criteria');
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

describe('verify-scratch: reject', { skip: !gitAvailable }, () => {
  it('rejects a base head that is not an ancestor of HEAD', () => {
    const { dir, git, head } = makeRepo('ship-vs-ancestor-');
    try {
      git('checkout', '-b', 'sibling');
      const sibling = commitFile(dir, git, 'sibling.txt', 's\n');
      git('checkout', '-b', 'mainline', head);
      commitFile(dir, git, 'mainline.txt', 'm\n');

      writeRecord(dir, { feature: SLUG, base_head: sibling, stage: 'criteria', tests: [] });

      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /ancestor/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a foreign commit inside base_head..HEAD', () => {
    const { dir, git, head } = makeRepo('ship-vs-foreign-');
    try {
      const mine = commitFile(dir, git, 'test-a.js', 'a\n');
      const foreign = commitFile(dir, git, 'src.js', 'moved under me\n');

      writeRecord(dir, { feature: SLUG, base_head: head, stage: 'bughunt', tests: [{ file: 'test-a.js', commit: mine }] });

      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.ok(verdict.reason.includes(foreign), `reason should name the foreign commit: ${verdict.reason}`);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a recorded test commit that cannot be resolved', () => {
    const { dir, git, head } = makeRepo('ship-vs-unresolvable-');
    try {
      commitFile(dir, git, 'test-a.js', 'a\n');
      writeRecord(dir, { feature: SLUG, base_head: head, stage: 'bughunt', tests: [{ file: 'test-a.js', commit: 'deadbee' }] });

      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /resolve/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a missing record file', () => {
    const { dir } = makeRepo('ship-vs-missing-');
    try {
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /no scratch record/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a malformed record', () => {
    const { dir } = makeRepo('ship-vs-malformed-');
    try {
      writeRecord(dir, 'not json at all');
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /malformed/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects an unstamped pre-contract record (no stage key)', () => {
    const { dir, head } = makeRepo('ship-vs-unstamped-');
    try {
      writeRecord(dir, { feature: SLUG, base_head: head, criteria: [] });
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /stage/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a stage value outside the contract', () => {
    const { dir, head } = makeRepo('ship-vs-badstage-');
    try {
      writeRecord(dir, { feature: SLUG, base_head: head, stage: 'halfway' });
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /stage/i);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a record with no base_head', () => {
    const { dir } = makeRepo('ship-vs-nobase-');
    try {
      writeRecord(dir, { feature: SLUG, stage: 'criteria', criteria: [] });
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
      assert.match(verdict.reason, /base_head/i);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Degrade — never throw
// ---------------------------------------------------------------------------

describe('verify-scratch: degrade', () => {
  it('rejects in a non-git directory without throwing', () => {
    const dir = makeTmp('ship-vs-nonrepo-');
    try {
      writeRecord(dir, { feature: SLUG, base_head: '1'.repeat(40), stage: 'criteria', tests: [] });
      const verdict = validateRecord(SLUG, dir);
      assertRejected(verdict);
    } finally {
      cleanup(dir);
    }
  });

  it('rejects a nonexistent cwd without throwing', () => {
    const verdict = validateRecord(SLUG, path.join(os.tmpdir(), `ship-vs-gone-${Date.now()}`));
    assertRejected(verdict);
  });

  it('rejects garbage arguments without throwing', () => {
    assertRejected(validateRecord(null, null));
    assertRejected(validateRecord('', ''));
    assertRejected(validateRecord(42, {}));
  });
});

// ---------------------------------------------------------------------------
// CLI — always exit 0, always valid JSON
// ---------------------------------------------------------------------------

describe('verify-scratch: CLI', { skip: !gitAvailable }, () => {
  const runCli = (args, cwd) => spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });

  it('exits 0 with a boolean verdict for every input shape', () => {
    const valid = makeRepo('ship-vs-cli-valid-');
    const malformed = makeRepo('ship-vs-cli-bad-');
    const nonRepo = makeTmp('ship-vs-cli-nonrepo-');
    const gone = path.join(os.tmpdir(), `ship-vs-cli-gone-${Date.now()}`);
    try {
      writeRecord(valid.dir, { feature: SLUG, base_head: valid.head, stage: 'complete', tests: [] });
      writeRecord(malformed.dir, 'not json at all');
      writeRecord(nonRepo, { feature: SLUG, base_head: '1'.repeat(40), stage: 'criteria' });

      const cases = [
        { label: 'valid fixture', args: [SLUG], cwd: valid.dir, expect: true },
        { label: 'malformed fixture', args: [SLUG], cwd: malformed.dir, expect: false },
        { label: 'non-git dir', args: [SLUG], cwd: nonRepo, expect: false },
        { label: 'nonexistent path', args: [SLUG, '--cwd', gone], cwd: valid.dir, expect: false },
        { label: 'no slug', args: [], cwd: valid.dir, expect: false },
      ];

      for (const c of cases) {
        const r = runCli(c.args, c.cwd);
        assert.equal(r.status, 0, `${c.label} must exit 0 — a helper hiccup cannot kill a run:\n${r.stderr}`);
        const out = JSON.parse(r.stdout);
        assert.equal(typeof out.valid, 'boolean', `${c.label} must emit a boolean verdict`);
        assert.equal(out.valid, c.expect, `${c.label}: ${out.reason || ''}`);
      }
    } finally {
      cleanup(valid.dir);
      cleanup(malformed.dir);
      cleanup(nonRepo);
    }
  });

  it('--cwd <dir> consumes its value, so the slug is still parsed after it', () => {
    const repo = makeRepo('ship-vs-cli-order-');
    const elsewhere = makeTmp('ship-vs-cli-elsewhere-');
    try {
      writeRecord(repo.dir, { feature: SLUG, base_head: repo.head, stage: 'criteria', tests: [] });

      const r = runCli(['--cwd', repo.dir, SLUG], elsewhere);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.valid, true, `the slug must not be swallowed by --cwd: ${out.reason || ''}`);
    } finally {
      cleanup(repo.dir);
      cleanup(elsewhere);
    }
  });
});
