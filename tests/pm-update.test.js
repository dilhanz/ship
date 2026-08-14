const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { parseRoadmap, applyStatusUpdates, selectNext, generateDashboard, writeFileAtomic } = require(SCRIPT_PATH);

/** Spawn the CLI in a given cwd, return { status, stdout, stderr }. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

/** Real git is needed only for the multi-worktree suite. */
const gitAvailable = (() => {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch (e) {
    return false;
  }
})();

/** Run git in a directory, asserting success. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

/**
 * Init a repo with local identity and a committed .gitignore covering
 * .project-manager/ and .planning/ — committed so linked worktrees check it
 * out and the resolver's `git check-ignore` sees it from every lane.
 */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ship Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.project-manager/\n.planning/\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'init');
}

/** Active feature: .planning/features/{name}/CONTEXT.md with the given status. */
function createFeature(tmpDir, name, status) {
  const featureDir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: ${status}\n---\n\n## Problem\n\nTest feature.\n`
  );
}

/** Archived feature: .planning/archive/{name}/ exists. */
function createArchivedFeature(tmpDir, name) {
  const archiveDir = path.join(tmpDir, '.planning', 'archive', name);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, 'CONTEXT.md'),
    `---\nfeature: "${name}"\nstatus: done\n---\n\n## Problem\n\nArchived feature.\n`
  );
}

/**
 * Build ROADMAP.md content from rows: { item, status, priority, size, depends, source, slug, lane }.
 * shape 'v7' (default) includes Size and Source; 'v5' is the legacy header;
 * 'v8' appends the Lane column ({branch} @ {path}, '—' when not in flight).
 */
function roadmapContent(rows, shape = 'v7') {
  const lines = [
    '---',
    'project: "Test Project"',
    'updated: "2026-08-10"',
    '---',
    '',
    '## Milestones',
    '',
    '### M1 — Test milestone (status: active)',
    '',
    'Goal: exercise the pm updater',
    '',
  ];
  if (shape === 'v5') {
    lines.push('| Item | Status | Priority | Depends on | Ship feature |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.depends || '—'} | ${r.slug || '—'} |`
      );
    }
  } else if (shape === 'v8') {
    lines.push('| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.size || '—'} | ${r.depends || '—'} | ${r.source || 'test fixture'} | ${r.slug || '—'} | ${r.lane || '—'} |`
      );
    }
  } else {
    lines.push('| Item | Status | Priority | Size | Depends on | Source | Ship feature |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${r.item} | ${r.status} | ${r.priority || 'P1'} | ${r.size || '—'} | ${r.depends || '—'} | ${r.source || 'test fixture'} | ${r.slug || '—'} |`
      );
    }
  }
  return lines.join('\n') + '\n';
}

function writeRoadmap(tmpDir, rows, shape = 'v7') {
  const pmDir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  const content = roadmapContent(rows, shape);
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), content);
  return content;
}

/**
 * Assert that `after` differs from `before` only on the expected lines:
 * the edited Status rows (matched by predicate) and the frontmatter
 * `updated:` line. Every other line must be byte-identical.
 */
function assertOnlyEditedLines(before, after, isExpectedEdit) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  assert.equal(afterLines.length, beforeLines.length, 'line count must not change');
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] === afterLines[i]) continue;
    assert.ok(
      isExpectedEdit(beforeLines[i], afterLines[i]),
      `unexpected edit at line ${i}:\n  before: ${beforeLines[i]}\n  after:  ${afterLines[i]}`
    );
  }
}

const isUpdatedLine = (b) => /^updated:/.test(b);

