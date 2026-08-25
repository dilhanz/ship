// Regression coverage for the five findings VERIFY.md left Open when
// pm-evidence-layer shipped. Each block asserts the defect's *absence* — the
// suggested fix in the report, made real — so a revert goes red here.
//
// Everything runs against temp repos and the real ship/pm-update.cjs; nothing
// touches this repo's own (gitignored) .project-manager/.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const {
  computeUnblocks,
  harvestFeature,
  hasLedgerHeader,
  appendLedger
} = require('../ship/pm-update.cjs');

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-evidence-findings-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFeature(dir, slug, files, area = 'archive') {
  const featureDir = path.join(dir, '.planning', area, slug);
  fs.mkdirSync(featureDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(featureDir, name), body);
  }
  return featureDir;
}

function ledger(dir) {
  return fs.readFileSync(path.join(dir, '.project-manager', 'LEDGER.md'), 'utf8');
}

function ledgerDataRows(content) {
  return content
    .split('\n')
    .filter(l => l.startsWith('| ') && l.trim().endsWith('|'))
    .filter(l => !l.includes('| Feature |'))
    .filter(l => !/^\|[\s:-]+\|$/.test(l.trim()));
}

const DONE_CONTEXT = '---\nstatus: done\nprofile: standard\n---\n\n# Context\n';

// ---------------------------------------------------------------------------
// Finding 1 — a headerless LEDGER.md defeated the append-only key
// ---------------------------------------------------------------------------

