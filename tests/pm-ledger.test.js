// LEDGER.md harvest — the mechanical shipped-feature ledger written by
// ship/pm-update.cjs. Every claim here rests on temp repos and on the
// committed archive fixture in tests/fixtures/pm-ledger-archive/.
//
// The fixture exists because BOTH `.planning/` and `.project-manager/` are
// gitignored (.gitignore:39-40), so a clean checkout — CI's, always — has no
// archive to read. Sourcing these tests from the real .planning/archive/ made
// them pass locally and die with ENOENT on every CI run, which is exactly the
// clean-checkout blindness tests/fixtures/pm-state/ was introduced to end in
// v5.12.0. The fixture keeps REVIEW.md and VERIFY.md verbatim and reduces
// CONTEXT.md/PLAN.md to the bytes harvestFeature() actually parses; the
// drift tripwire at the bottom of this file re-harvests the real archive
// whenever it is present and asserts the fixture still yields identical
// records, so a reduced copy can never silently drift from its source.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { harvestFeature } = require(SCRIPT_PATH);
const repoRoot = path.resolve(__dirname, '..');
const archiveRoot = path.join(repoRoot, 'tests', 'fixtures', 'pm-ledger-archive');
/** The real archive — present only on a machine that has built these features. */
const realArchiveRoot = path.join(repoRoot, '.planning', 'archive');

/** The five features the fixture carries — the harvest's real-artifact test set. */
const KNOWN_ARCHIVED = [
  'dashboard-code-spans',
  'go-path-reliability',
  'lane-ownership',
  'pm-capability-uplift',
  'remove-legacy-install-tree'
];

const LEDGER_HEADER =
  '| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';

/** The ten-column shape ~100 already-recorded rows carry. Never rewritten. */
const LEGACY_LEDGER_HEADER =
  '| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';

/** Spawn the CLI in a given cwd, return { status, stdout, stderr }. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-ledger-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The date the harvest stamps for an artifact that names none. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A minimal, parseable .project-manager/ROADMAP.md. */
function writeRoadmap(dir, body) {
  const pmDir = path.join(dir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  const content =
    body === undefined
      ? '---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### M1 — Test (status: active)\n\n' +
        '| Item | Status | Priority | Depends on | Ship feature |\n' +
        '| --- | --- | --- | --- | --- |\n' +
        '| Thing | pending | P2 | — | — |\n'
      : body;
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), content);
  return content;
}

function ledgerPath(dir) {
  return path.join(dir, '.project-manager', 'LEDGER.md');
}

function readLedger(dir) {
  return fs.readFileSync(ledgerPath(dir), 'utf8');
}

/** Parse LEDGER.md into header-keyed row objects, mirroring the documented format. */
function ledgerRows(content) {
  const rows = [];
  let headers = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) {
      if (t !== '') headers = null;
      continue;
    }
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.includes('Feature') && cells.includes('Shipped') && cells.includes('Verify')) {
      headers = cells;
      continue;
    }
    if (!headers) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells.length !== headers.length) continue;
    const named = {};
    headers.forEach((h, i) => {
      named[h] = cells[i];
    });
    rows.push(named);
  }
  return rows;
}

/** Copy the committed archive fixture into a temp repo's .planning/archive/. */
function stageRealArchive(dir) {
  const slugs = fs
    .readdirSync(archiveRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const target = path.join(dir, '.planning', 'archive');
  fs.mkdirSync(target, { recursive: true });
  for (const slug of slugs) {
    fs.cpSync(path.join(archiveRoot, slug), path.join(target, slug), { recursive: true });
  }
  return slugs;
}

/** Read a field out of a staged artifact, so expectations derive from the file. */
function artifactField(dir, slug, file, pattern) {
  const p = path.join(dir, '.planning', 'archive', slug, file);
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, 'utf8').match(pattern);
  return m ? m[1].trim() : null;
}