describe('pm-update: parsing and status editing', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-update-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('7-column shape: edits only Status cells and the updated line', () => {
    createArchivedFeature(tmpDir, 'done-feature');
    createFeature(tmpDir, 'active-feature', 'building');
    const before = roadmapContent([
      { item: 'Shipped', status: 'in-progress', slug: 'done-feature' },
      { item: 'Active', status: 'pending', slug: 'active-feature' },
      { item: 'Untouched', status: 'pending', slug: '—' },
    ]);

    const { content: after, changed } = applyStatusUpdates(before, tmpDir, []);
    assert.equal(changed, true);
    assertOnlyEditedLines(before, after, (b, a) =>
      isUpdatedLine(b) ||
      (b.includes('| Shipped |') && a.includes('| done |')) ||
      (b.includes('| Active |') && a.includes('| in-progress |'))
    );
    assert.ok(after.includes('| Shipped | done | P1 |'), 'archived feature row → done');
    assert.ok(after.includes('| Active | in-progress | P1 |'), 'active feature row → in-progress');
    assert.ok(after.includes('| Untouched | pending |'), 'slugless row untouched');
  });

  it('legacy 5-column shape: same edits, shape preserved', () => {
    createArchivedFeature(tmpDir, 'done-feature');
    createFeature(tmpDir, 'active-feature', 'building');
    const before = roadmapContent([
      { item: 'Shipped', status: 'in-progress', slug: 'done-feature' },
      { item: 'Active', status: 'pending', slug: 'active-feature' },
    ], 'v5');

    const { content: after, changed } = applyStatusUpdates(before, tmpDir, []);
    assert.equal(changed, true);
    assertOnlyEditedLines(before, after, (b, a) =>
      isUpdatedLine(b) ||
      (b.includes('| Shipped |') && a.includes('| done |')) ||
      (b.includes('| Active |') && a.includes('| in-progress |'))
    );
    assert.ok(after.includes('| Shipped | done | P1 | — | done-feature |'), 'row keeps 5-column shape');
  });

  it('v8 shape: Lane cell survives a status update byte-for-byte', () => {
    createArchivedFeature(tmpDir, 'done-feature');
    const before = roadmapContent([
      { item: 'InFlight', status: 'in-progress', slug: 'done-feature', lane: 'feature/x @ C:/lanes/x' },
      { item: 'Parked', status: 'pending' },
    ], 'v8');

    const { content: after, changed } = applyStatusUpdates(before, tmpDir, []);
    assert.equal(changed, true);
    assertOnlyEditedLines(before, after, (b, a) =>
      isUpdatedLine(b) ||
      (b.includes('| InFlight |') && a.includes('| done |'))
    );
    assert.ok(
      after.includes('| InFlight | done | P1 | — | — | test fixture | done-feature | feature/x @ C:/lanes/x |'),
      'edited row keeps every non-Status cell — Lane included — byte-for-byte'
    );
    assert.ok(after.includes('| Parked | pending | P1 | — | — | test fixture | — | — |'), 'untouched row intact');
  });

  it('slug filter: only the named rows are updated', () => {
    createArchivedFeature(tmpDir, 'feat-a');
    createArchivedFeature(tmpDir, 'feat-b');
    const before = roadmapContent([
      { item: 'A', status: 'in-progress', slug: 'feat-a' },
      { item: 'B', status: 'in-progress', slug: 'feat-b' },
    ]);

    const { content: after } = applyStatusUpdates(before, tmpDir, ['feat-a']);
    assert.ok(after.includes('| A | done |'), 'named slug updated');
    assert.ok(after.includes('| B | in-progress |'), 'other slug untouched');
  });
});