describe('finding 1 — a headerless LEDGER.md is rebuilt, never appended to', () => {
  it('hasLedgerHeader is true only for a body carrying a real header row', () => {
    const header = '| Feature | Shipped | Profile | Verify | Unresolved carried |';
    assert.equal(hasLedgerHeader(`# Ledger\n\n${header}\n`), true);
    assert.equal(hasLedgerHeader(''), false);
    assert.equal(hasLedgerHeader('# Ledger\n\nno table here\n'), false);
    // A data row alone is not a header — the column order would be unknowable.
    assert.equal(hasLedgerHeader('| alpha | 2026-01-01 | standard | PASS |\n'), false);
    // A partial header is not a header either.
    assert.equal(hasLedgerHeader('| Feature | Shipped |\n'), false);
  });

  it('never throws on a non-string body', () => {
    for (const bad of [undefined, null, 0, {}, [], 42]) {
      assert.equal(hasLedgerHeader(bad), false);
    }
  });

  it('an emptied ledger is rebuilt with a header instead of duplicating rows', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    writeFeature(dir, 'alpha', {
      'CONTEXT.md': DONE_CONTEXT,
      'VERIFY.md': '**Overall Status:** PASS\n**Head:** abc123\n'
    });

    assert.equal(runCli(dir, ['alpha']).status, 0);
    assert.equal(ledgerDataRows(ledger(dir)).length, 1);

    // The defect's exact reproduction: truncate the file below its header.
    fs.writeFileSync(path.join(dir, '.project-manager', 'LEDGER.md'), '');

    assert.equal(runCli(dir, ['alpha']).status, 0);
    const rebuilt = ledger(dir);
    assert.ok(rebuilt.includes('| Feature | Shipped |'), 'the header is restored');
    assert.equal(ledgerDataRows(rebuilt).length, 1, 'exactly one alpha row, not two');

    // And a third run is a no-op again, which is what the append-only key buys.
    assert.equal(runCli(dir, ['alpha']).status, 0);
    assert.equal(ledger(dir), rebuilt, 'byte-identical once the header is back');
  });

  it('a truncated ledger cannot accumulate duplicates across repeated runs', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    writeFeature(dir, 'alpha', { 'CONTEXT.md': DONE_CONTEXT });
    writeFeature(dir, 'beta', { 'CONTEXT.md': DONE_CONTEXT });

    // Truncated once — this is the state the defect never recovered from.
    fs.writeFileSync(path.join(dir, '.project-manager', 'LEDGER.md'), '# Ledger\n\n');
    for (let i = 0; i < 4; i++) {
      assert.equal(runCli(dir, ['alpha', 'beta']).status, 0);
    }

    const rows = ledgerDataRows(ledger(dir));
    assert.equal(rows.length, 2, `four runs left ${rows.length} rows, expected 2`);
    assert.deepEqual(
      rows.map(r => r.split('|')[1].trim()).sort(),
      ['alpha', 'beta']
    );
  });

  it('appendLedger still appends when a header is present', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    writeFeature(dir, 'alpha', { 'CONTEXT.md': DONE_CONTEXT });
    writeFeature(dir, 'beta', { 'CONTEXT.md': DONE_CONTEXT });

    const first = harvestFeature(dir, 'alpha', '2026-01-01');
    const second = harvestFeature(dir, 'beta', '2026-01-02');
    assert.equal(appendLedger(dir, [first], '2026-01-01'), 1);
    assert.equal(appendLedger(dir, [second], '2026-01-02'), 1);

    const rows = ledgerDataRows(ledger(dir));
    assert.equal(rows.length, 2);
    assert.ok(rows[0].startsWith('| alpha '), 'the first row survived the append');
    assert.ok(rows[1].startsWith('| beta '));
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — `IN PROGRESS — Stage 1 only` harvested as `unknown`
// ---------------------------------------------------------------------------

describe('finding 2 — the Stage-1 flush form harvests as in-progress', () => {
  const cases = [
    ['**Status:** IN PROGRESS — Stage 1 only', 'the form the verifier actually writes'],
    ['**Status:** IN PROGRESS', 'the bare form'],
    ['**Status:**   IN PROGRESS   — Stage 1 only  ', 'padded']
  ];

  for (const [line, label] of cases) {
    it(`recognises ${label}`, () => {
      const dir = tmpRepo();
      writeFeature(dir, 'flushed', {
        'CONTEXT.md': DONE_CONTEXT,
        'VERIFY.md': `# Verification Report\n\n${line}\n`
      });
      assert.equal(harvestFeature(dir, 'flushed', '2026-01-01').verify, 'in-progress');
    });
  }

  it('does not swallow an unrelated status line', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'other', {
      'CONTEXT.md': DONE_CONTEXT,
      'VERIFY.md': '# Verification Report\n\n**Status:** IN PROGRESSION OF WORK\n'
    });
    // `\b` stops at the word boundary, so `IN PROGRESSION` is not `IN PROGRESS`.
    assert.equal(harvestFeature(dir, 'other', '2026-01-01').verify, 'unknown');
  });

  it('an Overall Status line still wins over a flush marker', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'both', {
      'CONTEXT.md': DONE_CONTEXT,
      'VERIFY.md': '**Status:** IN PROGRESS — Stage 1 only\n**Overall Status:** PASS\n'
    });
    assert.equal(harvestFeature(dir, 'both', '2026-01-01').verify, 'PASS');
  });

  it('the verifier and both templates still write the form the harvest matches', () => {
    const root = path.join(__dirname, '..');
    const sources = [
      path.join(root, 'agents', 'ship-verifier.md'),
      path.join(root, 'ship', 'templates', 'VERIFY.md')
    ].filter(p => fs.existsSync(p));
    assert.ok(sources.length > 0, 'at least one source of the flush line exists');
    for (const file of sources) {
      const body = fs.readFileSync(file, 'utf8');
      if (!/IN PROGRESS/.test(body)) continue;
      for (const match of body.match(/^\*\*Status:\*\*.*IN PROGRESS.*$/gm) || []) {
        assert.match(
          match,
          /^\*\*Status:\*\*\s*IN PROGRESS\b/,
          `${path.basename(file)} writes a flush line the harvest cannot read: ${match}`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — `Unresolved carried` undercounted `new (round n)` findings
// ---------------------------------------------------------------------------

describe('finding 3 — Unresolved carried counts new (round n) findings too', () => {
  const REVIEW = [
    '# Review',
    '',
    '## Phase 1 — build (round 1)',
    '',
    '- [critical] a genuinely carried finding — unresolved',
    '- [high] introduced by the fix round — new (round 2)',
    '- [high] cleaned up — fixed in fix round',
    '- [medium] noise — unresolved',
    '- [low] noise — new (round 3)',
    'Verify: 2 re-run commands',
    ''
  ].join('\n');

  it('counts both markers, and only at critical/high', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'carried', { 'CONTEXT.md': DONE_CONTEXT, 'REVIEW.md': REVIEW });
    const record = harvestFeature(dir, 'carried', '2026-01-01');
    // critical unresolved + high new (round 2) = 2. The medium and low
    // markers are excluded, as is the fixed high.
    assert.equal(record.unresolvedCarried, 2);
    assert.deepEqual(record.findings, { critical: 1, high: 2, medium: 1, low: 1 });
  });

  it('a clean review still reports zero', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'clean', {
      'CONTEXT.md': DONE_CONTEXT,
      'REVIEW.md': '## Phase 1 — build (round 1)\n\n- [high] all good — fixed in fix round\nVerify: 1 re-run command\n'
    });
    assert.equal(harvestFeature(dir, 'clean', '2026-01-01').unresolvedCarried, 0);
  });

  it('the marker must terminate the line — a mention in prose does not count', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'prose', {
      'CONTEXT.md': DONE_CONTEXT,
      'REVIEW.md': '## Phase 1 — build (round 1)\n\n- [critical] was new (round 2) before — fixed in fix round\nVerify: 1 re-run command\n'
    });
    assert.equal(harvestFeature(dir, 'prose', '2026-01-01').unresolvedCarried, 0);
  });

  it('the go workflow still describes introducedByFix as a subset of unresolved', () => {
    // The cell's definition is only correct while this stays true.
    const body = fs.readFileSync(path.join(__dirname, '..', 'ship', 'workflows', 'go.workflow.js'), 'utf8');
    assert.match(body, /introducedByFix/, 'the workflow still labels fix-introduced findings');
  });
});

