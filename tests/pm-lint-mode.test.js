// `--lint` — the three axes of PM state-file decay: over-cap `Source` cells,
// undeclared STATUS.md frontmatter keys, and narrative above the first
// declared section.
//
// Like `--next`, `--evidence` and `--debt` this is a query: it prints JSON and
// writes nothing. Fixtures are built inline so nothing here depends on this
// repo's own (gitignored) .project-manager/ — with one deliberate exception,
// the real-roadmap case, which skips when that directory is absent.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { lintState, SOURCE_CAP } = require(SCRIPT_PATH);

/** Spawn the CLI in a given cwd, return { status, stdout, stderr }. */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function tmpRepo(prefix = 'ship-lint-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const HEADERS = ['Item', 'Status', 'Priority', 'Depends on', 'Source', 'Ship feature'];
const NO_SOURCE_HEADERS = ['Item', 'Status', 'Priority', 'Depends on', 'Ship feature'];

/** A ROADMAP.md around one backlog table. */
function roadmap(headers, rows, milestone = 'M1 — Test') {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`)
  ];
  return `---\nproject: "Test"\nupdated: "2026-01-01"\n---\n\n### ${milestone} (status: active)\n\n${lines.join('\n')}\n`;
}

const WELL_FORMED_STATUS = [
  '---',
  'updated: "2026-01-01"',
  '---',
  '',
  '# Test — Status',
  '',
  '## In flight',
  '',
  'Nothing.',
  '',
  '## Live status',
  '',
  'Fine.',
  ''
].join('\n');

describe('lintState — Source soft cap', () => {
  it('the cap is 240 characters', () => {
    assert.equal(SOURCE_CAP, 240);
  });

  it('a cell exactly at the cap is not reported', () => {
    const source = 'x'.repeat(SOURCE_CAP);
    const content = roadmap(HEADERS, [['A', 'pending', 'P2', '—', source, '—']]);
    assert.deepEqual(lintState(content, null).sourceOverCap, []);
  });

  it('a cell one character over the cap is reported with its true length', () => {
    const source = 'x'.repeat(SOURCE_CAP + 1);
    const content = roadmap(HEADERS, [['A', 'pending', 'P2', '—', source, '—']]);
    const found = lintState(content, null).sourceOverCap;
    assert.equal(found.length, 1);
    assert.equal(found[0].length, SOURCE_CAP + 1);
    assert.equal(found[0].source, source);
  });

  it('the item and milestone are named', () => {
    const source = 'y'.repeat(SOURCE_CAP + 50);
    const content = roadmap(HEADERS, [['Fix the thing', 'pending', 'P1', '—', source, 'slug']], 'M2 — Hardening');
    const found = lintState(content, null).sourceOverCap;
    assert.equal(found.length, 1);
    assert.equal(found[0].item, 'Fix the thing');
    assert.equal(found[0].milestone, 'M2 — Hardening');
  });

  it('a table with no Source column contributes nothing', () => {
    const content = roadmap(NO_SOURCE_HEADERS, [['A', 'pending', 'P2', '—', '—']]);
    assert.deepEqual(lintState(content, null).sourceOverCap, []);
  });

  it('only the over-cap rows are reported, in document order', () => {
    const long = 'z'.repeat(SOURCE_CAP + 1);
    const content = roadmap(HEADERS, [
      ['A', 'pending', 'P2', '—', 'short', '—'],
      ['B', 'pending', 'P2', '—', long, '—'],
      ['C', 'pending', 'P2', '—', long, '—']
    ]);
    assert.deepEqual(lintState(content, null).sourceOverCap.map(e => e.item), ['B', 'C']);
  });
});

describe('lintState — STATUS.md frontmatter keys', () => {
  it('an undeclared key is reported and `updated` is not', () => {
    const status = '---\nupdated: "2026-01-01"\nowner: "someone"\n---\n\n# Test — Status\n\n## In flight\n';
    const found = lintState(null, status).statusUndeclaredKeys;
    assert.deepEqual(found, [{ key: 'owner' }]);
  });

  it('several undeclared keys are each reported once', () => {
    const status = '---\nupdated: "2026-01-01"\nowner: "a"\nphase: "b"\n---\n\n# Test — Status\n';
    assert.deepEqual(lintState(null, status).statusUndeclaredKeys.map(e => e.key), ['owner', 'phase']);
  });

  it('indented continuation lines and comments are not keys', () => {
    const status = '---\nupdated: "2026-01-01"\n# a comment: here\nlanes:\n  main: "x"\n---\n\n# Test — Status\n';
    assert.deepEqual(lintState(null, status).statusUndeclaredKeys.map(e => e.key), ['lanes']);
  });

  it('a STATUS.md with no frontmatter reports no keys', () => {
    const status = '# Test — Status\n\n## In flight\n\nNothing.\n';
    assert.deepEqual(lintState(null, status).statusUndeclaredKeys, []);
  });
});

describe('lintState — narrative before the first section', () => {
  it('prose between the H1 and the first section is reported with its line number', () => {
    const status = '---\nupdated: "2026-01-01"\n---\n\n# Test — Status\n\nnarrative that belongs in a section\n\n## In flight\n';
    const found = lintState(null, status).statusNarrativeBeforeSections;
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 7);
    assert.equal(found[0].text, 'narrative that belongs in a section');
  });

  it('the H1 title and blank lines are never narrative', () => {
    const status = '---\nupdated: "2026-01-01"\n---\n\n# Test — Status\n\n\n## In flight\n';
    assert.deepEqual(lintState(null, status).statusNarrativeBeforeSections, []);
  });

  it('nothing after the first section heading is reported', () => {
    const status = '---\nupdated: "2026-01-01"\n---\n\n# Test — Status\n\n## In flight\n\nprose that is correctly inside a section\n';
    assert.deepEqual(lintState(null, status).statusNarrativeBeforeSections, []);
  });

  it('narrative is truncated to 120 characters', () => {
    const long = 'w'.repeat(200);
    const status = `---\nupdated: "2026-01-01"\n---\n\n# Test — Status\n\n${long}\n\n## In flight\n`;
    const found = lintState(null, status).statusNarrativeBeforeSections;
    assert.equal(found.length, 1);
    assert.equal(found[0].text.length, 120);
  });

  it('a file with no frontmatter still finds narrative above the first section', () => {
    const status = '# Test — Status\n\nstray line\n\n## In flight\n';
    const found = lintState(null, status).statusNarrativeBeforeSections;
    assert.deepEqual(found.map(e => e.text), ['stray line']);
  });
});