describe('pm-update: mapping table', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-update-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archive presence → done', () => {
    createArchivedFeature(tmpDir, 'feat-a');
    const before = roadmapContent([{ item: 'A', status: 'pending', slug: 'feat-a' }]);
    const { content: after } = applyStatusUpdates(before, tmpDir, []);
    assert.ok(after.includes('| A | done |'));
  });

  it('CONTEXT status built → in-progress', () => {
    createFeature(tmpDir, 'feat-a', 'built');
    const before = roadmapContent([{ item: 'A', status: 'pending', slug: 'feat-a' }]);
    const { content: after } = applyStatusUpdates(before, tmpDir, []);
    assert.ok(after.includes('| A | in-progress |'));
  });

  it('CONTEXT status done → done', () => {
    createFeature(tmpDir, 'feat-a', 'done');
    const before = roadmapContent([{ item: 'A', status: 'pending', slug: 'feat-a' }]);
    const { content: after } = applyStatusUpdates(before, tmpDir, []);
    assert.ok(after.includes('| A | done |'));
  });

  it('recorded blocked + active feature → unchanged, no bump', () => {
    createFeature(tmpDir, 'feat-a', 'building');
    const before = roadmapContent([{ item: 'A', status: 'blocked', slug: 'feat-a' }]);
    const { content: after, changed } = applyStatusUpdates(before, tmpDir, []);
    assert.equal(changed, false);
    assert.equal(after, before, 'blocked is PM judgment, never auto-overridden');
  });

  it('slug found nowhere → unchanged, no bump', () => {
    const before = roadmapContent([{ item: 'Ghost', status: 'pending', slug: 'ghost-feature' }]);
    const { content: after, changed } = applyStatusUpdates(before, tmpDir, []);
    assert.equal(changed, false);
    assert.equal(after, before, 'never invent a status');
  });

  it('bumped updated line keeps the quoted form', () => {
    createArchivedFeature(tmpDir, 'feat-a');
    const before = roadmapContent([{ item: 'A', status: 'pending', slug: 'feat-a' }]);
    const { content: after } = applyStatusUpdates(before, tmpDir, []);
    const updatedLine = after.split('\n').find((l) => l.startsWith('updated:'));
    assert.match(updatedLine, /^updated: "\d{4}-\d{2}-\d{2}"$/, 'quoted YYYY-MM-DD form');
    assert.notEqual(updatedLine, 'updated: "2026-08-10"', 'bumped away from the fixture date');
  });
});

describe('pm-update: --next selection', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-update-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('priority order: P0 beats P2', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Low', status: 'pending', priority: 'P2' },
      { item: 'High', status: 'pending', priority: 'P0' },
    ]));
    assert.equal(selectNext(rows).item, 'High');
  });

  it('done and blocked rows are excluded', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Done', status: 'done', priority: 'P0' },
      { item: 'Blocked', status: 'blocked', priority: 'P0' },
      { item: 'Ready', status: 'pending', priority: 'P3' },
    ]));
    assert.equal(selectNext(rows).item, 'Ready');
  });

  it('unmet dependency (named item not done) excludes the row', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Base', status: 'pending', priority: 'P2' },
      { item: 'Child', status: 'pending', priority: 'P0', depends: 'Base' },
    ]));
    assert.equal(selectNext(rows).item, 'Base');
  });

  it('unknown dependency name counts as unmet', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Orphan', status: 'pending', priority: 'P0', depends: 'Nonexistent' },
      { item: 'Ready', status: 'pending', priority: 'P2' },
    ]));
    assert.equal(selectNext(rows).item, 'Ready');
  });

  it('met dependency (named item done) admits the row', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Base', status: 'done', priority: 'P1' },
      { item: 'Child', status: 'pending', priority: 'P1', depends: 'Base' },
    ]));
    assert.equal(selectNext(rows).item, 'Child');
  });

  it('— dependency means independent', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Free', status: 'pending', priority: 'P1', depends: '—' },
    ]));
    assert.equal(selectNext(rows).item, 'Free');
  });

  it('ties break by document order', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'First', status: 'pending', priority: 'P1' },
      { item: 'Second', status: 'pending', priority: 'P1' },
    ]));
    assert.equal(selectNext(rows).item, 'First');
  });

  it('null when nothing is eligible', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'Done', status: 'done' },
      { item: 'Blocked', status: 'blocked' },
    ]));
    assert.equal(selectNext(rows), null);
  });

  it('result carries milestone, priority, and null shipFeature for —', () => {
    const rows = parseRoadmap(roadmapContent([
      { item: 'A', status: 'pending', priority: 'P1', slug: '—' },
    ]));
    assert.deepEqual(selectNext(rows), {
      item: 'A',
      milestone: 'M1 — Test milestone',
      priority: 'P1',
      shipFeature: null,
    });
  });

  it('CLI --next prints the selection as JSON and writes nothing', () => {
    const before = writeRoadmap(tmpDir, [
      { item: 'A', status: 'pending', priority: 'P0', slug: 'feat-a' },
    ]);

    const r = runCli(tmpDir, ['--next']);
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), {
      item: 'A',
      milestone: 'M1 — Test milestone',
      priority: 'P0',
      shipFeature: 'feat-a',
    });

    const roadmapPath = path.join(tmpDir, '.project-manager', 'ROADMAP.md');
    assert.equal(fs.readFileSync(roadmapPath, 'utf8'), before, '--next must not write ROADMAP.md');
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.project-manager', 'dashboard.html')),
      '--next must not write dashboard.html'
    );
  });

  it('CLI --next prints the JSON literal null when nothing is eligible', () => {
    writeRoadmap(tmpDir, [{ item: 'Done', status: 'done' }]);
    const r = runCli(tmpDir, ['--next']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'null');
  });
});

