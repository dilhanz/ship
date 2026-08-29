// Adversarial coverage for the pm-blind-spots seams: the invariants that hold
// *across* the new functions rather than inside any one of them.
//
// Every case here is a round-trip or a degradation contract — "whatever this
// writes must still parse", "whatever this is handed must not throw, must not
// change the exit code, and must not invent a status". Those are the
// properties the feature's own premise rests on, and they are the ones a
// per-function test suite structurally cannot see.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PM = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const pm = require(PM);

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** Byte-snapshot every file in a directory tree, for "writes nothing" proofs. */
function snapshot(dir) {
  const seen = {};
  const walk = (d, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      const key = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(full, key);
      else seen[key] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '.');
  return seen;
}

const LEDGER_HEADER = pm.LEDGER_COLUMNS;

function ledgerBody(rows, headers) {
  const cols = headers || LEDGER_HEADER;
  return (
    '---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\nprovenance\n\n' +
    `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n` +
    `${rows.join('\n')}\n`
  );
}

describe('pm-blind-spots — every appended ledger row parses back', () => {
  // The ledger is the feature's own evidence surface. A harvested value that
  // breaks the table turns a recorded row into no row at all, which is the
  // exact "reported by the same code path as no record" failure the feature
  // exists to close — so the round trip is the property that matters, not the
  // rendering of any one cell.
  const hostile = [
    '**Overall Status:** PASS | a pipe in the qualifier',
    '**Overall Status:** FAIL\r\n\r\nwindows line endings\r\n',
    '**Overall Status:** DEFERRED — a note with | two | pipes',
    '**Status:** IN PROGRESS — Stage 1 only',
    '**Overall Status:** ' + 'x'.repeat(400),
    '**Overall Status:** 中文 — non-ascii verdict',
    '',
  ];

  it('survives a hostile VERIFY.md without losing the row', () => {
    const root = tempDir('pm-roundtrip-');
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    const records = hostile.map((body, i) => {
      const slug = `hostile-${i}`;
      writeFile(path.join(root, '.planning', 'archive', slug, 'VERIFY.md'), body);
      writeFile(
        path.join(root, '.planning', 'archive', slug, 'CONTEXT.md'),
        '---\nprofile: standard\noutcome: shipped\n---\n',
      );
      return pm.harvestFeature(root, slug, '2026-06-06');
    });

    assert.equal(pm.appendLedger(root, records, '2026-06-06'), records.length);

    const written = fs.readFileSync(path.join(root, '.project-manager', 'LEDGER.md'), 'utf8');
    const parsed = pm.ledgerRows(written);
    assert.equal(parsed.length, records.length, 'a hostile value dropped a row from the table');

    for (const row of parsed) {
      assert.equal(
        Object.keys(row.cells).length,
        LEDGER_HEADER.length,
        `row ${row.slug} does not have one cell per header`,
      );
      assert.ok(
        !/[\r\n]/.test(row.cells.Verify) && !/[\r\n]/.test(row.cells['Verify note'] || ''),
        `row ${row.slug} smuggled a line break into a cell`,
      );
    }

    const slugs = pm.ledgerSlugs(written);
    for (let i = 0; i < hostile.length; i++) {
      assert.ok(slugs.has(`hostile-${i}`), `hostile-${i} is not readable back by ledgerSlugs`);
    }
  });

  it('keeps the Verify cell inside the documented enum for every one of them', () => {
    const root = tempDir('pm-enum-');
    const allowed = new Set(['PASS', 'FAIL', 'INCONCLUSIVE', 'DEFERRED', 'in-progress', 'unknown', 'none']);
    hostile.forEach((body, i) => {
      const slug = `enum-${i}`;
      writeFile(path.join(root, '.planning', 'archive', slug, 'VERIFY.md'), body);
      const record = pm.harvestFeature(root, slug, '2026-06-06');
      assert.ok(allowed.has(record.verify), `${JSON.stringify(body.slice(0, 30))} produced ${record.verify}`);
    });
  });
});

