// In-place re-harvest — the one relaxation of the ledger's append-only rule.
//
// Append-only exists to protect *history*, not a parse failure: a row whose
// Verify cell reads `unknown` or `in-progress` records that the harvest could
// not read a verdict, and being unable to revisit it means the ledger keeps a
// wrong answer forever. Exactly those two values are re-admitted; every other
// recorded row is still never re-read, which is the optimisation that keeps a
// ~100-row ledger from re-parsing the whole archive on every status
// transition. These tests assert both halves — the rewrite and the
// untouchability of everything around it — byte for byte.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { ledgerRows, reharvestLedger, harvestFeature, runHarvest } = require(SCRIPT_PATH);

const WIDE_HEADER =
  '| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';
const WIDE_SEPARATOR = '|---|---|---|---|---|---|---|---|---|---|---|---|';
const NARROW_HEADER =
  '| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';
const NARROW_SEPARATOR = '|---|---|---|---|---|---|---|---|---|---|';

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-reharvest-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ledgerPath(dir) {
  return path.join(dir, '.project-manager', 'LEDGER.md');
}

function readLedger(dir) {
  return fs.readFileSync(ledgerPath(dir), 'utf8');
}

function writeRoadmap(dir) {
  fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.project-manager', 'ROADMAP.md'),
    '---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### M1 — Test (status: active)\n\n' +
      '| Item | Status | Priority | Depends on | Ship feature |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| Thing | pending | P2 | — | — |\n'
  );
}

/** Stage an archived feature carrying the given artifacts. */
function archive(dir, slug, files) {
  const featureDir = path.join(dir, '.planning', 'archive', slug);
  fs.mkdirSync(featureDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(featureDir, name), body);
  }
  return featureDir;
}

/** A ledger body carrying the given pre-rendered rows under the wide header. */
function seedLedger(dir, rows, { header = WIDE_HEADER, separator = WIDE_SEPARATOR } = {}) {
  fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
  const content =
    '---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\n' +
    'Mechanically harvested by `ship/pm-update.cjs` when a feature reaches `done` — one row per feature, keyed on slug.\n' +
    'Append-only apart from one case: a row whose `Verify` cell reads `unknown` or `in-progress` may be re-harvested in place. Every other recorded row is never rewritten, and this file is never hand-edited.\n\n' +
    `${header}\n${separator}\n${rows.join('\n')}\n`;
  fs.writeFileSync(ledgerPath(dir), content);
  return content;
}

function wideRow(slug, verify, note = 'unknown') {
  return `| ${slug} | 2026-01-01 | standard | unknown | ${verify} | ${note} | 0 | 1 | 0 | 0/0/0/0 | 1 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |`;
}

function rowFor(dir, slug) {
  return readLedger(dir)
    .split('\n')
    .find((l) => l.startsWith(`| ${slug} `)) || null;
}

function cellsByName(dir, slug) {
  const rows = ledgerRows(readLedger(dir));
  const row = rows.find((r) => r.slug === slug);
  return row ? row.cells : null;
}

describe('ledgerRows', () => {
  it('returns header-keyed rows with their slug and line index', () => {
    const dir = tmpRepo();
    const content = seedLedger(dir, [wideRow('alpha', 'unknown'), wideRow('beta', 'PASS')]);
    const rows = ledgerRows(content);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.slug), ['alpha', 'beta']);
    assert.equal(rows[0].cells.Verify, 'unknown');
    assert.equal(rows[1].cells.Verify, 'PASS');
    assert.deepEqual(rows[0].headers, ledgerRows(content)[1].headers);
    assert.equal(content.split('\n')[rows[1].lineIndex], wideRow('beta', 'PASS'));
  });

  it('drops separator rows and rows whose cell count differs from the header', () => {
    const content = seedLedger(tmpRepo(), [wideRow('alpha', 'unknown'), '| short | row |']);
    const rows = ledgerRows(content);
    assert.deepEqual(rows.map((r) => r.slug), ['alpha']);
  });

  it('returns [] for unparseable input and never throws', () => {
    assert.deepEqual(ledgerRows('no table at all'), []);
    assert.deepEqual(ledgerRows(''), []);
    assert.deepEqual(ledgerRows(null), []);
    assert.deepEqual(ledgerRows(undefined), []);
  });
});