describe('lintState — clean and degraded inputs', () => {
  it('a well-formed pair reports all three arrays empty', () => {
    const content = roadmap(HEADERS, [['A', 'pending', 'P2', '—', 'DECISIONS.md 2026-01-01', '—']]);
    assert.deepEqual(lintState(content, WELL_FORMED_STATUS), {
      sourceOverCap: [],
      statusUndeclaredKeys: [],
      statusNarrativeBeforeSections: []
    });
  });

  it('null, undefined and non-string arguments degrade to empty arrays', () => {
    for (const args of [[null, null], [undefined, undefined], [42, {}], ['', '']]) {
      const r = lintState(args[0], args[1]);
      assert.deepEqual(r.sourceOverCap, []);
      assert.deepEqual(r.statusUndeclaredKeys, []);
      assert.deepEqual(r.statusNarrativeBeforeSections, []);
    }
  });

  it('an absent file on one axis does not suppress the other', () => {
    const status = '---\nupdated: "2026-01-01"\nowner: "x"\n---\n\n# Test — Status\n';
    assert.deepEqual(lintState(null, status).statusUndeclaredKeys, [{ key: 'owner' }]);
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

/** A repo where a normal run would write a stamp, a reconcile and a dashboard. */
function lintRepo() {
  const dir = tmpRepo();
  const pm = path.join(dir, '.project-manager');
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, 'ROADMAP.md'), roadmap(HEADERS, [
    ['Ship beta', 'pending', 'P2', '—', 'x'.repeat(SOURCE_CAP + 1), 'beta']
  ]));
  fs.writeFileSync(path.join(pm, 'STATUS.md'), '---\nupdated: "2026-01-01"\nowner: "x"\n---\n\n# Test — Status\n\nstray\n\n## In flight\n');

  const active = path.join(dir, '.planning', 'features', 'beta');
  fs.mkdirSync(active, { recursive: true });
  fs.writeFileSync(path.join(active, 'CONTEXT.md'), '---\nfeature: "beta"\nstatus: building\n---\n\n## Problem\n');
  return dir;
}

describe('--lint — the CLI query mode', () => {
  it('prints valid JSON with all three axes and exits 0', () => {
    const dir = lintRepo();
    const res = runCli(dir, ['--lint']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.sourceOverCap.length, 1);
    assert.equal(parsed.sourceOverCap[0].item, 'Ship beta');
    assert.deepEqual(parsed.statusUndeclaredKeys, [{ key: 'owner' }]);
    assert.equal(parsed.statusNarrativeBeforeSections.length, 1);
  });

  it('writes nothing at all', () => {
    const dir = lintRepo();
    const before = snapshot(dir);
    const res = runCli(dir, ['--lint']);
    assert.equal(res.status, 0, res.stderr);
    // No roadmap edit, no lane stamp, no ledger append, no dashboard.
    assert.deepEqual(snapshot(dir), before);
  });

  it('combined with a slug argument it still writes nothing', () => {
    const dir = lintRepo();
    const before = snapshot(dir);
    const res = runCli(dir, ['--lint', 'beta']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(snapshot(dir), before);
    JSON.parse(res.stdout);
  });

  it('a STATUS.md with no ROADMAP.md still lints', () => {
    // The roadmap early-exit sits below this branch; a directory carrying only
    // a STATUS.md must still get an answer.
    const dir = tmpRepo();
    const pm = path.join(dir, '.project-manager');
    fs.mkdirSync(pm, { recursive: true });
    fs.writeFileSync(path.join(pm, 'STATUS.md'), '---\nupdated: "2026-01-01"\nowner: "x"\n---\n\n# Test — Status\n');
    const before = snapshot(dir);
    const res = runCli(dir, ['--lint']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.deepEqual(parsed.sourceOverCap, []);
    assert.deepEqual(parsed.statusUndeclaredKeys, [{ key: 'owner' }]);
    assert.deepEqual(snapshot(dir), before);
  });

  it('an absent .project-manager/ prints three empty arrays and exits 0', () => {
    const dir = tmpRepo();
    const res = runCli(dir, ['--lint']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      sourceOverCap: [],
      statusUndeclaredKeys: [],
      statusNarrativeBeforeSections: []
    });
    assert.deepEqual(snapshot(dir), {});
  });

  it("this repo's own ROADMAP.md has no over-cap Source", { skip: !fs.existsSync(path.join(__dirname, '..', '.project-manager', 'ROADMAP.md')) }, () => {
    // The directory is gitignored, so CI has none — the case is skipped there.
    const content = fs.readFileSync(path.join(__dirname, '..', '.project-manager', 'ROADMAP.md'), 'utf8');
    assert.deepEqual(lintState(content, null).sourceOverCap, []);
  });
});
