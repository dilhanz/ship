// `--debt` — verification-debt proposals read out of LEDGER.md.
//
// The mode is a query: it prints JSON and writes nothing at all, the same
// split `--next` and `--evidence` already keep. Ledgers are built inline as
// strings so nothing here depends on this repo's own (gitignored)
// .project-manager/.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { debtProposals } = require(SCRIPT_PATH);

/** Spawn the CLI in a given cwd, return { status, stdout, stderr }. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-debt-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const WIDE_HEADERS = [
  'Feature', 'Shipped', 'Profile', 'Outcome', 'Verify', 'Verify note',
  'Unresolved carried', 'Plan rounds', 'Fix rounds', 'Findings (C/H/M/L)', 'Phases', 'Artifacts'
];

const LEGACY_HEADERS = [
  'Feature', 'Shipped', 'Profile', 'Verify',
  'Unresolved carried', 'Plan rounds', 'Fix rounds', 'Findings (C/H/M/L)', 'Phases', 'Artifacts'
];

/** A LEDGER.md around one table built from a header list and row cell arrays. */
function ledger(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`)
  ];
  return `---\nupdated: "2026-01-01"\n---\n\n# Shipped feature ledger\n\n${lines.join('\n')}\n`;
}

/** A wide row for `slug` with a given verify verdict and outcome. */
function wideRow(slug, verify, outcome = 'shipped') {
  return [slug, '2026-01-01', 'standard', outcome, verify, 'unknown', '0', '1', '0', '0/0/0/0', '1', 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md'];
}

/** A legacy ten-column row (no Outcome, no Verify note). */
function legacyRow(slug, verify) {
  return [slug, '2026-01-01', 'standard', verify, '0', '1', '0', '0/0/0/0', '1', 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md'];
}

describe('debtProposals — which rows are debt', () => {
  for (const verdict of ['none', 'unknown', 'FAIL', 'INCONCLUSIVE']) {
    it(`a row recorded ${verdict} proposes exactly one backlog row`, () => {
      const proposals = debtProposals(ledger(WIDE_HEADERS, [wideRow('alpha', verdict)]));
      assert.equal(proposals.length, 1);
      const p = proposals[0];
      assert.equal(p.item, 'Verify alpha');
      assert.equal(p.status, 'pending');
      assert.equal(p.priority, 'P1');
      assert.equal(p.kind, 'debt');
      assert.equal(p.shipFeature, 'alpha');
      assert.equal(p.verify, verdict);
      assert.equal(p.outcome, 'shipped');
      // The Source must point at the row that produced it — a proposal whose
      // citation cannot be checked is exactly what this feature exists to stop.
      assert.ok(p.source.includes('LEDGER.md'), 'source names the ledger');
      assert.ok(p.source.includes('alpha'), 'source names the slug');
      assert.ok(p.source.includes(verdict), 'source names the verdict it read');
      assert.ok(typeof p.reason === 'string' && p.reason.length > 0, 'reason states what would settle it');
    });
  }

  it('a lower-case FAIL and an upper-case NONE are both debt', () => {
    const proposals = debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'fail'), wideRow('b', 'NONE')]));
    assert.deepEqual(proposals.map(p => p.shipFeature), ['a', 'b']);
  });

  it('PASS and DEFERRED propose nothing', () => {
    const proposals = debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'PASS'), wideRow('b', 'DEFERRED')]));
    assert.deepEqual(proposals, []);
  });

  it('in-progress is not debt — the run has not finished making a verdict', () => {
    assert.deepEqual(debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'in-progress')])), []);
  });

  it('proposals come back in the ledger\'s own row order', () => {
    const content = ledger(WIDE_HEADERS, [
      wideRow('zebra', 'unknown'),
      wideRow('alpha', 'PASS'),
      wideRow('middle', 'FAIL')
    ]);
    assert.deepEqual(debtProposals(content).map(p => p.shipFeature), ['zebra', 'middle']);
  });
});

