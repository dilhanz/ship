// Header-aware ledger rendering and the archive `outcome:` harvest.
//
// LEDGER_COLUMNS gains `Outcome` and `Verify note` here, which is only safe
// because rows are rendered against the *file's own* header from this commit
// on: a ledger already carrying the ten-column shape keeps receiving
// ten-column rows, and only a rebuilt or brand-new file gets the widened one.
// Widening the column list without that would silently shift every value one
// column to the right in ~100 recorded rows.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const {
  LEDGER_COLUMNS,
  ledgerHeaders,
  renderLedgerRow,
  appendLedger,
  harvestFeature
} = require(SCRIPT_PATH);

const NARROW_HEADER =
  '| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';
const WIDE_HEADER =
  '| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';

function tmpRoot(prefix = 'ship-ledger-header-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ledgerPath(root) {
  return path.join(root, '.project-manager', 'LEDGER.md');
}

function seedLedger(root, body) {
  fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
  fs.writeFileSync(ledgerPath(root), body);
}

function readLedger(root) {
  return fs.readFileSync(ledgerPath(root), 'utf8');
}

/** A complete harvest record, every field distinguishable from every other. */
function record(overrides = {}) {
  return {
    slug: 'thing',
    shipped: '2026-01-02',
    profile: 'quick',
    outcome: 'shipped',
    verify: 'PASS',
    verifyNote: 'all 4 criteria proven',
    unresolvedCarried: 1,
    planRounds: 2,
    fixRounds: 3,
    findings: { critical: 0, high: 1, medium: 2, low: 3 },
    phases: 4,
    artifacts: ['CONTEXT.md', 'PLAN.md', 'REVIEW.md', 'VERIFY.md'],
    ...overrides
  };
}

/** The cells of the last table row of a ledger body. */
function lastRowCells(content) {
  const lines = content.trim().split('\n').filter((l) => l.trim().startsWith('|'));
  return lines[lines.length - 1].trim().slice(1, -1).split('|').map((c) => c.trim());
}

/** Header-keyed cells of the ledger's last row. */
function lastRow(content) {
  const headers = ledgerHeaders(content);
  const cells = lastRowCells(content);
  const named = {};
  headers.forEach((h, i) => {
    named[h] = cells[i];
  });
  return { headers, cells, named };
}

function seededNarrow(root) {
  seedLedger(
    root,
    '---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\n' +
      `${NARROW_HEADER}\n|---|---|---|---|---|---|---|---|---|---|\n` +
      '| earlier | 2025-12-01 | standard | PASS | 0 | 1 | 0 | 0/0/0/0 | 1 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |\n'
  );
}

describe('LEDGER_COLUMNS — the widened shape', () => {
  it('carries Outcome after Profile and Verify note after Verify', () => {
    assert.deepEqual(LEDGER_COLUMNS, [
      'Feature',
      'Shipped',
      'Profile',
      'Outcome',
      'Verify',
      'Verify note',
      'Unresolved carried',
      'Plan rounds',
      'Fix rounds',
      'Findings (C/H/M/L)',
      'Phases',
      'Artifacts'
    ]);
  });
});

describe('ledgerHeaders', () => {
  it('returns the cells of the anchoring header row', () => {
    assert.deepEqual(ledgerHeaders(`# L\n\n${NARROW_HEADER}\n`), [
      'Feature',
      'Shipped',
      'Profile',
      'Verify',
      'Unresolved carried',
      'Plan rounds',
      'Fix rounds',
      'Findings (C/H/M/L)',
      'Phases',
      'Artifacts'
    ]);
  });

  it('returns [] for a body with no ledger header, and for junk input', () => {
    assert.deepEqual(ledgerHeaders('# Ledger\n\nno table here\n'), []);
    assert.deepEqual(ledgerHeaders('| a | b |\n| --- | --- |\n| 1 | 2 |\n'), []);
    assert.deepEqual(ledgerHeaders(null), []);
    assert.deepEqual(ledgerHeaders(undefined), []);
  });
});

