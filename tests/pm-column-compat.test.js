const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'pm-sync-nudge.cjs');
const { parseRoadmap, computeUnblocks, derivePriority } = require(SCRIPT_PATH);

/**
 * The four table widths both parsers must handle identically. Each shape
 * declares its header and a row renderer over the same logical row object,
 * so a shape difference is a column difference and nothing else.
 */
const SHAPES = {
  5: {
    header: '| Item | Status | Priority | Depends on | Ship feature |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.depends} | ${r.slug} |`
  },
  8: {
    header: '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.size} | ${r.depends} | ${r.source} | ${r.slug} | ${r.lane} |`
  },
  10: {
    header: '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.size} | ${r.depends} | ${r.source} | ${r.slug} | ${r.lane} | ${r.blast} | ${r.confidence} |`
  },
  11: {
    header: '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.size} | ${r.depends} | ${r.source} | ${r.slug} | ${r.lane} | ${r.blast} | ${r.confidence} | ${r.firstSeen} |`
  }
};

const WIDTHS = [5, 8, 10, 11];

/** Fill a partial row with the defaults every shape needs. */
function makeRow(r) {
  return {
    item: 'Item',
    status: 'pending',
    priority: 'P2',
    size: 'M',
    depends: '—',
    source: 'test fixture',
    slug: '—',
    lane: '—',
    blast: 'users',
    confidence: 'proven',
    firstSeen: '—',
    ...r
  };
}

/** Build a ROADMAP.md string with one milestone table of the given width. */
function roadmap(width, rows, milestone = 'M1 — Test milestone') {
  const shape = SHAPES[width];
  const sep = '| ' + shape.header.slice(1, -1).split('|').map(() => '---').join(' | ') + ' |';
  return [
    '---',
    'project: "Test Project"',
    'updated: "2026-08-24"',
    '---',
    '',
    '## Milestones',
    '',
    `### ${milestone} (status: active)`,
    '',
    shape.header,
    sep,
    ...rows.map(r => shape.row(makeRow(r))),
    ''
  ].join('\n');
}

/** The logical rows every parseRoadmap shape assertion runs against. */
const CORE_ROWS = [
  { item: 'Alpha', status: 'pending', priority: 'P2', slug: 'alpha-feature' },
  { item: 'Beta', status: 'in-progress', priority: 'P1', depends: 'Alpha', slug: 'beta-feature' },
  { item: 'Gamma', status: 'done', priority: 'P3', depends: 'Alpha', slug: '—' }
];

/** Spawn the nudge hook with the JSON stdin it expects. */
function runHook(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('close', code => {
      let output = null;
      if (stdout.trim()) {
        try {
          output = JSON.parse(stdout);
        } catch (e) {
          output = null;
        }
      }
      resolve({ code, output, stderr });
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ cwd }));
    child.stdin.end();
  });
}

