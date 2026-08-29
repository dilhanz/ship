const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { applyStatusUpdates } = require(SCRIPT_PATH);

/**
 * The guard for the audit's "mechanical status reconciliation is exact"
 * property: every historical table width must reconcile to exactly the bytes
 * it reconciled to before this feature added `awaiting-merge`, `Kind`, and the
 * `Lane` writer. A legacy v5.3.0 five-column directory is the oldest shape
 * still in the wild, and none of the new columns exist in it — so every new
 * code path must be a no-op there, not merely "compatible".
 */
const SHAPES = {
  5: {
    header: '| Item | Status | Priority | Depends on | Ship feature |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.depends} | ${r.slug} |`
  },
  7: {
    header: '| Item | Status | Priority | Size | Depends on | Source | Ship feature |',
    row: r => `| ${r.item} | ${r.status} | ${r.priority} | ${r.size} | ${r.depends} | ${r.source} | ${r.slug} |`
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

/** Every historical width, oldest first. */
const WIDTHS = [5, 7, 8, 10, 11];

/** Widths that carry no `Lane` column at all — the legacy shapes. */
const LANELESS = [5, 7];

function makeRow(r) {
  return {
    item: 'Item',
    status: 'pending',
    priority: 'P2',
    size: 'M',
    depends: '—',
    source: 'legacy fixture',
    slug: '—',
    lane: '—',
    blast: 'users',
    confidence: 'proven',
    firstSeen: '2026-01-01',
    ...r
  };
}

/**
 * The four reconciliation cases the mapping table documents, exercised in one
 * table: an archived feature with no `**Head:**` stamp, an active feature, a
 * recorded `blocked` row over an active feature, and a slug found nowhere.
 */
const CASES = [
  { item: 'Archived', status: 'pending', slug: 'archived-feature', expect: 'done' },
  { item: 'Active', status: 'pending', slug: 'active-feature', expect: 'in-progress' },
  { item: 'Blocked', status: 'blocked', slug: 'active-feature', expect: 'blocked' },
  { item: 'Nowhere', status: 'pending', slug: 'ghost-feature', expect: 'pending' }
];

/** Build a ROADMAP.md of the given width, each row carrying `statuses[i]`. */
function roadmap(width, statuses, updated = '2026-08-24') {
  const shape = SHAPES[width];
  const sep = '| ' + shape.header.slice(1, -1).split('|').map(() => '---').join(' | ') + ' |';
  return [
    '---',
    'project: "Legacy Project"',
    `updated: "${updated}"`,
    '---',
    '',
    '## Milestones',
    '',
    '### M1 — Legacy milestone (status: active)',
    '',
    shape.header,
    sep,
    ...CASES.map((c, i) => shape.row(makeRow({ ...c, status: statuses[i] }))),
    ''
  ].join('\n');
}

/** The roadmap as it looks before reconciliation (recorded statuses). */
const RECORDED = CASES.map(c => c.status);

/** The roadmap as it must look after reconciliation. */
const EXPECTED = CASES.map(c => c.expect);

function createFeature(dir, name, status) {
  const featureDir = path.join(dir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nLegacy fixture.\n`
  );
}

/** An archived feature carrying NO VERIFY.md — the pre-stamp shape. */
function createArchive(dir, name) {
  const archiveDir = path.join(dir, '.planning', 'archive', name);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: done\n---\n\n## Problem\n\nLegacy fixture.\n`
  );
}

/** A temp repo carrying the reconciliation cases' feature state. */
function makeWorld(tmpDir) {
  createArchive(tmpDir, 'archived-feature');
  createFeature(tmpDir, 'active-feature', 'building');
}

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

/** Today's date in the format the script stamps. */
function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('legacy roadmap shapes reconcile byte-identically', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-legacy-'));
    makeWorld(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const width of WIDTHS) {
    it(`${width}-column table: applyStatusUpdates produces the documented pre-change bytes`, () => {
      const before = roadmap(width, RECORDED);
      const { content, changed } = applyStatusUpdates(before, tmpDir, null);

      assert.equal(changed, true, `width ${width}: two rows must move`);
      // The expected output, byte for byte: only the Status cells moved, and
      // the frontmatter `updated:` bumped to today.
      const expected = roadmap(width, EXPECTED, todayStamp());
      assert.equal(content, expected, `width ${width}: reconciled bytes must match the documented mapping`);
    });

    it(`${width}-column table: an already-reconciled roadmap is a byte-identical no-op`, () => {
      const before = roadmap(width, EXPECTED);
      const { content, changed } = applyStatusUpdates(before, tmpDir, null);

      assert.equal(changed, false, `width ${width}: nothing to move`);
      assert.equal(content, before, `width ${width}: no Status cell moved, so not one byte moves`);
    });
  }

  it('an archived feature with no **Head:** stamp still maps to done at every width', () => {
    for (const width of WIDTHS) {
      const { content } = applyStatusUpdates(roadmap(width, RECORDED), tmpDir, null);
      const line = content.split('\n').find(l => l.startsWith('| Archived '));
      assert.match(line, /\| done \|/, `width ${width}: a stamp-less archive is not evidence against merge`);
      assert.ok(!content.includes('awaiting-merge'), `width ${width}: no stamp means no merge test at all`);
    }
  });

  it('recorded blocked over an active feature stays blocked at every width', () => {
    for (const width of WIDTHS) {
      const { content } = applyStatusUpdates(roadmap(width, RECORDED), tmpDir, null);
      const line = content.split('\n').find(l => l.startsWith('| Blocked '));
      assert.match(line, /\| blocked \|/, `width ${width}: blocked is a PM judgment`);
    }
  });

  it('a slug found nowhere stays untouched at every width', () => {
    for (const width of WIDTHS) {
      const { content } = applyStatusUpdates(roadmap(width, RECORDED), tmpDir, null);
      const line = content.split('\n').find(l => l.startsWith('| Nowhere '));
      assert.equal(line, SHAPES[width].row(makeRow({ ...CASES[3] })), `width ${width}: byte-identical row`);
    }
  });
});

describe('a full CLI run leaves a legacy roadmap exactly as authored', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-legacy-cli-'));
    makeWorld(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.project-manager'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const roadmapPath = () => path.join(tmpDir, '.project-manager', 'ROADMAP.md');

  for (const width of WIDTHS) {
    it(`${width}-column table: an already-reconciled roadmap survives a CLI run byte-identically`, () => {
      const before = roadmap(width, EXPECTED);
      fs.writeFileSync(roadmapPath(), before);

      const r = runCli(tmpDir);
      assert.equal(r.status, 0, `width ${width}: exit code`);

      const after = fs.readFileSync(roadmapPath(), 'utf8');
      assert.equal(after, before, `width ${width}: no Status cell moved, so the frontmatter updated: must not move either`);
    });

    it(`${width}-column table: a CLI reconcile moves Status cells and nothing else`, () => {
      const before = roadmap(width, RECORDED);
      fs.writeFileSync(roadmapPath(), before);

      const r = runCli(tmpDir);
      assert.equal(r.status, 0, `width ${width}: exit code`);

      const after = fs.readFileSync(roadmapPath(), 'utf8');
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');

      assert.equal(afterLines.length, beforeLines.length, `width ${width}: no line added or removed`);
      assert.equal(afterLines[9], beforeLines[9], `width ${width}: the header is never widened`);
      assert.equal(afterLines[10], beforeLines[10], `width ${width}: the separator is never widened`);

      for (let i = 0; i < beforeLines.length; i++) {
        if (i === 2) continue; // the frontmatter updated: line
        const changed = afterLines[i] !== beforeLines[i];
        if (!changed) continue;
        // The only permitted difference is a Status cell.
        const b = beforeLines[i].split('|');
        const a = afterLines[i].split('|');
        assert.equal(a.length, b.length, `width ${width} line ${i}: cell count is fixed`);
        for (let c = 0; c < b.length; c++) {
          if (c === 2) continue; // segment 2 is the Status cell in every shape
          assert.equal(a[c], b[c], `width ${width} line ${i}: only the Status cell may move`);
        }
      }

      assert.match(afterLines[2], new RegExp(`updated: "${todayStamp()}"`), `width ${width}: updated: bumps when a Status cell moved`);
    });
  }

  for (const width of LANELESS) {
    it(`${width}-column table: no Lane cell is ever written into a Lane-less table`, () => {
      const before = roadmap(width, RECORDED);
      fs.writeFileSync(roadmapPath(), before);

      assert.equal(runCli(tmpDir).status, 0);

      const after = fs.readFileSync(roadmapPath(), 'utf8');
      assert.ok(!after.includes('| Lane |'), `width ${width}: the Lane column must not appear`);
      for (const line of after.split('\n')) {
        if (!line.startsWith('| ') || line.startsWith('| Item ')) continue;
        assert.equal(line.split('|').length, SHAPES[width].header.split('|').length, `width ${width}: row width is fixed`);
      }
    });
  }

  it('no First seen stamp appears in a table without the column', () => {
    for (const width of [5, 7, 8, 10]) {
      const before = roadmap(width, EXPECTED);
      fs.writeFileSync(roadmapPath(), before);
      assert.equal(runCli(tmpDir).status, 0);
      assert.equal(fs.readFileSync(roadmapPath(), 'utf8'), before, `width ${width}: First seen is never widened in`);
    }
  });

  it('a table with no Kind column reconciles every row as work', () => {
    // The Archived row would be exempted if it were read as `debt`; without a
    // Kind column every row is `work`, which is today's behaviour byte-for-byte.
    for (const width of WIDTHS) {
      const before = roadmap(width, RECORDED);
      fs.writeFileSync(roadmapPath(), before);
      assert.equal(runCli(tmpDir).status, 0);
      const after = fs.readFileSync(roadmapPath(), 'utf8');
      const line = after.split('\n').find(l => l.startsWith('| Archived '));
      assert.match(line, /\| done \|/, `width ${width}: an absent Kind column means work`);
    }
  });

  it('a repo with no .project-manager/ at all is a silent no-op exiting 0', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-legacy-bare-'));
    try {
      makeWorld(bare);
      const r = runCli(bare);
      assert.equal(r.status, 0);
      assert.equal(r.stderr, '');
      assert.ok(!fs.existsSync(path.join(bare, '.project-manager')), 'nothing is created');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
