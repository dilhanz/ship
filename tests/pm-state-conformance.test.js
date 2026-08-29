/**
 * Verifier-authored conformance checks (pm-capability-uplift).
 *
 * The pm-state skill documents a format; these tests assert that a real-shaped
 * `.project-manager/` state obeys it, and that the dashboard generated from
 * that state is genuinely offline and genuinely derived from it. A format
 * nobody can follow is a format that does not exist.
 *
 * The state under test is the committed fixture in `tests/fixtures/pm-state/`,
 * not this repo's own `.project-manager/`. The real state is gitignored — local,
 * per-repo working data present only on a machine that has run /ship:pm-sync —
 * so gating on it meant these blocks skipped on every clean checkout and the
 * release run stayed green while the assertions were red locally. The fixture
 * is committed, so the whole file runs everywhere with no skips.
 *
 * Its directory names are deliberately undotted (`pm-state`, `planning`):
 * `.gitignore` matches `.project-manager` and `.planning` as bare patterns at
 * any depth, so a dotted fixture directory would be silently untracked. The
 * files are copied into a temp `.project-manager/` at run time, and
 * `dashboard.html` is generated per run rather than committed — a committed
 * dashboard would go stale the first time rendering changed, which is exactly
 * the failure mode this suite exists to catch.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateDashboard, renderLedgerRow } = require('../ship/pm-update.cjs');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'pm-state');
const fixture = (rel) => path.join(fixtureRoot, rel);
const read = (rel) => fs.readFileSync(fixture(rel), 'utf8');

const STATE_FILES = ['ROADMAP.md', 'STATUS.md', 'DECISIONS.md', 'CONVENTIONS.md', 'LEDGER.md'];

/**
 * The fixture deliberately holds two table widths in one file: M1 carries the
 * enriched 11-column shape, M2 the narrower 7-column one. That is itself the
 * compatibility assertion — both parsers key off the header, so neither table
 * may inherit the other's layout.
 */
const HEADER = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';
const ENRICHED_HEADER =
  '| Item | Status | Priority | Size | Depends on | Source | Ship feature | Lane | Blast radius | Confidence | First seen |';

const LEDGER_HEADER =
  '| Feature | Shipped | Profile | Outcome | Verify | Verify note | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';

// The committed fixture is a *recorded* file, and no recorded row is ever
// rewritten to widen it — rows render to the file's own header. Pinning the
// fixture to the current default would assert the opposite of that contract,
// so the two headers deliberately differ: LEDGER_HEADER is what a rebuilt or
// brand-new ledger gets, FIXTURE_LEDGER_HEADER is what a ten-column file keeps.
const FIXTURE_LEDGER_HEADER =
  '| Feature | Shipped | Profile | Verify | Unresolved carried | Plan rounds | Fix rounds | Findings (C/H/M/L) | Phases | Artifacts |';

const VERIFY_VOCABULARY = ['PASS', 'FAIL', 'INCONCLUSIVE', 'DEFERRED', 'in-progress', 'unknown', 'none'];

/** Copy the fixture state into a throwaway `.project-manager/` and return its root. */
function stageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pm-fixture-'));
  const pmDir = path.join(root, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  for (const f of STATE_FILES) fs.copyFileSync(fixture(f), path.join(pmDir, f));
  return root;
}

function backlogRows(content) {
  const rows = [];
  let ctx = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) {
      if (t !== '') ctx = null;
      continue;
    }
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.includes('Item') && cells.includes('Status') && cells.includes('Ship feature')) {
      ctx = cells;
      continue;
    }
    if (!ctx) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push({ cells, header: ctx });
  }
  return rows;
}

/**
 * Parse LEDGER.md's single table into { cells, header } rows, by header name —
 * the same discipline every other reader of PM state uses.
 */
