// Adversarial coverage for the PM evidence layer — the properties that hold
// only because a specific defence exists, so a future "simplification" that
// removes the defence goes red here rather than silently in a user's ledger.
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
  parseRoadmap,
  computeUnblocks,
  derivePriority,
  stampFirstSeen,
  harvestFeature,
  renderLedgerRow
} = require('../ship/pm-update.cjs');

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-evidence-adv-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePmDir(dir, roadmap) {
  fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
  if (roadmap !== undefined) {
    fs.writeFileSync(path.join(dir, '.project-manager', 'ROADMAP.md'), roadmap);
  }
}

function writeFeature(dir, slug, files, area = 'archive') {
  const featureDir = path.join(dir, '.planning', area, slug);
  fs.mkdirSync(featureDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(featureDir, name), body);
  }
  return featureDir;
}

/** Split one markdown table row into its cells. */
function cellsOf(line) {
  return line.trim().slice(1, -1).split('|').map(c => c.trim());
}

function ledgerRow(dir, slug) {
  const content = fs.readFileSync(path.join(dir, '.project-manager', 'LEDGER.md'), 'utf8');
  return content.split('\n').find(l => l.startsWith(`| ${slug} `)) || null;
}

describe('ledger harvest — a hostile artifact cannot break the table', () => {
  it('sanitizes pipes and newlines out of every harvested cell', () => {
    const dir = tmpRepo();
    writePmDir(dir);
    writeFeature(dir, 'evil', {
      'CONTEXT.md': '---\nstatus: done\nprofile: quick | injected | cells | here\n---\n',
      'VERIFY.md': '**Overall Status:** PASS | totally | fine\n**Verified:** 2026-01-01 | 9999-99-99\n**Head:** abc\n'
    });

    const run = runCli(dir);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');

    const row = ledgerRow(dir, 'evil');
    assert.ok(row, 'a row must be written for the hostile feature');

    const cells = cellsOf(row);
    assert.equal(cells.length, 10, 'a `|` in an artifact must not invent a column');
    assert.equal(cells[1], '2026-01-01 / 9999-99-99');
    assert.equal(cells[2], 'quick / injected / cells / here');
    assert.equal(cells[3], 'PASS / TOTALLY / FINE');
    assert.ok(!row.includes('\n'), 'a row is always one line');
  });

  it('renders a fully empty record as `unknown` cells rather than blanks', () => {
    // A blank cell would be indistinguishable from an authored `—`; the
    // sanitizer's empty→unknown substitution is what prevents that.
    const cells = cellsOf(renderLedgerRow(undefined));
    assert.equal(cells.length, 10);
    assert.equal(cells.filter(c => c === '').length, 0);
  });

  it('refuses a slug that is not a single path segment', () => {
    const dir = tmpRepo();
    writePmDir(dir);
    fs.mkdirSync(path.join(dir, '.planning', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'CONTEXT.md'), '---\nprofile: leaked\n---\n');

    for (const slug of ['../etc', '..', 'a/b', '/absolute', '']) {
      assert.equal(harvestFeature(dir, slug, '2026-01-01'), null, `slug ${JSON.stringify(slug)}`);
    }
  });
});

describe('ledger harvest — the append-only performance contract', () => {
  it('does not re-read a recorded feature\'s artifacts on a later run', () => {
    const dir = tmpRepo();
    writePmDir(dir);
    writeFeature(dir, 'settled', {
      'CONTEXT.md': '---\nstatus: done\nprofile: standard\n---\n',
      'VERIFY.md': '**Overall Status:** PASS\n**Verified:** 2026-05-05\n**Head:** deadbeef\n'
    });

    assert.equal(runCli(dir).status, 0);
    const first = ledgerRow(dir, 'settled');
    assert.ok(first.includes('| PASS |'));

    // Rewriting the artifact with a different verdict must change nothing:
    // a recorded slug is dropped before any artifact is read.
    fs.writeFileSync(
      path.join(dir, '.planning', 'archive', 'settled', 'VERIFY.md'),
      '**Overall Status:** FAIL\n**Verified:** 2099-01-01\n'
    );
    assert.equal(runCli(dir).status, 0);
    assert.equal(ledgerRow(dir, 'settled'), first, 'a recorded row is never re-rendered');
  });

  it('keeps harvesting when ROADMAP.md is present but unparseable', () => {
    const dir = tmpRepo();
    writePmDir(dir, 'not a roadmap at all\n||| garbage |||\n');
    writeFeature(dir, 'orphan', { 'CONTEXT.md': '---\nstatus: done\n---\n' });

    const run = runCli(dir);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');
    assert.ok(ledgerRow(dir, 'orphan'), 'a damaged roadmap must not disable the ledger');
  });
});