describe('reharvestLedger', () => {
  it('rewrites one row in place and leaves every other byte identical', () => {
    const dir = tmpRepo();
    const before = seedLedger(dir, [
      wideRow('alpha', 'PASS', 'all criteria proven'),
      wideRow('beta', 'unknown'),
      wideRow('gamma', 'FAIL', 'criterion 2')
    ]);
    archive(dir, 'beta', {
      'CONTEXT.md': '---\nstatus: done\nprofile: quick\n---\n',
      'VERIFY.md': '**Overall Status:** PASS — all 3 criteria proven\n**Verified:** 2026-02-02\n**Head:** abc1234\n'
    });

    const record = harvestFeature(dir, 'beta', '2026-02-02');
    assert.equal(reharvestLedger(dir, [record], '2026-02-02'), 1);

    const after = readLedger(dir);
    assert.equal(cellsByName(dir, 'beta').Verify, 'PASS');
    assert.equal(cellsByName(dir, 'beta')['Verify note'], 'all 3 criteria proven');

    // Everything but the rewritten line and the frontmatter bump survives.
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    assert.equal(beforeLines.length, afterLines.length, 'no line added or removed');
    for (let i = 0; i < beforeLines.length; i++) {
      if (beforeLines[i].startsWith('| beta ') || beforeLines[i].startsWith('updated:')) continue;
      assert.equal(afterLines[i], beforeLines[i], `line ${i} untouched`);
    }
    assert.match(after, /^updated: "2026-02-02"$/m, 'a real rewrite bumps updated:');
  });

  it('writes nothing at all when the re-read reproduces the recorded row', () => {
    const dir = tmpRepo();
    seedLedger(dir, [wideRow('beta', 'unknown')]);
    archive(dir, 'beta', { 'CONTEXT.md': '---\nstatus: done\n---\n', 'VERIFY.md': '# no verdict here\n' });

    const record = harvestFeature(dir, 'beta', '2026-02-02');
    assert.equal(record.verify, 'unknown', 'the re-read still finds no verdict');

    // First pass settles the row; the second reproduces it exactly, which is
    // the idempotence that keeps a permanently unreadable verdict from
    // churning the file on every run.
    reharvestLedger(dir, [record], '2026-02-02');
    const settled = readLedger(dir);
    const mtimeBefore = fs.statSync(ledgerPath(dir)).mtimeMs;

    assert.equal(reharvestLedger(dir, [record], '2026-02-03'), 0);

    assert.equal(readLedger(dir), settled, 'byte-identical, including updated:');
    assert.equal(fs.statSync(ledgerPath(dir)).mtimeMs, mtimeBefore, 'no mtime churn');
  });

  it('renders to a narrow header that carries no Verify note column', () => {
    const dir = tmpRepo();
    seedLedger(
      dir,
      ['| beta | 2026-01-01 | standard | unknown | 0 | 1 | 0 | 0/0/0/0 | 1 | CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md |'],
      { header: NARROW_HEADER, separator: NARROW_SEPARATOR }
    );
    archive(dir, 'beta', {
      'CONTEXT.md': '---\nstatus: done\nprofile: quick\n---\n',
      'VERIFY.md': '**Overall Status:** PASS — worth keeping\n'
    });

    assert.equal(reharvestLedger(dir, [harvestFeature(dir, 'beta', '2026-02-02')], '2026-02-02'), 1);

    const content = readLedger(dir);
    assert.ok(content.includes(NARROW_HEADER), 'the recorded header is never widened');
    assert.equal(rowFor(dir, 'beta').trim().slice(1, -1).split('|').length, 10);
    assert.equal(cellsByName(dir, 'beta').Verify, 'PASS');
    assert.ok(!content.includes('worth keeping'), 'the note has nowhere to go in a narrow file');
  });

  it('is a silent no-op for an absent ledger, an unknown slug, and junk input', () => {
    const dir = tmpRepo();
    assert.equal(reharvestLedger(dir, [{ slug: 'nope' }], '2026-02-02'), 0);

    seedLedger(dir, [wideRow('beta', 'unknown')]);
    const before = readLedger(dir);
    assert.equal(reharvestLedger(dir, [{ slug: 'absent-slug', verify: 'PASS' }], '2026-02-02'), 0);
    assert.equal(reharvestLedger(dir, null, '2026-02-02'), 0);
    assert.equal(reharvestLedger(dir, [], '2026-02-02'), 0);
    assert.equal(readLedger(dir), before);
  });
});