function ledgerRows(content) {
  const rows = [];
  let ctx = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) {
      if (t !== '') ctx = null;
      continue;
    }
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.includes('Feature') && cells.includes('Shipped') && cells.includes('Verify')) {
      ctx = cells;
      continue;
    }
    if (!ctx) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells.length !== ctx.length) continue;
    rows.push({ cells, header: ctx });
  }
  return rows;
}

describe('pm-state format — the committed fixture conforms', () => {
  let tmpRoot;
  let dashboard;

  before(() => {
    tmpRoot = stageFixture();
    dashboard = generateDashboard(tmpRoot, null);
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('every state file exists and is non-empty, and a dashboard generates from them', () => {
    for (const f of STATE_FILES) {
      assert.ok(fs.existsSync(fixture(f)), `${f} exists`);
      assert.ok(fs.statSync(fixture(f)).size > 0, `${f} is non-empty`);
    }
    assert.ok(dashboard && dashboard.length > 0, 'dashboard.html generates non-empty from the state');
  });

  it('ROADMAP.md carries frontmatter, both documented header widths, and at least one milestone', () => {
    const c = read('ROADMAP.md');
    assert.match(c, /^---\nproject: "[^"]+"\nupdated: "\d{4}-\d{2}-\d{2}"\n---/, 'frontmatter shape');
    assert.ok(c.includes(HEADER), 'exact documented core header');
    assert.ok(c.includes(ENRICHED_HEADER), 'exact documented enriched header');
    assert.match(c, /^### M\d+ — .+ \(status: (active|pending|done)\)$/m, 'milestone heading form');
    assert.match(c, /^Goal: .+$/m, 'milestone goal line');
  });

  it('every backlog row obeys the documented cell contract', () => {
    const c = read('ROADMAP.md');
    const rows = backlogRows(c);
    assert.ok(rows.length >= 1, 'roadmap has backlog rows');
    for (const { cells, header } of rows) {
      const label = cells[0];
      assert.equal(cells.length, header.length, `row "${label}" has header-width cells`);
      const at = (name) => cells[header.indexOf(name)];
      assert.match(at('Status'), /^(pending|in-progress|awaiting-merge|blocked|done)$/, `row "${label}" status enum`);
      assert.match(at('Priority'), /^P[0-3]$/, `row "${label}" priority is P0–P3`);
      assert.match(at('Size'), /^(S|M|L|XL|—)$/, `row "${label}" size is S/M/L/XL or em dash`);
      const source = at('Source');
      assert.ok(source && source !== '—' && source !== '-', `row "${label}" has a mandatory Source`);

      // Optional evidence columns: present only on the enriched table, and
      // constrained to the documented vocabulary wherever they appear.
      if (header.includes('Blast radius')) {
        assert.match(at('Blast radius'), /^(users|contributors|internal|—)$/, `row "${label}" blast radius vocabulary`);
      }
      if (header.includes('Confidence')) {
        assert.match(at('Confidence'), /^(proven|suspected|—)$/, `row "${label}" confidence vocabulary`);
      }
      if (header.includes('First seen')) {
        assert.match(at('First seen'), /^(\d{4}-\d{2}-\d{2}|—)$/, `row "${label}" first seen is a date or em dash`);
      }
    }
  });

  it('every Depends-on reference names a real backlog item', () => {
    const c = read('ROADMAP.md');
    const rows = backlogRows(c);
    const items = new Set(rows.map(({ cells }) => cells[0]));
    for (const { cells, header } of rows) {
      const dep = cells[header.indexOf('Depends on')];
      if (!dep || dep === '—' || dep === '-') continue;
      for (const d of dep.split(',').map((x) => x.trim())) {
        assert.ok(items.has(d), `"${cells[0]}" depends on "${d}", which is not a backlog item`);
      }
    }
  });

  it('every Ship feature slug is either — or resolves to a real feature directory', () => {
    // The fixture ships its own companion planning tree, so slug resolution is a
    // real check with nothing to skip: `planning/features/{slug}` for live work,
    // `planning/archive/{slug}` for shipped work, mirroring `.planning/`.
    const planning = path.join(fixtureRoot, 'planning');
    const c = read('ROADMAP.md');
    for (const { cells, header } of backlogRows(c)) {
      const slug = cells[header.indexOf('Ship feature')];
      if (!slug || slug === '—' || slug === '-') continue;
      const inFeatures = fs.existsSync(path.join(planning, 'features', slug));
      const inArchive = fs.existsSync(path.join(planning, 'archive', slug));
      assert.ok(inFeatures || inArchive, `slug "${slug}" resolves under the fixture's planning tree`);
    }
  });

  it('#### detail sections only name real backlog items (no orphan prose)', () => {
    const c = read('ROADMAP.md');
    const items = new Set(backlogRows(c).map(({ cells }) => cells[0]));
    const headings = [...c.matchAll(/^#### (.+)$/gm)].map((m) => m[1].trim());
    assert.ok(headings.length >= 1, 'the fixture exercises the detail-section convention');
    for (const h of headings) {
      const bare = h.replace(/`/g, '');
      const match = [...items].some((i) => i.replace(/`/g, '') === bare);
      assert.ok(match, `detail section "${h}" indexes a real backlog row`);
    }
  });

  it('STATUS.md has the five documented sections in order, plus an updated timestamp', () => {
    const c = read('STATUS.md');
    assert.match(c, /^---\nupdated: "\d{4}-\d{2}-\d{2}"\n---/, 'updated frontmatter');
    assert.match(c, /^# .+ — Status$/m, 'title form');
    const order = ['## In flight', '## Live status', '## Blocked', '## Recently shipped', '## Repo hygiene'];
    let cursor = -1;
    for (const s of order) {
      const at = c.indexOf(s);
      assert.ok(at !== -1, `STATUS.md has ${s}`);
      assert.ok(at > cursor, `${s} appears in documented order`);
      cursor = at;
    }
  });

  it('STATUS.md marks its PM-derived claims as unverified, per the never-invent-status rule', () => {
    const c = read('STATUS.md');
    assert.match(c, /unverified/i, 'unsettled claims are labelled');
    assert.match(c, /\/ship:pm-sync/, 'and name the next step that would settle them');
  });

  it('DECISIONS.md entries are dated, newest first, and within the 1–3 line body cap', () => {
    const c = read('DECISIONS.md');
    assert.match(c, /^# Decisions$/m, 'title');
    const entries = [...c.matchAll(/^## (\d{4}-\d{2}-\d{2}) — (.+)$/gm)];
    assert.ok(entries.length >= 1, 'at least one decision recorded');

    const dates = entries.map((e) => e[1]);
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted, 'entries are newest first');

    const titles = entries.map((e) => e[2]);
    assert.equal(new Set(titles).size, titles.length, 'same-day entries have distinct titles');
    for (const t of titles) assert.ok(!/\(latest\)/i.test(t), `title "${t}" avoids "(latest)"`);

    const bodies = c.split(/^## \d{4}-\d{2}-\d{2} — .+$/m).slice(1);
    for (let i = 0; i < bodies.length; i++) {
      const lines = bodies[i].trim().split('\n').filter((l) => l.trim() !== '');
      assert.ok(lines.length >= 1 && lines.length <= 3, `entry "${titles[i]}" body is 1–3 lines (got ${lines.length})`);
    }
  });

  it('CONVENTIONS.md is a titled flat bullet list, not prose', () => {
    const c = read('CONVENTIONS.md');
    assert.match(c, /^# Conventions$/m, 'title');
    const bullets = c.split('\n').filter((l) => l.startsWith('- '));
    assert.ok(bullets.length >= 3, 'carries real conventions');
    for (const l of c.split('\n')) {
      if (l.trim() === '' || l.startsWith('# ') || l.startsWith('- ') || l.startsWith('  ')) continue;
      assert.fail(`CONVENTIONS.md should be a flat bullet list; found: "${l}"`);
    }
  });
});

describe('LEDGER.md — the committed fixture obeys the harvested format', () => {
  const content = read('LEDGER.md');
  const rows = ledgerRows(content);

  it('carries the frontmatter, the never-hand-edited note, and the exact ten-column header', () => {
    assert.match(content, /^---\nupdated: "\d{4}-\d{2}-\d{2}"\n---/, 'updated frontmatter');
    assert.match(content, /^# Ledger$/m, 'title');
    assert.match(content, /never hand-edited/, 'the append-only note travels with the file');
    assert.ok(content.includes(FIXTURE_LEDGER_HEADER), 'exact recorded ten-column header');
    assert.ok(rows.length >= 3, 'the fixture exercises several verdicts');
  });

  it('every Verify cell is in the documented vocabulary, and the fixture covers PASS, INCONCLUSIVE, and none', () => {
    const verdicts = rows.map(({ cells, header }) => cells[header.indexOf('Verify')]);
    for (const v of verdicts) {
      assert.ok(VERIFY_VOCABULARY.includes(v), `verdict "${v}" is in the documented vocabulary`);
    }
    for (const required of ['PASS', 'INCONCLUSIVE', 'none']) {
      assert.ok(verdicts.includes(required), `the fixture records at least one ${required} row`);
    }
  });

  it('every Findings cell renders as C/H/M/L and every count cell is a number', () => {
    for (const { cells, header } of rows) {
      const at = (name) => cells[header.indexOf(name)];
      const label = cells[0];
      assert.match(at('Findings (C/H/M/L)'), /^\d+\/\d+\/\d+\/\d+$/, `row "${label}" findings rendering`);
      for (const col of ['Unresolved carried', 'Fix rounds', 'Phases']) {
        assert.match(at(col), /^\d+$/, `row "${label}" ${col} is a count`);
      }
      assert.match(at('Plan rounds'), /^(\d+|unknown)$/, `row "${label}" plan rounds is a count or unknown`);
      assert.match(at('Shipped'), /^\d{4}-\d{2}-\d{2}$/, `row "${label}" shipped is a date`);
    }
  });

  it('every Artifacts cell is four tokens in CONTEXT/PLAN/REVIEW/VERIFY order, never a bare dash', () => {
    const order = ['CONTEXT.md', 'PLAN.md', 'REVIEW.md', 'VERIFY.md'];
    let sawAbsent = false;
    for (const { cells, header } of rows) {
      const label = cells[0];
      const cell = cells[header.indexOf('Artifacts')];
      assert.ok(cell !== '—' && cell !== '-' && cell !== '', `row "${label}" artifacts cell is never a bare dash`);
      const tokens = cell.split('; ');
      assert.equal(tokens.length, 4, `row "${label}" names all four artifacts`);
      for (let i = 0; i < 4; i++) {
        const t = tokens[i];
        const clean = t === order[i];
        const qualified = t.startsWith(`${order[i]} (`) && t.endsWith(')');
        const absent = t === `no ${order[i]}`;
        assert.ok(clean || qualified || absent,
          `row "${label}" token ${i + 1} ("${t}") is ${order[i]}, ${order[i]} + a qualifier, or "no ${order[i]}"`);
        if (absent || qualified) sawAbsent = true;
      }
    }
    assert.ok(sawAbsent, 'the fixture exercises the missing-artifact rendering');
  });

  it('no Feature value repeats — the ledger is keyed on slug', () => {
    const slugs = rows.map(({ cells, header }) => cells[header.indexOf('Feature')]);
    assert.equal(new Set(slugs).size, slugs.length, 'every slug appears once');
  });

  it('the documented header matches the one renderLedgerRow actually produces', () => {
    // Render a record whose every value *is* its column name: the resulting row
    // is the header if and only if the code emits the documented columns in the
    // documented order. A reordering or a renamed column breaks this, not a test
    // that merely counts cells.
    const asHeader = renderLedgerRow({
      slug: 'Feature',
      shipped: 'Shipped',
      profile: 'Profile',
      outcome: 'Outcome',
      verify: 'Verify',
      verifyNote: 'Verify note',
      unresolvedCarried: 'Unresolved carried',
      planRounds: 'Plan rounds',
      fixRounds: 'Fix rounds',
      findings: { critical: 'Findings (C', high: 'H', medium: 'M', low: 'L)' },
      phases: 'Phases',
      artifacts: ['Artifacts']
    });
    assert.equal(asHeader, LEDGER_HEADER, 'renderLedgerRow emits the documented columns in order');
  });

  it('skills/pm-state/SKILL.md documents the same ledger and enriched-roadmap headers the code and fixture use', () => {
    const skill = fs.readFileSync(path.join(repoRoot, 'skills', 'pm-state', 'SKILL.md'), 'utf8');
    assert.ok(skill.includes(LEDGER_HEADER), 'pm-state documents the exact ledger header');
    assert.ok(skill.includes(ENRICHED_HEADER), 'pm-state documents the exact enriched backlog header');
    assert.ok(read('ROADMAP.md').includes(ENRICHED_HEADER), 'the fixture carries the documented enriched header');
  });

  it('the ledger is staged with the rest of the state files', () => {
    const root = stageFixture();
    try {
      assert.ok(fs.existsSync(path.join(root, '.project-manager', 'LEDGER.md')), 'stageFixture copies LEDGER.md');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dashboard.html — offline and derived from state', () => {
  let tmpRoot;
  let dashboard;

  before(() => {
    tmpRoot = stageFixture();
    dashboard = generateDashboard(tmpRoot, null);
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('contains no external reference of any kind and no JavaScript', () => {
    const c = dashboard;
    for (const bad of ['http://', 'https://', '@import', 'url(', '<iframe', '<script', '<link', 'srcset']) {
      assert.ok(!c.toLowerCase().includes(bad.toLowerCase()), `dashboard has no ${bad}`);
    }
    assert.ok(!/\son\w+\s*=/i.test(c), 'no inline event handlers');
  });

  it('every PM: placeholder was replaced', () => {
    assert.ok(!/<!--\s*PM:/.test(dashboard), 'no unreplaced placeholder comments remain');
  });

  it('renders the project name, every milestone, and every backlog item from ROADMAP.md', () => {
    const dash = dashboard;
    const roadmap = read('ROADMAP.md');

    const project = roadmap.match(/^project: "([^"]+)"$/m)[1];
    assert.ok(dash.includes(project), 'project name rendered');

    const updated = roadmap.match(/^updated: "([^"]+)"$/m)[1];
    assert.ok(dash.includes(updated), 'updated timestamp rendered');

    for (const m of roadmap.matchAll(/^### M\d+ — (.+?) \(status: /gm)) {
      assert.ok(dash.includes(m[1]), `milestone "${m[1]}" rendered`);
    }
    // The dashboard renders inline `code` spans as <code> elements, so compare
    // against the tag-stripped text rather than the raw HTML.
    const dashText = dash.replace(/<[^>]+>/g, '');
    for (const { cells } of backlogRows(roadmap)) {
      const item = cells[0].replace(/`/g, '');
      assert.ok(dashText.includes(item), `backlog item "${item}" rendered`);
    }
  });

  it('renders STATUS.md in-flight work rather than the absent-state fallback', () => {
    assert.ok(dashboard.includes('In flight'), 'in-flight section present');
    assert.ok(
      !dashboard.includes('No in-flight work recorded'),
      'STATUS.md has in-flight entries, so the fallback must not be used'
    );
  });

  it('has balanced structural tags (parses as a coherent document)', () => {
    const c = dashboard;
    // `code` is in the list because an inline() regex that opens a span it never
    // closes is the likeliest way code-span rendering corrupts the document, and
    // the tag-stripped item comparison above would pass either way.
    for (const tag of ['html', 'head', 'body', 'style', 'section', 'div', 'code']) {
      const open = (c.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
      const close = (c.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      assert.equal(open, close, `<${tag}> tags are balanced`);
    }
  });
});