describe('pm-update: dashboard generation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-update-'));
    writeRoadmap(tmpDir, [
      { item: 'Next thing', status: 'pending', priority: 'P0', slug: 'next-feature' },
      { item: 'Stuck thing', status: 'blocked', priority: 'P1' },
      { item: 'Shipped thing', status: 'done', priority: 'P2' },
    ]);
    const pmDir = path.join(tmpDir, '.project-manager');
    fs.writeFileSync(
      path.join(pmDir, 'STATUS.md'),
      [
        '---',
        'updated: "2026-08-10"',
        '---',
        '',
        '## In flight',
        '',
        '- Next thing is being built',
        '- Escaping probe: <script>alert(1)</script>',
        '',
        '## Blocked',
        '',
        '- **Stuck thing** — waiting on upstream API keys',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(pmDir, 'DECISIONS.md'),
      [
        '# Decisions',
        '',
        '## 2026-08-09 — Adopted the mechanical updater',
        '',
        'One script owns the mapping.',
        '',
      ].join('\n')
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('byte-identical across repeated runs on unchanged input', () => {
    const h1 = generateDashboard(tmpDir);
    const h2 = generateDashboard(tmpDir);
    assert.equal(typeof h1, 'string');
    assert.equal(h1, h2);
  });

  it('populates all seven PM: sections', () => {
    const html = generateDashboard(tmpDir);
    assert.ok(html.includes('Test Project'), 'PM:PROJECT');
    assert.ok(html.includes('Last synced 2026-08-10'), 'PM:UPDATED');
    assert.ok(html.includes('Next thing'), 'PM:NEXT');
    assert.ok(html.includes('Next thing is being built'), 'PM:INFLIGHT');
    assert.ok(html.includes('M1 — Test milestone'), 'PM:MILESTONES card');
    assert.ok(html.includes('waiting on upstream API keys'), 'PM:BLOCKERS reason');
    assert.ok(html.includes('Adopted the mechanical updater'), 'PM:DECISIONS title');
    assert.ok(!html.includes('<!-- PM:'), 'no placeholder comments remain');
  });

  it('self-contained: no external references, no scripts from state content', () => {
    const html = generateDashboard(tmpDir);
    assert.ok(!/https?:\/\//.test(html), 'no http/https references');
    assert.ok(!html.includes('<script'), 'no script tags');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'state content escaped');
  });

  it("PM:NEXT matches --next's item", () => {
    const html = generateDashboard(tmpDir);
    const r = runCli(tmpDir, ['--next']);
    const next = JSON.parse(r.stdout);
    assert.ok(
      html.includes(`<div class="item-name">${next.item}</div>`),
      'dashboard PM:NEXT shows the same item as --next'
    );
  });

  it('shows the empty state when nothing is eligible', () => {
    writeRoadmap(tmpDir, [{ item: 'Done', status: 'done' }]);
    const html = generateDashboard(tmpDir);
    assert.ok(html.includes('Nothing ready'), 'PM:NEXT empty state');
  });
});