describe('--evidence writes nothing at all', () => {
  it('creates no dashboard, no ledger, and leaves ROADMAP.md byte-identical', () => {
    const dir = tmpRepo();
    const roadmap =
      '---\nproject: "T"\nupdated: "2026-01-01"\n---\n\n### M1 — m (status: active)\n\n' +
      '| Item | Status | Priority | Depends on | Ship feature | Blast radius | Confidence | First seen |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      '| A | pending | P2 | — | — | users | proven | — |\n' +
      '| B | in-progress | P3 | A | — | — | — | — |\n';
    writePmDir(dir, roadmap);
    // An archived feature the non-query path would definitely harvest.
    writeFeature(dir, 'would-be-harvested', { 'CONTEXT.md': '---\nstatus: done\n---\n' });

    const run = runCli(dir, ['--evidence']);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');

    const entries = JSON.parse(run.stdout);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].derived, 'P0');
    assert.equal(typeof entries[0].unblocks, 'number');

    assert.equal(
      fs.readFileSync(path.join(dir, '.project-manager', 'ROADMAP.md'), 'utf8'),
      roadmap,
      '--evidence must not stamp First seen'
    );
    assert.equal(fs.existsSync(path.join(dir, '.project-manager', 'LEDGER.md')), false);
    assert.equal(fs.existsSync(path.join(dir, '.project-manager', 'dashboard.html')), false);
  });

  it('prints [] rather than crashing on a roadmap with no backlog table', () => {
    const dir = tmpRepo();
    writePmDir(dir, '---\nproject: "T"\nupdated: "2026-01-01"\n---\n\nProse only.\n');
    const run = runCli(dir, ['--evidence']);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');
    assert.deepEqual(JSON.parse(run.stdout), []);
  });
});

describe('stampFirstSeen — the splice cannot corrupt a row', () => {
  it('preserves CRLF terminators', () => {
    const crlf = [
      '| Item | Status | Priority | First seen | Ship feature |',
      '| --- | --- | --- | --- | --- |',
      '| A | pending | P2 | — | — |',
      ''
    ].join('\r\n');

    const result = stampFirstSeen(crlf, '2026-08-25');
    assert.equal(result.changed, true);
    assert.ok(result.content.includes('| 2026-08-25 |'));
    assert.equal(
      (result.content.match(/\r\n/g) || []).length,
      (crlf.match(/\r\n/g) || []).length,
      'no CRLF terminator may be lost or gained'
    );
  });

  it('stamps a First seen column that is not the last column', () => {
    const table =
      '| Item | First seen | Status | Priority | Ship feature |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| A | — | pending | P2 | — |\n';

    const result = stampFirstSeen(table, '2026-08-25');
    assert.equal(result.changed, true);

    const reparsed = parseRoadmap(result.content);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].cells['First seen'], '2026-08-25');
    assert.equal(reparsed[0].cells.Status, 'pending', 'the splice must not shift neighbouring cells');
    assert.equal(reparsed[0].cells.Priority, 'P2');
  });

  it('never restamps a row that already carries a date, whatever today is', () => {
    const table =
      '| Item | Status | Priority | Ship feature | First seen |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| A | pending | P2 | — | 2020-01-01 |\n';

    for (const date of ['1999-01-01', '2026-08-25', '2099-12-31']) {
      const result = stampFirstSeen(table, date);
      assert.equal(result.changed, false, `today=${date}`);
      assert.equal(result.content, table);
    }
  });
});

describe('derivePriority — malformed rows degrade, never throw', () => {
  it('returns a well-formed proposal for every shape parseRoadmap can produce', () => {
    // Cells parseRoadmap yields are always strings, but the values are authored,
    // so every junk string must land on `unknown` rather than a bogus promotion.
    const junk = ['', '—', '-', 'USERS', 'Proven', 'nonsense', 'p0', '   '];
    for (const blast of junk) {
      for (const confidence of junk) {
        const table =
          '| Item | Status | Priority | Depends on | Ship feature | Blast radius | Confidence |\n' +
          '| --- | --- | --- | --- | --- | --- | --- |\n' +
          `| A | pending | P2 | — | — | ${blast || ' '} | ${confidence || ' '} |\n`;
        const rows = parseRoadmap(table);
        assert.equal(rows.length, 1, `blast=${blast} confidence=${confidence}`);
        const result = derivePriority(rows[0], computeUnblocks(rows).get('A'));
        assert.match(result.derived, /^P[0-3]$/);
        assert.ok(['users', 'contributors', 'internal', 'unknown'].includes(result.blastRadius));
        assert.ok(['proven', 'suspected', 'unknown'].includes(result.confidence));
        assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0);
      }
    }
  });

  it('tolerates a missing row and a missing unblocks entry', () => {
    for (const bad of [undefined, null, {}, { cells: null }, { cells: {} }]) {
      const result = derivePriority(bad, undefined);
      assert.equal(result.recorded, null);
      assert.equal(result.derived, 'P3');
      assert.equal(result.needsEvidence, true);
    }
  });
});