describe('renderLedgerRow — rendered to a supplied header', () => {
  it('defaults to the widened LEDGER_COLUMNS with no headers argument', () => {
    const cells = renderLedgerRow(record()).trim().slice(1, -1).split('|').map((c) => c.trim());
    assert.equal(cells.length, 12);
    assert.deepEqual(cells, [
      'thing',
      '2026-01-02',
      'quick',
      'shipped',
      'PASS',
      'all 4 criteria proven',
      '1',
      '2',
      '3',
      '0/1/2/3',
      '4',
      'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md'
    ]);
  });

  it('renders an unknown column as `unknown` without shifting the others', () => {
    const headers = ['Feature', 'Nonsense', 'Verify'];
    const cells = renderLedgerRow(record(), headers).trim().slice(1, -1).split('|').map((c) => c.trim());
    assert.deepEqual(cells, ['thing', 'unknown', 'PASS']);
  });
});

describe('appendLedger — the append path renders to the file\'s own header', () => {
  it('keeps a ten-column ledger at ten columns with no new-column leakage', () => {
    const root = tmpRoot();
    seededNarrow(root);

    assert.equal(appendLedger(root, [record()], '2026-02-02'), 1);

    const content = readLedger(root);
    assert.ok(content.includes(NARROW_HEADER), 'the recorded header is untouched');
    assert.ok(!content.includes(WIDE_HEADER), 'no widened header is written into a recorded file');

    const { cells, named } = lastRow(content);
    assert.equal(cells.length, 10, 'the appended row matches the file\'s own width');
    assert.equal(named.Feature, 'thing');
    assert.equal(named.Verify, 'PASS');
    assert.equal(named.Profile, 'quick');
    assert.equal(named['Findings (C/H/M/L)'], '0/1/2/3');
    assert.equal(named.Artifacts, 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md');
    assert.ok(!content.includes('all 4 criteria proven'), 'the note has nowhere to go and is dropped');
    assert.match(content, /^updated: "2026-02-02"$/m, 'the append bumps updated:');
  });

  it('places each value under its own header when the columns are reordered', () => {
    const root = tmpRoot();
    seedLedger(
      root,
      '---\nupdated: "2026-01-01"\n---\n\n' +
        '| Verify | Feature | Shipped | Profile |\n|---|---|---|---|\n'
    );

    assert.equal(appendLedger(root, [record()], '2026-02-02'), 1);

    const { cells, named } = lastRow(readLedger(root));
    assert.deepEqual(cells, ['PASS', 'thing', '2026-01-02', 'quick']);
    assert.equal(named.Feature, 'thing');
  });

  it('renders `unknown` under a column it does not know and keeps every other cell correct', () => {
    const root = tmpRoot();
    seedLedger(
      root,
      '---\nupdated: "2026-01-01"\n---\n\n' +
        '| Feature | Shipped | Live | Verify |\n|---|---|---|---|\n'
    );

    assert.equal(appendLedger(root, [record()], '2026-02-02'), 1);

    const { cells, named } = lastRow(readLedger(root));
    assert.equal(cells.length, 4, 'an unknown column never shifts the others');
    assert.equal(named.Live, 'unknown', 'never a blank cell mistakable for an authored dash');
    assert.equal(named.Feature, 'thing');
    assert.equal(named.Verify, 'PASS');
  });

  it('gives a brand-new ledger the full widened header', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    assert.equal(appendLedger(root, [record()], '2026-02-02'), 1);

    const content = readLedger(root);
    assert.ok(content.includes(WIDE_HEADER), 'a rebuilt ledger gets the widened shape');
    const { cells, named } = lastRow(content);
    assert.equal(cells.length, 12);
    assert.equal(named.Outcome, 'shipped');
    assert.equal(named['Verify note'], 'all 4 criteria proven');
  });

  it('rebuilds a headerless body to the widened shape', () => {
    const root = tmpRoot();
    seedLedger(root, '---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\nsomething went wrong here\n');

    assert.equal(appendLedger(root, [record()], '2026-02-02'), 1);

    const content = readLedger(root);
    assert.ok(content.includes(WIDE_HEADER));
    assert.equal(lastRow(content).cells.length, 12);
  });

  it('sanitizes a pipe in the Verify note rather than inventing a column', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    appendLedger(root, [record({ verifyNote: 'criterion 3 | criterion 4 unproven' })], '2026-02-02');

    const { cells, named } = lastRow(readLedger(root));
    assert.equal(cells.length, 12, 'a `|` in a note must not invent a column');
    assert.equal(named['Verify note'], 'criterion 3 / criterion 4 unproven');
  });

  // The two absent cases are deliberately NOT the same word. A verdict with no
  // qualifier has nothing to say (`none`); an archive with no outcome stamp is
  // a genuine gap (`unknown`). Collapsing them would reintroduce the exact
  // "clean run vs. no record" ambiguity this ledger is built to avoid.
  it('renders an absent note as `none` and an absent outcome as `unknown`', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    appendLedger(root, [record({ verifyNote: '', outcome: 'unknown' })], '2026-02-02');

    const { named } = lastRow(readLedger(root));
    assert.equal(named['Verify note'], 'none');
    assert.equal(named.Outcome, 'unknown');
  });

  it('keeps a real note that happens to read `unknown` distinguishable from an absent one', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    appendLedger(root, [record({ verifyNote: 'unknown' })], '2026-02-02');

    const { named } = lastRow(readLedger(root));
    assert.equal(named['Verify note'], 'unknown');
  });
});