describe('pm-update: dashboard Lanes panel', () => {
  let tmpDir;

  const laneData = {
    lanes: [
      {
        path: 'C:/repos/main',
        branch: 'main',
        isMain: true,
        features: [
          {
            name: 'feat-main',
            status: 'building',
            currentPhase: null,
            tasks: { done: 2, pending: 1, building: 0, total: 3 },
            files: ['src/shared.js'],
          },
        ],
      },
      {
        path: 'C:/repos/lanes/x',
        branch: 'feature/x',
        isMain: false,
        features: [
          { name: 'feat-x', status: 'planned', currentPhase: null, tasks: null, files: ['src/shared.js'] },
        ],
      },
    ],
    overlaps: [
      {
        file: 'src/shared.js',
        claims: [
          { lane: 'C:/repos/main', branch: 'main', feature: 'feat-main' },
          { lane: 'C:/repos/lanes/x', branch: 'feature/x', feature: 'feat-x' },
        ],
      },
    ],
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-lanes-'));
    writeRoadmap(tmpDir, [{ item: 'A', status: 'pending', slug: 'feat-main' }]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renders one row per active feature per lane, main labeled main', () => {
    const html = generateDashboard(tmpDir, laneData);
    assert.ok(html.includes('<td>main</td>'), 'main worktree labeled main');
    assert.ok(html.includes('feature/x @ C:/repos/lanes/x'), 'linked lane shows branch @ path');
    assert.ok(html.includes('feat-main'), 'main lane feature named');
    assert.ok(html.includes('feat-x'), 'linked lane feature named');
    assert.ok(html.includes('2/3'), 'task progress rendered done/total');
    assert.ok(!html.includes('<!-- PM:LANES -->'), 'placeholder replaced');
  });

  it('renders one warning line per overlap', () => {
    const html = generateDashboard(tmpDir, laneData);
    assert.ok(
      html.includes('src/shared.js claimed by feat-main@C:/repos/main and feat-x@C:/repos/lanes/x'),
      'overlap warning names the file and both claims'
    );
  });

  it('null lanes → No lanes recorded', () => {
    const html = generateDashboard(tmpDir, null);
    assert.ok(html.includes('No lanes recorded'), 'null sweep shows the empty state');
    assert.ok(!html.includes('<!-- PM:LANES -->'), 'placeholder still replaced');
    const omitted = generateDashboard(tmpDir);
    assert.ok(omitted.includes('No lanes recorded'), 'absent parameter behaves like null');
  });

  it('determinism: identical inputs → byte-identical output', () => {
    const h1 = generateDashboard(tmpDir, laneData);
    const h2 = generateDashboard(tmpDir, laneData);
    assert.equal(h1, h2);
  });
});

describe('pm-update: CLI no-op and idempotence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-update-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('absent .project-manager/ → exit 0, no output, no writes', () => {
    const r = runCli(tmpDir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.project-manager')), 'directory not created');
  });

  it('CLI applies updates, writes the dashboard, and a second run rewrites nothing', () => {
    createArchivedFeature(tmpDir, 'feat-a');
    writeRoadmap(tmpDir, [{ item: 'A', status: 'in-progress', slug: 'feat-a' }]);
    const roadmapPath = path.join(tmpDir, '.project-manager', 'ROADMAP.md');
    const dashPath = path.join(tmpDir, '.project-manager', 'dashboard.html');

    const first = runCli(tmpDir, ['feat-a']);
    assert.equal(first.status, 0);
    const afterFirst = fs.readFileSync(roadmapPath, 'utf8');
    assert.ok(afterFirst.includes('| A | done |'), 'row updated');
    assert.ok(fs.existsSync(dashPath), 'dashboard written');
    const dashFirst = fs.readFileSync(dashPath, 'utf8');

    const second = runCli(tmpDir, ['feat-a']);
    assert.equal(second.status, 0);
    assert.equal(
      fs.readFileSync(roadmapPath, 'utf8'),
      afterFirst,
      'second run leaves ROADMAP.md byte-identical — no updated bump without a status change'
    );
    assert.equal(fs.readFileSync(dashPath, 'utf8'), dashFirst, 'dashboard byte-identical');
  });
});