/** A feature directory whose CONTEXT.md carries the given status. */
function createFeature(tmpDir, name, status) {
  const featureDir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`
  );
}

describe('parseRoadmap column compatibility', () => {
  it('5-, 8-, 10-, and 11-column tables yield the same rows', () => {
    const baseline = parseRoadmap(roadmap(5, CORE_ROWS)).map(r => ({
      Item: r.cells.Item,
      Status: r.cells.Status,
      Priority: r.cells.Priority,
      'Ship feature': r.cells['Ship feature']
    }));

    assert.equal(baseline.length, 3, '5-column table should yield three rows');

    for (const width of WIDTHS) {
      const rows = parseRoadmap(roadmap(width, CORE_ROWS));
      assert.equal(rows.length, 3, `${width}-column table should yield three rows`);
      const projected = rows.map(r => ({
        Item: r.cells.Item,
        Status: r.cells.Status,
        Priority: r.cells.Priority,
        'Ship feature': r.cells['Ship feature']
      }));
      assert.deepEqual(projected, baseline, `${width}-column table should carry the same core cells`);
    }
  });

  it('slug and milestone attribution survive every width', () => {
    for (const width of WIDTHS) {
      const rows = parseRoadmap(roadmap(width, CORE_ROWS));
      assert.deepEqual(rows.map(r => r.slug), ['alpha-feature', 'beta-feature', null], `width ${width}`);
      assert.deepEqual(rows.map(r => r.slugless), [false, false, true], `width ${width}`);
      for (const r of rows) assert.equal(r.milestone, 'M1 — Test milestone', `width ${width}`);
    }
  });

  it('narrow shapes leave Blast radius and Confidence undefined', () => {
    for (const width of [5, 8]) {
      for (const r of parseRoadmap(roadmap(width, CORE_ROWS))) {
        assert.equal(r.cells['Blast radius'], undefined, `width ${width} should have no Blast radius cell`);
        assert.equal(r.cells.Confidence, undefined, `width ${width} should have no Confidence cell`);
        assert.equal(r.cells['First seen'], undefined, `width ${width} should have no First seen cell`);
      }
    }
    for (const r of parseRoadmap(roadmap(10, CORE_ROWS))) {
      assert.equal(r.cells['Blast radius'], 'users');
      assert.equal(r.cells.Confidence, 'proven');
      assert.equal(r.cells['First seen'], undefined, '10-column shape has no First seen cell');
    }
    for (const r of parseRoadmap(roadmap(11, CORE_ROWS))) {
      assert.equal(r.cells['First seen'], '—');
    }
  });

  it('absent Blast radius/Confidence read as unknown and produce no promotion (criterion 9)', () => {
    for (const width of [5, 8]) {
      const rows = parseRoadmap(roadmap(width, CORE_ROWS));
      const unblocks = computeUnblocks(rows);
      const alpha = rows.find(r => r.cells.Item === 'Alpha');
      const d = derivePriority(alpha, unblocks.get('Alpha'));
      assert.equal(d.blastRadius, 'unknown', `width ${width} blast radius`);
      assert.equal(d.confidence, 'unknown', `width ${width} confidence`);
      assert.equal(d.firstSeen, 'unknown', `width ${width} first seen`);
      assert.equal(d.needsEvidence, true, `width ${width} needsEvidence`);
      assert.equal(d.derived, d.recorded, `width ${width} must not promote without evidence`);
      assert.equal(d.derived, 'P2');
    }
  });

  it('the same row promotes once the evidence columns are present', () => {
    for (const width of [10, 11]) {
      const rows = parseRoadmap(roadmap(width, CORE_ROWS));
      const unblocks = computeUnblocks(rows);
      const alpha = rows.find(r => r.cells.Item === 'Alpha');
      const d = derivePriority(alpha, unblocks.get('Alpha'));
      assert.equal(d.blastRadius, 'users', `width ${width}`);
      assert.equal(d.confidence, 'proven', `width ${width}`);
      assert.equal(d.needsEvidence, false, `width ${width}`);
      assert.equal(d.derived, 'P0', `width ${width} should promote on users + proven`);
    }
  });

  it('two tables of different widths in one file: neither inherits the other header', () => {
    const wide = roadmap(11, [
      { item: 'Alpha', priority: 'P2', slug: 'alpha-feature', blast: 'users', confidence: 'proven', firstSeen: '2026-01-01' }
    ], 'M1 — Wide');
    const narrowTable = roadmap(5, [
      { item: 'Zeta', priority: 'P3', slug: 'zeta-feature' }
    ], 'M2 — Narrow');
    // Second milestone appended without its frontmatter.
    const combined = wide + '\n' + narrowTable.split('\n').slice(5).join('\n');

    const rows = parseRoadmap(combined);
    assert.equal(rows.length, 2);

    const alpha = rows.find(r => r.cells.Item === 'Alpha');
    const zeta = rows.find(r => r.cells.Item === 'Zeta');
    assert.ok(alpha && zeta, 'both tables should parse');

    assert.equal(alpha.headers.length, 11);
    assert.equal(zeta.headers.length, 5);
    assert.equal(alpha.cells['Blast radius'], 'users');
    assert.equal(zeta.cells['Blast radius'], undefined, 'narrow table must not inherit the wide header');
    assert.equal(zeta.cells['First seen'], undefined);
    assert.equal(alpha.milestone, 'M1 — Wide');
    assert.equal(zeta.milestone, 'M2 — Narrow');

    const unblocks = computeUnblocks(rows);
    assert.equal(derivePriority(alpha, unblocks.get('Alpha')).derived, 'P0');
    const zetaDerived = derivePriority(zeta, unblocks.get('Zeta'));
    assert.equal(zetaDerived.needsEvidence, true);
    assert.equal(zetaDerived.derived, 'P3');
  });

  it('a widened header with un-widened rows drops the mismatched rows', () => {
    const content = [
      '---',
      'project: "Test Project"',
      'updated: "2026-08-24"',
      '---',
      '',
      '### M1 — Mismatch (status: active)',
      '',
      SHAPES[11].header,
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      SHAPES[11].row(makeRow({ item: 'Wide', slug: 'wide-feature' })),
      SHAPES[8].row(makeRow({ item: 'Narrow', slug: 'narrow-feature' })),
      ''
    ].join('\n');

    const rows = parseRoadmap(content);
    assert.equal(rows.length, 1, 'the un-widened row must be dropped, never mis-columned');
    assert.equal(rows[0].cells.Item, 'Wide');
    assert.equal(rows[0].cells['Blast radius'], 'users', 'the surviving row keeps its own columns');
  });
});

describe('pm-sync-nudge parses the same four widths', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-col-compat-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const width of WIDTHS) {
    it(`${width}-column table → the drift nudge fires identically`, async () => {
      createFeature(tmpDir, 'alpha-feature', 'building');
      fs.mkdirSync(path.join(tmpDir, '.project-manager'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.project-manager', 'ROADMAP.md'),
        roadmap(width, [{ item: 'Alpha', status: 'pending', slug: 'alpha-feature' }])
      );

      const { code, output, stderr } = await runHook(tmpDir);
      assert.equal(code, 0, `width ${width} exit code`);
      assert.equal(stderr, '', `width ${width} stderr`);
      assert.ok(output, `width ${width} should nudge on drift`);
      const msg = output.hookSpecificOutput.additionalContext;
      assert.match(msg, /alpha-feature: roadmap says pending, actually in-progress/, `width ${width} drift line`);
      assert.match(msg, /pm-update\.cjs" alpha-feature/, `width ${width} fix command`);
    });
  }

  it('a table without drift stays silent at every width', async () => {
    for (const width of WIDTHS) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-col-compat-sync-'));
      try {
        createFeature(dir, 'alpha-feature', 'building');
        fs.mkdirSync(path.join(dir, '.project-manager'), { recursive: true });
        fs.writeFileSync(
          path.join(dir, '.project-manager', 'ROADMAP.md'),
          roadmap(width, [{ item: 'Alpha', status: 'in-progress', slug: 'alpha-feature' }])
        );
        const { code, output, stderr } = await runHook(dir);
        assert.equal(code, 0, `width ${width}`);
        assert.equal(stderr, '', `width ${width}`);
        assert.equal(output, null, `width ${width} should stay silent when in sync`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('two widths in one file: the hook reads both tables', async () => {
    createFeature(tmpDir, 'alpha-feature', 'building');
    createFeature(tmpDir, 'zeta-feature', 'building');
    const wide = roadmap(11, [{ item: 'Alpha', status: 'pending', slug: 'alpha-feature' }], 'M1 — Wide');
    const narrowTable = roadmap(5, [{ item: 'Zeta', status: 'pending', slug: 'zeta-feature' }], 'M2 — Narrow');
    fs.mkdirSync(path.join(tmpDir, '.project-manager'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.project-manager', 'ROADMAP.md'),
      wide + '\n' + narrowTable.split('\n').slice(5).join('\n')
    );

    const { code, output, stderr } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(stderr, '');
    assert.ok(output, 'both tables should contribute drift');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.match(msg, /alpha-feature: roadmap says pending, actually in-progress/);
    assert.match(msg, /zeta-feature: roadmap says pending, actually in-progress/);
  });

  it('a widened header with un-widened rows drops those rows in the hook too', async () => {
    createFeature(tmpDir, 'wide-feature', 'building');
    createFeature(tmpDir, 'narrow-feature', 'building');
    const content = [
      '---',
      'project: "Test Project"',
      'updated: "2026-08-24"',
      '---',
      '',
      '### M1 — Mismatch (status: active)',
      '',
      SHAPES[11].header,
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      SHAPES[11].row(makeRow({ item: 'Wide', status: 'pending', slug: 'wide-feature' })),
      SHAPES[8].row(makeRow({ item: 'Narrow', status: 'pending', slug: 'narrow-feature' })),
      ''
    ].join('\n');
    fs.mkdirSync(path.join(tmpDir, '.project-manager'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.project-manager', 'ROADMAP.md'), content);

    const { code, output, stderr } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(stderr, '');
    assert.ok(output, 'the well-formed row should still nudge');
    const msg = output.hookSpecificOutput.additionalContext;
    assert.match(msg, /wide-feature: roadmap says pending, actually in-progress/);
    assert.ok(!msg.includes('narrow-feature'), 'the mismatched row must be dropped, never mis-columned');
  });
});