describe('harvestFeature — the archive outcome stamp', () => {
  function archive(root, slug, contextBody) {
    const dir = path.join(root, '.planning', 'archive', slug);
    fs.mkdirSync(dir, { recursive: true });
    if (contextBody !== null) fs.writeFileSync(path.join(dir, 'CONTEXT.md'), contextBody);
    fs.writeFileSync(path.join(dir, 'VERIFY.md'), '**Overall Status:** PASS\n');
    return dir;
  }

  it('reads a stamped outcome from the frontmatter block', () => {
    const root = tmpRoot();
    archive(root, 'gone', '---\nstatus: done\nprofile: quick\noutcome: abandoned\n---\n');

    const r = harvestFeature(root, 'gone', '2026-02-02');
    assert.equal(r.outcome, 'abandoned');
    assert.equal(r.profile, 'quick');
    assert.equal(r.artifacts[0], 'CONTEXT.md', 'the outcome is a separate axis from the profile token');
  });

  it('accepts the whole documented vocabulary, case-insensitively', () => {
    const root = tmpRoot();
    for (const value of ['shipped', 'abandoned', 'superseded', 'umbrella']) {
      archive(root, `f-${value}`, `---\nstatus: done\noutcome: ${value.toUpperCase()}\n---\n`);
      assert.equal(harvestFeature(root, `f-${value}`, '2026-02-02').outcome, value);
    }
  });

  it('records unknown for an unstamped archive and still writes a row', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
    archive(root, 'unstamped', '---\nstatus: done\nprofile: standard\n---\n');

    const r = harvestFeature(root, 'unstamped', '2026-02-02');
    assert.equal(r.outcome, 'unknown');
    assert.equal(r.profile, 'standard', 'the profile token is unaffected by the missing outcome');
    assert.equal(r.artifacts[0], 'CONTEXT.md', 'an unstamped archive is expected, not a defect');

    assert.equal(appendLedger(root, [r], '2026-02-02'), 1);
    assert.equal(lastRow(readLedger(root)).named.Outcome, 'unknown');
  });

  it('records unknown for a junk value and for a body-only outcome line', () => {
    const root = tmpRoot();
    archive(root, 'junk', '---\nstatus: done\noutcome: mostly-fine\n---\n');
    assert.equal(harvestFeature(root, 'junk', '2026-02-02').outcome, 'unknown');

    archive(root, 'prose', '---\nstatus: done\n---\n\n## Notes\n\noutcome: shipped\n');
    assert.equal(harvestFeature(root, 'prose', '2026-02-02').outcome, 'unknown');
  });

  it('records unknown when CONTEXT.md is absent entirely', () => {
    const root = tmpRoot();
    archive(root, 'bare', null);
    const r = harvestFeature(root, 'bare', '2026-02-02');
    assert.equal(r.outcome, 'unknown');
    assert.equal(r.artifacts[0], 'no CONTEXT.md');
  });
});