describe('runHarvest — narrow re-admission of unreadable verdicts', () => {
  it('re-harvests an unknown row through a full CLI run', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('alpha', 'PASS', 'proven'), wideRow('beta', 'unknown')]);
    archive(dir, 'alpha', { 'CONTEXT.md': '---\nstatus: done\n---\n' });
    archive(dir, 'beta', {
      'CONTEXT.md': '---\nstatus: done\nprofile: thorough\n---\n',
      'VERIFY.md': '**Verdict:** DEFERRED — handed to the PM layer\n'
    });

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    assert.equal(cellsByName(dir, 'beta').Verify, 'DEFERRED');
    assert.equal(cellsByName(dir, 'beta')['Verify note'], 'handed to the PM layer');
    assert.equal(
      cellsByName(dir, 'beta').Profile,
      'standard',
      'recorded history outside Verify/Verify note/Outcome is never rewritten'
    );
    assert.equal(rowFor(dir, 'alpha'), wideRow('alpha', 'PASS', 'proven'), 'a PASS row is untouched');
  });

  it('re-harvests an in-progress row whose feature has since finished', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('beta', 'in-progress', 'Stage 1 only')]);
    archive(dir, 'beta', {
      'CONTEXT.md': '---\nstatus: done\n---\n',
      'VERIFY.md': '**Status:** IN PROGRESS — Stage 1 only\n\n**Overall Status:** PASS\n'
    });

    assert.equal(runCli(dir).status, 0);
    assert.equal(cellsByName(dir, 'beta').Verify, 'PASS');
  });

  it('leaves the file byte-identical when a re-read still finds no verdict on a later day', () => {
    // The daily-rewrite regression: harvestFeature falls back to `today` for
    // Shipped when VERIFY.md carries no `**Verified:**` line, so a row that
    // stays unreadable used to be relabelled with a new ship date every run.
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('delta', 'unknown')]);
    archive(dir, 'delta', {
      'CONTEXT.md': '---\nstatus: done\n---\n',
      'VERIFY.md': '# nothing recognisable here\n'
    });

    const before = readLedger(dir);

    runHarvest(dir, dir, [], '2026-06-06');
    const first = readLedger(dir);
    assert.equal(first, before, 'a re-harvest that still finds no verdict changes nothing');

    runHarvest(dir, dir, [], '2026-07-07');
    assert.equal(readLedger(dir), before, 'and is still a no-op on a third date');

    assert.equal(cellsByName(dir, 'delta').Shipped, '2026-01-01', 'the recorded ship date survives');
  });

  it('repairs the Verify cells without downgrading provenance a removed artifact would', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('delta', 'unknown')]);
    // Only VERIFY.md remains: a whole-row re-render would rewrite Artifacts,
    // Plan rounds and Phases down to what this thinner archive can prove.
    archive(dir, 'delta', { 'VERIFY.md': '**Overall Status:** PASS\n' });

    runHarvest(dir, dir, [], '2026-06-06');

    const cells = cellsByName(dir, 'delta');
    assert.equal(cells.Verify, 'PASS');
    assert.equal(cells.Artifacts, 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md');
    assert.equal(cells['Plan rounds'], '1');
    assert.equal(cells.Phases, '1');
    assert.equal(cells.Shipped, '2026-01-01');
  });

  it('never re-reads a row recorded with a real verdict', () => {
    // Asserted by making those features' artifacts unreadable: a re-read
    // would surface as a changed row (or a crash), and neither may happen.
    const dir = tmpRepo();
    writeRoadmap(dir);
    const settled = ['PASS', 'FAIL', 'DEFERRED', 'INCONCLUSIVE', 'none'];
    seedLedger(dir, settled.map((v, i) => wideRow(`f${i}`, v)));

    for (let i = 0; i < settled.length; i++) {
      const featureDir = archive(dir, `f${i}`, { 'VERIFY.md': '**Overall Status:** PASS\n' });
      fs.chmodSync(path.join(featureDir, 'VERIFY.md'), 0o000);
    }

    const before = readLedger(dir);
    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(readLedger(dir), before, 'no settled row is re-read or rewritten');

    for (let i = 0; i < settled.length; i++) {
      fs.chmodSync(path.join(dir, '.planning', 'archive', `f${i}`, 'VERIFY.md'), 0o600);
    }
  });

  it('is idempotent when the re-read still finds no verdict', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('beta', 'unknown')]);
    archive(dir, 'beta', { 'CONTEXT.md': '---\nstatus: done\n---\n', 'VERIFY.md': '# nothing readable\n' });

    assert.equal(runCli(dir).status, 0);
    const first = readLedger(dir);
    assert.equal(runCli(dir).status, 0);
    assert.equal(readLedger(dir), first, 'byte-identical across runs, including updated:');
  });

  it('keeps exactly one row per slug across repeated runs', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);
    seedLedger(dir, [wideRow('beta', 'unknown')]);
    archive(dir, 'beta', {
      'CONTEXT.md': '---\nstatus: done\n---\n',
      'VERIFY.md': '**Overall Status:** PASS\n'
    });
    archive(dir, 'newcomer', {
      'CONTEXT.md': '---\nstatus: done\n---\n',
      'VERIFY.md': '**Overall Status:** FAIL\n'
    });

    for (let i = 0; i < 3; i++) assert.equal(runCli(dir).status, 0);

    const rows = ledgerRows(readLedger(dir));
    assert.deepEqual(rows.map((r) => r.slug).sort(), ['beta', 'newcomer']);
    assert.equal(rows.find((r) => r.slug === 'beta').cells.Verify, 'PASS');
    assert.equal(rows.find((r) => r.slug === 'newcomer').cells.Verify, 'FAIL');
  });

  it('is a silent no-op in a repo with no .project-manager/', () => {
    const dir = tmpRepo();
    archive(dir, 'beta', { 'VERIFY.md': '**Overall Status:** PASS\n' });

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(fs.existsSync(path.join(dir, '.project-manager')), false);
  });
});