describe('pm-update: multi-worktree resolution', { skip: !gitAvailable }, () => {
  let base, repoDir, laneDir;

  beforeEach(() => {
    // realpath immediately: os.tmpdir() can be a short (8.3) or symlinked path.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-worktree-')));
    repoDir = path.join(base, 'repo');
    laneDir = path.join(base, 'lane');
    initRepo(repoDir);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('CLI from a linked worktree updates the MAIN root ROADMAP.md', () => {
    writeRoadmap(repoDir, [{ item: 'Lane thing', status: 'pending', slug: 'lane-feature' }]);
    git(repoDir, 'worktree', 'add', laneDir);
    // The feature lives in the lane's .planning/ — lane-local by design.
    createFeature(laneDir, 'lane-feature', 'built');

    const r = runCli(laneDir, ['lane-feature']);
    assert.equal(r.status, 0, r.stderr);

    const after = fs.readFileSync(path.join(repoDir, '.project-manager', 'ROADMAP.md'), 'utf8');
    assert.ok(after.includes('| Lane thing | in-progress |'), 'main root row flipped to in-progress');
    assert.ok(
      !fs.existsSync(path.join(laneDir, '.project-manager')),
      'lane must not grow a .project-manager/ of its own'
    );
    assert.ok(
      fs.existsSync(path.join(repoDir, '.project-manager', 'dashboard.html')),
      'dashboard regenerated at the main root'
    );
  });
});

describe('pm-update: atomic writes', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('successful CLI run leaves no orphan temp files', () => {
    createArchivedFeature(tmpDir, 'feat-a');
    writeRoadmap(tmpDir, [{ item: 'A', status: 'in-progress', slug: 'feat-a' }]);

    const r = runCli(tmpDir, ['feat-a']);
    assert.equal(r.status, 0);
    const pmDir = path.join(tmpDir, '.project-manager');
    const temps = fs.readdirSync(pmDir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(temps, [], 'no *.tmp-* files remain after a successful run');
  });

  it('writeFileAtomic writes the content and replaces an existing target', () => {
    const target = path.join(tmpDir, 'out.md');
    writeFileAtomic(target, 'first');
    assert.equal(fs.readFileSync(target, 'utf8'), 'first');
    writeFileAtomic(target, 'second');
    assert.equal(fs.readFileSync(target, 'utf8'), 'second', 'atomic replace over an existing file');
    const temps = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(temps, [], 'no temp file left behind');
  });

  it('target inside a nonexistent directory → throws, no temp left behind', () => {
    const missingDir = path.join(tmpDir, 'no-such-dir');
    assert.throws(() => writeFileAtomic(path.join(missingDir, 'out.md'), 'x'));
    assert.ok(!fs.existsSync(missingDir), 'nothing created on failure');
    const temps = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(temps, [], 'no stray temp in the parent either');
  });

  it('rename failure leaves the existing target untouched and removes the temp', () => {
    // A directory at the target path makes the rename fail on every
    // platform, after the temp write itself has succeeded.
    const target = path.join(tmpDir, 'occupied');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'marker.txt'), 'original');

    assert.throws(() => writeFileAtomic(target, 'clobber'));
    assert.equal(
      fs.readFileSync(path.join(target, 'marker.txt'), 'utf8'),
      'original',
      'existing target untouched on failure'
    );
    const temps = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(temps, [], 'temp removed after the failed rename');
  });
});