describe('pm ledger — real-archive backfill', () => {
  it('creates LEDGER.md with the documented header and one row per archived feature', () => {
    const dir = tmpRepo();
    const slugs = stageRealArchive(dir);
    writeRoadmap(dir);

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    const content = readLedger(dir);
    assert.ok(content.includes(LEDGER_HEADER), 'twelve-column header verbatim');

    const rows = ledgerRows(content);
    // One row per archived feature, derived from the staged archive rather
    // than hardcoded — archiving the next feature must not turn this red.
    assert.equal(rows.length, slugs.length);
    assert.deepEqual(
      rows.map((row) => row.Feature).sort(),
      [...slugs].sort()
    );
    for (const known of KNOWN_ARCHIVED) {
      assert.ok(rows.some((row) => row.Feature === known), `${known} is recorded`);
    }
  });

  it('keeps a recorded ten-column ledger at ten columns when it appends', () => {
    // Header-aware rendering, asserted where it is easiest to regress: the
    // ledger a real project already holds predates `Outcome`/`Verify note`,
    // and rendering the widened shape into it would shift every value right.
    const dir = tmpRepo();
    const slugs = stageRealArchive(dir);
    writeRoadmap(dir);

    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      ledgerPath(dir),
      '---\nupdated: "2026-01-01"\n---\n\n# Ledger\n\n' +
        `${LEGACY_LEDGER_HEADER}\n|---|---|---|---|---|---|---|---|---|---|\n`
    );

    assert.equal(runCli(dir).status, 0);

    const content = readLedger(dir);
    assert.ok(content.includes(LEGACY_LEDGER_HEADER), 'the recorded header survives verbatim');
    assert.ok(!content.includes(LEDGER_HEADER), 'no widened header is written into a recorded file');

    const rows = content
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .slice(2); // header + separator
    assert.equal(rows.length, slugs.length);
    for (const row of rows) {
      const cells = row.trim().slice(1, -1).split('|');
      assert.equal(cells.length, 10, `appended row has the file's own width: ${row}`);
    }
    for (const row of ledgerRows(content)) {
      assert.ok(row.Verify, `${row.Feature} still records a verdict under its own header`);
      assert.equal(row.Outcome, undefined, 'a ten-column file gains no Outcome cell');
    }
  });

  it('records each Verify cell as that feature VERIFY.md Overall Status', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    for (const row of ledgerRows(readLedger(dir))) {
      const expected = artifactField(dir, row.Feature, 'VERIFY.md', /^\*\*Overall Status:\*\*\s*(.+)$/m);
      assert.equal(
        row.Verify,
        expected === null ? 'none' : expected.toUpperCase(),
        `${row.Feature} verdict derived from its own VERIFY.md`
      );
    }
  });

  it('records Shipped as that feature VERIFY.md Verified date', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    for (const row of ledgerRows(readLedger(dir))) {
      const expected = artifactField(dir, row.Feature, 'VERIFY.md', /^\*\*Verified:\*\*\s*(.+)$/m);
      assert.equal(row.Shipped, expected === null ? today() : expected);
    }
  });
});

describe('pm ledger — provenance disclosure', () => {
  it('names every missing field of pm-capability-uplift rather than a bare dash', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    const row = ledgerRows(readLedger(dir)).find((x) => x.Feature === 'pm-capability-uplift');
    assert.ok(row, 'pm-capability-uplift is recorded');
    assert.equal(
      row.Artifacts,
      'CONTEXT.md (no profile); PLAN.md; REVIEW.md (no evidence lines); VERIFY.md (no head)'
    );
    assert.equal(row.Profile, 'unknown');
  });

  it('renders a fully-populated Artifacts cell for lane-ownership', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    const row = ledgerRows(readLedger(dir)).find((x) => x.Feature === 'lane-ownership');
    assert.ok(row, 'lane-ownership is recorded');
    assert.equal(row.Artifacts, 'CONTEXT.md; PLAN.md; REVIEW.md; VERIFY.md');
    assert.equal(row.Profile, 'thorough');
  });

  it('reports go-path-reliability phase and finding counts derived from its REVIEW.md', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    const review = fs.readFileSync(
      path.join(dir, '.planning', 'archive', 'go-path-reliability', 'REVIEW.md'),
      'utf8'
    );
    const phaseIds = new Set();
    const headingRe = /^## Phase (.+?) — (.*?) \(round (\d+)\)\s*$/gm;
    let m;
    let fixRounds = 0;
    while ((m = headingRe.exec(review)) !== null) {
      phaseIds.add(m[1]);
      if (Number(m[3]) >= 2) fixRounds++;
    }
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const findingRe = /^- \[(critical|high|medium|low)\]/gm;
    let f;
    while ((f = findingRe.exec(review)) !== null) counts[f[1]]++;

    const row = ledgerRows(readLedger(dir)).find((x) => x.Feature === 'go-path-reliability');
    assert.equal(row.Phases, String(phaseIds.size));
    assert.equal(row['Fix rounds'], String(fixRounds));
    assert.equal(
      row['Findings (C/H/M/L)'],
      `${counts.critical}/${counts.high}/${counts.medium}/${counts.low}`
    );
  });
});

describe('pm ledger — a done feature with no VERIFY.md', () => {
  it('records a row with verdict none rather than skipping it', () => {
    const dir = tmpRepo();
    const featureDir = path.join(dir, '.planning', 'archive', 'no-verify-feature');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'CONTEXT.md'),
      '---\nfeature: "no-verify-feature"\nstatus: done\nprofile: quick\n---\n\n## Problem\n\nNo verify gate ran.\n'
    );
    writeRoadmap(dir);

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    const rows = ledgerRows(readLedger(dir));
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.Feature, 'no-verify-feature');
    assert.equal(row.Verify, 'none');
    assert.ok(row.Artifacts.includes('no VERIFY.md'));
    assert.ok(row.Artifacts.includes('no REVIEW.md'));
    assert.equal(row.Shipped, today());
    assert.notEqual(row.Artifacts, '—');
  });
});