describe('pm-blind-spots — re-harvest leaves the rest of the ledger alone', () => {
  it('rewrites only the unreadable rows in a mixed ledger', () => {
    const root = tempDir('pm-reharvest-');
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });

    // Two readable rows that must survive byte-for-byte, one unreadable row
    // that is the whole point of the relaxation.
    const rows = [
      '| kept-pass | 2026-01-01 | thorough | shipped | PASS | clean | 0 | 1 | 0 | 0/0/0/0 | 2 | a; b; c; d |',
      '| stale | 2026-01-02 | quick | shipped | unknown | none | 0 | 1 | 0 | 0/0/0/0 | 1 | a; b; c; d |',
      '| kept-fail | 2026-01-03 | standard | shipped | FAIL | 1 criterion | 1 | 2 | 1 | 0/1/0/0 | 3 | a; b; c; d |',
    ];
    const before = ledgerBody(rows);
    writeFile(path.join(root, '.project-manager', 'LEDGER.md'), before);

    for (const slug of ['kept-pass', 'stale', 'kept-fail']) {
      fs.mkdirSync(path.join(root, '.planning', 'archive', slug), { recursive: true });
    }
    // Only `stale` gains a readable verdict.
    writeFile(
      path.join(root, '.planning', 'archive', 'stale', 'VERIFY.md'),
      '**Verified:** 2026-01-02\n**Overall Status:** PASS\n',
    );

    pm.runHarvest(root, root, [], '2026-06-06');
    const after = fs.readFileSync(path.join(root, '.project-manager', 'LEDGER.md'), 'utf8').split('\n');

    assert.ok(after.includes(rows[0]), 'a recorded PASS row was rewritten');
    assert.ok(after.includes(rows[2]), 'a recorded FAIL row was rewritten');

    const staleLine = after.find((l) => l.startsWith('| stale '));
    assert.ok(staleLine, 'the stale row disappeared');
    assert.notEqual(staleLine, rows[1], 'the stale row was not re-harvested');
    assert.match(staleLine, /\| PASS \|/, 'the re-harvested verdict was not recorded');
  });

  it('never rewrites a row the archive no longer backs', () => {
    // A recorded `unknown` row whose feature directory has been deleted must
    // be left exactly as it is: `runHarvest` only re-admits slugs that are
    // still candidates, so an absent archive is not an invitation to
    // overwrite recorded history with a blank harvest.
    const root = tempDir('pm-reharvest-gone-');
    fs.mkdirSync(path.join(root, '.project-manager'), { recursive: true });
    fs.mkdirSync(path.join(root, '.planning', 'archive'), { recursive: true });

    const row = '| vanished | 2026-01-01 | quick | shipped | unknown |  | 0 | 1 | 0 | 0/0/0/0 | 1 | a; b; c; d |';
    const before = ledgerBody([row]);
    writeFile(path.join(root, '.project-manager', 'LEDGER.md'), before);

    pm.runHarvest(root, root, [], '2026-06-06');

    assert.equal(
      fs.readFileSync(path.join(root, '.project-manager', 'LEDGER.md'), 'utf8'),
      before,
      'a row with no archive behind it was rewritten',
    );
  });
});

describe('pm-blind-spots — the query modes write nothing under hostile state', () => {
  const hostileState = {
    'ROADMAP.md': '---\nupdated: "2026-01-01"\n---\n\n## Backlog\n\n| Item | Priority |\n|---|---|\n| ragged row | P0 | extra |\n',
    'STATUS.md': '---\nnot: yaml: really\n---\n\nnarrative\n\n## In flight\n',
    'LEDGER.md': '| not | a | ledger |\n|---|---|---|\n| at | all | here |\n',
    'DECISIONS.md': '# Decisions\n',
  };

  for (const mode of ['--debt', '--lint', '--next', '--evidence']) {
    it(`${mode} exits 0 and mutates nothing`, () => {
      const root = tempDir('pm-query-');
      for (const [name, body] of Object.entries(hostileState)) {
        writeFile(path.join(root, '.project-manager', name), body);
      }
      const before = snapshot(root);
      const run = spawnSync(process.execPath, [PM, mode], { cwd: root, encoding: 'utf8' });

      assert.equal(run.status, 0, `${mode} exited ${run.status}: ${run.stderr}`);
      assert.equal(run.stderr.trim(), '', `${mode} wrote to stderr`);
      assert.doesNotThrow(() => JSON.parse(run.stdout), `${mode} did not print JSON: ${run.stdout}`);
      assert.deepEqual(snapshot(root), before, `${mode} changed the state directory`);
    });
  }

  it('--debt and --lint together still write nothing', () => {
    const root = tempDir('pm-query-both-');
    for (const [name, body] of Object.entries(hostileState)) {
      writeFile(path.join(root, '.project-manager', name), body);
    }
    // A slug argument is the write-triggering form on the normal path.
    fs.mkdirSync(path.join(root, '.planning', 'archive', 'some-feature'), { recursive: true });
    const before = snapshot(root);
    const run = spawnSync(process.execPath, [PM, '--debt', '--lint', 'some-feature'], { cwd: root, encoding: 'utf8' });

    assert.equal(run.status, 0);
    assert.deepEqual(snapshot(root), before, 'a combined query mode wrote to disk');
  });
});