describe('debtProposals — outcome exclusions', () => {
  for (const outcome of ['abandoned', 'superseded', 'umbrella']) {
    it(`an ${outcome} outcome suppresses an otherwise-qualifying row`, () => {
      assert.deepEqual(debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'unknown', outcome)])), []);
    });
  }

  it('a shipped outcome does not suppress', () => {
    assert.equal(debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'unknown', 'shipped')])).length, 1);
  });

  it('an unknown outcome does not suppress — an unstamped archive is a gap, not evidence', () => {
    const proposals = debtProposals(ledger(WIDE_HEADERS, [wideRow('a', 'unknown', 'unknown')]));
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].outcome, 'unknown');
  });

  it('an absent Outcome column does not suppress and reports unknown', () => {
    const proposals = debtProposals(ledger(LEGACY_HEADERS, [legacyRow('a', 'FAIL')]));
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].outcome, 'unknown');
    assert.equal(proposals[0].verify, 'FAIL');
  });
});

describe('debtProposals — degradation', () => {
  it('an empty, absent or unparseable ledger proposes nothing', () => {
    assert.deepEqual(debtProposals(''), []);
    assert.deepEqual(debtProposals(null), []);
    assert.deepEqual(debtProposals(undefined), []);
    assert.deepEqual(debtProposals(42), []);
    assert.deepEqual(debtProposals('# Ledger\n\nnot a table at all\n'), []);
  });
});

/** Every file under a directory, recursively, as a path -> bytes map. */
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, entry.name);
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, key);
      else out[key] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

/**
 * A repo where a normal run would write plenty: a lane stamp into the active
 * feature's CONTEXT.md, a ledger append for the archived one, a Status
 * reconcile into ROADMAP.md, and a dashboard.
 */
function debtRepo() {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.project-manager', 'ROADMAP.md'),
    '---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### M1 — Test (status: active)\n\n' +
    '| Item | Status | Priority | Depends on | Ship feature |\n| --- | --- | --- | --- | --- |\n' +
    '| Ship alpha | pending | P2 | — | alpha |\n| Ship beta | pending | P2 | — | beta |\n'
  );
  fs.writeFileSync(
    path.join(dir, '.project-manager', 'LEDGER.md'),
    ledger(WIDE_HEADERS, [wideRow('alpha', 'unknown'), wideRow('gamma', 'PASS')])
  );

  const active = path.join(dir, '.planning', 'features', 'beta');
  fs.mkdirSync(active, { recursive: true });
  fs.writeFileSync(path.join(active, 'CONTEXT.md'), '---\nfeature: "beta"\nstatus: building\n---\n\n## Problem\n');

  const archived = path.join(dir, '.planning', 'archive', 'alpha');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'CONTEXT.md'), '---\nfeature: "alpha"\nstatus: done\n---\n\n## Problem\n');
  fs.writeFileSync(path.join(archived, 'VERIFY.md'), '# Verification\n\n**Overall Status:** PASS\n');

  return dir;
}

describe('--debt — the CLI query mode', () => {
  it('prints valid JSON and exits 0', () => {
    const dir = debtRepo();
    const res = runCli(dir, ['--debt']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.deepEqual(parsed.map(p => p.shipFeature), ['alpha']);
    assert.equal(parsed[0].item, 'Verify alpha');
  });

  it('writes nothing at all', () => {
    const dir = debtRepo();
    const before = snapshot(dir);
    const res = runCli(dir, ['--debt']);
    assert.equal(res.status, 0, res.stderr);
    // No roadmap edit, no lane stamp, no ledger append, no dashboard.
    assert.deepEqual(snapshot(dir), before);
  });

  it('combined with a slug argument it still writes nothing', () => {
    const dir = debtRepo();
    const before = snapshot(dir);
    const res = runCli(dir, ['--debt', 'beta']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(snapshot(dir), before);
    JSON.parse(res.stdout);
  });

  it('an absent LEDGER.md prints [] and exits 0', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.project-manager', 'ROADMAP.md'),
      '---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### M1 — Test (status: active)\n'
    );
    const before = snapshot(dir);
    const res = runCli(dir, ['--debt']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), []);
    assert.deepEqual(snapshot(dir), before);
  });

  it('an absent .project-manager/ prints [] and exits 0', () => {
    // The roadmap early-exit sits below this branch, so a repo with no PM
    // directory at all must still answer rather than exit silently.
    const dir = tmpRepo();
    const res = runCli(dir, ['--debt']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), []);
    assert.deepEqual(snapshot(dir), {});
  });

  it('an unparseable LEDGER.md prints [] and exits 0', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.project-manager', 'LEDGER.md'), '# Ledger\n\nnothing tabular here\n');
    const res = runCli(dir, ['--debt']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), []);
  });
});