describe('pm ledger — append-only idempotence', () => {
  it('adds no duplicate row and rewrites nothing across repeat runs', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);

    assert.equal(runCli(dir).status, 0);
    const afterFirst = readLedger(dir);
    assert.equal(runCli(dir).status, 0);
    const afterSecond = readLedger(dir);
    assert.equal(runCli(dir).status, 0);
    const afterThird = readLedger(dir);

    const withoutUpdated = (s) => s.replace(/^updated:.*$/m, 'updated: "X"');
    assert.equal(withoutUpdated(afterSecond), withoutUpdated(afterFirst));
    assert.equal(withoutUpdated(afterThird), withoutUpdated(afterSecond));

    const features = ledgerRows(afterThird).map((r) => r.Feature);
    assert.equal(new Set(features).size, features.length, 'no slug recorded twice');
  });

  it('leaves a hand-mutated row exactly as mutated', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);
    writeRoadmap(dir);
    assert.equal(runCli(dir).status, 0);

    const mutated = readLedger(dir).replace(/\| PASS \|/, '| MUTATED |');
    assert.ok(mutated.includes('| MUTATED |'), 'the fixture actually mutated a cell');
    fs.writeFileSync(ledgerPath(dir), mutated);

    assert.equal(runCli(dir).status, 0);
    const after = readLedger(dir);
    assert.ok(after.includes('| MUTATED |'), 'an existing row is never re-rendered');
    assert.equal(
      after.replace(/^updated:.*$/m, 'updated: "X"'),
      mutated.replace(/^updated:.*$/m, 'updated: "X"')
    );
  });
});

describe('pm ledger — forward append', () => {
  it('records a named done feature and ignores one still at built', () => {
    const dir = tmpRepo();
    writeRoadmap(dir);

    const featureDir = path.join(dir, '.planning', 'features', 'forward-feature');
    fs.mkdirSync(featureDir, { recursive: true });
    const contextPath = path.join(featureDir, 'CONTEXT.md');

    fs.writeFileSync(
      contextPath,
      '---\nfeature: "forward-feature"\nstatus: built\n---\n\n## Problem\n\nNot done yet.\n'
    );
    assert.equal(runCli(dir, ['forward-feature']).status, 0);
    assert.equal(fs.existsSync(ledgerPath(dir)), false, 'a built feature earns no row');

    fs.writeFileSync(
      contextPath,
      '---\nfeature: "forward-feature"\nstatus: done\nprofile: standard\n---\n\n## Problem\n\nDone.\n'
    );
    assert.equal(runCli(dir, ['forward-feature']).status, 0);

    const rows = ledgerRows(readLedger(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Feature, 'forward-feature');
    assert.equal(rows[0].Profile, 'standard');
    assert.equal(rows[0].Verify, 'none');
  });
});

describe('pm ledger — resilience', () => {
  it('is a silent no-op when .project-manager/ is absent', () => {
    const dir = tmpRepo();
    stageRealArchive(dir);

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.equal(fs.existsSync(ledgerPath(dir)), false);
  });

  it('still harvests when ROADMAP.md is absent', () => {
    const dir = tmpRepo();
    const staged = stageRealArchive(dir);
    fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(ledgerRows(readLedger(dir)).length, staged.length);
  });

  it('still harvests when ROADMAP.md is unparseable', () => {
    const dir = tmpRepo();
    const staged = stageRealArchive(dir);
    writeRoadmap(dir, 'not a table at all\n\n| stray | pipes\n');

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(ledgerRows(readLedger(dir)).length, staged.length);
  });

  it('records an empty archived feature directory with all four artifacts absent', () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, '.planning', 'archive', 'bare-feature'), { recursive: true });
    writeRoadmap(dir);

    const r = runCli(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');

    const rows = ledgerRows(readLedger(dir));
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].Artifacts,
      'no CONTEXT.md; no PLAN.md; no REVIEW.md; no VERIFY.md'
    );
    assert.equal(rows[0].Verify, 'none');
    assert.equal(rows[0].Profile, 'unknown');
  });
});

// The fixture reduces CONTEXT.md and PLAN.md to the bytes the harvest reads.
// That reduction is only safe while it stays faithful, so on any machine that
// still holds the real archive we harvest both and require identical records.
// Skipped — never failed — where the real archive is absent, which is every
// clean checkout including CI: the fixture is the source of truth there, and a
// missing local archive is not a defect.
describe('pm ledger — fixture fidelity', () => {
  it('harvests the reduced fixture identically to the real archive', (t) => {
    if (!fs.existsSync(realArchiveRoot)) {
      t.skip('no local .planning/archive — fixture is authoritative on a clean checkout');
      return;
    }

    const dir = tmpRepo();
    stageRealArchive(dir);

    let compared = 0;
    for (const slug of KNOWN_ARCHIVED) {
      if (!fs.existsSync(path.join(realArchiveRoot, slug))) continue;
      const fromReal = harvestFeature(repoRoot, slug, '2026-01-01');
      const fromFixture = harvestFeature(dir, slug, '2026-01-01');
      assert.deepEqual(
        fromFixture,
        fromReal,
        `${slug}: reduced fixture drifted from .planning/archive/${slug}`
      );
      compared += 1;
    }

    assert.ok(compared > 0, 'a present real archive must yield at least one comparison');
  });
});