describe('pm-blind-spots — archiveMergeStatus degrades rather than escaping', () => {
  it('never throws for a hostile slug, and mappedStatus refuses it outright', () => {
    const root = tempDir('pm-slug-');
    fs.mkdirSync(path.join(root, '.planning', 'archive'), { recursive: true });

    for (const slug of ['../../elsewhere', '', '.', '..', 'a/b', 'a\0b', 'x'.repeat(300)]) {
      let result;
      assert.doesNotThrow(() => {
        result = pm.archiveMergeStatus(root, slug);
      }, `archiveMergeStatus threw for ${JSON.stringify(slug)}`);
      assert.ok(
        ['done', 'awaiting-merge', 'inconclusive', 'no-stamp'].includes(result),
        `archiveMergeStatus returned ${result} for ${JSON.stringify(slug)}`,
      );
      assert.equal(
        pm.mappedStatus(root, slug, 'todo'),
        null,
        `mappedStatus did not refuse the slug ${JSON.stringify(slug)}`,
      );
    }
  });

  it('returns inconclusive — never a status — when git cannot answer', { skip: !gitAvailable }, () => {
    // No repository at all: there is no base ref, so the only honest answer is
    // "I do not know", and mappedStatus must translate that to "unchanged".
    const root = tempDir('pm-nogit-');
    writeFile(
      path.join(root, '.planning', 'archive', 'stamped', 'VERIFY.md'),
      '**Head:** 0123456789abcdef0123456789abcdef01234567\n',
    );
    assert.equal(pm.resolveBaseRef(root), null);
    assert.equal(pm.archiveMergeStatus(root, 'stamped'), 'inconclusive');
    assert.equal(pm.mappedStatus(root, 'stamped', 'todo'), null);
  });
});

describe('pm-blind-spots — a legacy five-column roadmap is never widened', () => {
  it('reconciles in place with no new columns and byte-identical padding elsewhere', () => {
    const root = tempDir('pm-legacy-');
    fs.mkdirSync(path.join(root, '.planning', 'archive', 'arch-slug'), { recursive: true });
    writeFile(
      path.join(root, '.planning', 'features', 'live-slug', 'CONTEXT.md'),
      '---\nstatus: building\n---\n',
    );

    const legacy =
      '---\nupdated: "2026-01-01"\n---\n\n# P — Roadmap\n\n## Backlog\n\n' +
      '| Item | Priority | Status | Ship feature | Source |\n|---|---|---|---|---|\n' +
      '| One   | P0 | todo        | arch-slug | s1 |\n' +
      '| Two   | P1 | in-progress | live-slug | s2 |\n' +
      '| Three | P2 | blocked     | live-slug | s3 |\n';

    const reconciled = pm.applyStatusUpdates(legacy, root, []);
    assert.ok(reconciled.changed);

    const body = reconciled.content;
    assert.ok(body.includes('| Item | Priority | Status | Ship feature | Source |'), 'the header changed');
    assert.ok(!/\bKind\b/.test(body), 'a Kind column was invented');
    assert.ok(!/\bLane\b/.test(body), 'a Lane column was invented');
    assert.ok(!/First seen/.test(body), 'a First seen column was invented');

    assert.match(body, /\| One {3}\| P0 \| done \| arch-slug \| s1 \|/);
    // A blocked row is a PM judgment and keeps its original padding untouched.
    assert.ok(body.includes('| Three | P2 | blocked     | live-slug | s3 |'), 'the blocked row was edited');

    // The derived-column passes are no-ops against a table that lacks them.
    assert.equal(pm.stampFirstSeen(body, '2026-06-06').changed, false);
    assert.equal(pm.applyLaneColumn(body, new Map([['arch-slug', 'main @ /repo']])).changed, false);
  });
});