// ---------------------------------------------------------------------------
// Finding 4 — computeUnblocks threw on a non-string `Depends on`
// ---------------------------------------------------------------------------

describe('finding 4 — computeUnblocks never throws on a malformed row', () => {
  it('survives every non-string Depends on value a hand-built row can carry', () => {
    for (const bad of [123, true, {}, [], () => {}, Symbol('x'), 9n]) {
      const rows = [
        { cells: { Item: 'Alpha', 'Depends on': '—' }, recorded: 'pending' },
        { cells: { Item: 'Beta', 'Depends on': bad }, recorded: 'pending' }
      ];
      const out = computeUnblocks(rows);
      assert.equal(out.get('Alpha').count, 0, `a ${typeof bad} dependency credits nobody`);
      assert.equal(out.get('Beta').count, 0);
    }
  });

  it('an array whose join would look like a name is still not credited', () => {
    const rows = [
      { cells: { Item: 'Alpha', 'Depends on': '—' }, recorded: 'pending' },
      { cells: { Item: 'Beta', 'Depends on': ['Alpha'] }, recorded: 'pending' }
    ];
    // Coercion would have credited Alpha; the type guard means it does not.
    assert.equal(computeUnblocks(rows).get('Alpha').count, 0);
  });

  it('real string rows are unaffected', () => {
    const rows = [
      { cells: { Item: 'Alpha', 'Depends on': '—' }, recorded: 'pending' },
      { cells: { Item: 'Beta', 'Depends on': 'Alpha' }, recorded: 'in-progress' },
      { cells: { Item: 'Gamma', 'Depends on': 'Alpha' }, recorded: 'done' }
    ];
    assert.deepEqual(computeUnblocks(rows).get('Alpha'), { count: 1, inProgress: true });
  });
});

// ---------------------------------------------------------------------------
// Finding 5 — an unreadable artifact rendered identically to an absent one
// ---------------------------------------------------------------------------

describe('finding 5 — provenance distinguishes unreadable from absent', () => {
  const canChmod = process.getuid === undefined || process.getuid() !== 0;

  it('an absent artifact still reads as `no {filename}`', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'bare', { 'CONTEXT.md': DONE_CONTEXT });
    assert.deepEqual(harvestFeature(dir, 'bare', '2026-01-01').artifacts, [
      'CONTEXT.md',
      'no PLAN.md',
      'no REVIEW.md',
      'no VERIFY.md'
    ]);
  });

  it('an unreadable artifact reads as `unreadable {filename}`', { skip: !canChmod }, () => {
    const dir = tmpRepo();
    const featureDir = writeFeature(dir, 'locked', {
      'CONTEXT.md': DONE_CONTEXT,
      'VERIFY.md': '**Overall Status:** PASS\n**Head:** abc123\n'
    });
    const locked = path.join(featureDir, 'VERIFY.md');
    fs.chmodSync(locked, 0o000);
    try {
      const record = harvestFeature(dir, 'locked', '2026-01-01');
      assert.deepEqual(record.artifacts, [
        'CONTEXT.md',
        'no PLAN.md',
        'no REVIEW.md',
        'unreadable VERIFY.md'
      ]);
      // The verdict still degrades to `none` — the fix changes the provenance
      // token, not the claim about what was verified.
      assert.equal(record.verify, 'none');
    } finally {
      fs.chmodSync(locked, 0o644);
    }
  });

  it('the harvest is still silent and exit 0 with an unreadable artifact', { skip: !canChmod }, () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    const featureDir = writeFeature(dir, 'locked', { 'CONTEXT.md': DONE_CONTEXT });
    fs.writeFileSync(path.join(featureDir, 'REVIEW.md'), '## Phase 1 — build (round 1)\n');
    fs.chmodSync(path.join(featureDir, 'REVIEW.md'), 0o000);
    try {
      const out = runCli(dir, ['locked']);
      assert.equal(out.status, 0);
      assert.equal(out.stderr, '');
      assert.match(ledger(dir), /unreadable REVIEW\.md/);
    } finally {
      fs.chmodSync(path.join(featureDir, 'REVIEW.md'), 0o644);
    }
  });

  it('every provenance token is still one of the four documented shapes', () => {
    const dir = tmpRepo();
    writeFeature(dir, 'mixed', {
      'CONTEXT.md': '---\nstatus: done\n---\n',
      'PLAN.md': '# Plan\n',
      'REVIEW.md': '## Phase 1 — build (round 1)\n'
    });
    const record = harvestFeature(dir, 'mixed', '2026-01-01');
    assert.equal(record.artifacts.length, 4);
    for (const token of record.artifacts) {
      assert.match(
        token,
        /^(no |unreadable )?(CONTEXT|PLAN|REVIEW|VERIFY)\.md( \(no [a-z ]+\))?$/,
        `unexpected provenance token: ${token}`
      );
      assert.notEqual(token, '—');
    }
  });
});
