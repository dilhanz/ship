/**
 * Verifier-authored conformance checks (pm-capability-uplift).
 *
 * The pm-state skill documents a format; these tests assert the dogfooded
 * `.project-manager/` state in this repo actually obeys it, and that the
 * generated dashboard is genuinely offline and genuinely derived from state.
 * A format nobody can follow is a format that does not exist.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pm = (rel) => path.join(repoRoot, '.project-manager', rel);
const read = (rel) => fs.readFileSync(pm(rel), 'utf8');

const HEADER = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';

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

describe('dogfood — .project-manager/ conforms to the pm-state format', () => {
  it('all five state files exist and are non-empty', () => {
    for (const f of ['ROADMAP.md', 'STATUS.md', 'DECISIONS.md', 'CONVENTIONS.md', 'dashboard.html']) {
      assert.ok(fs.existsSync(pm(f)), `${f} exists`);
      assert.ok(fs.statSync(pm(f)).size > 0, `${f} is non-empty`);
    }
  });

  it('ROADMAP.md carries frontmatter, the exact 7-column header, and at least one milestone', () => {
    const c = read('ROADMAP.md');
    assert.match(c, /^---\nproject: "[^"]+"\nupdated: "\d{4}-\d{2}-\d{2}"\n---/, 'frontmatter shape');
    assert.ok(c.includes(HEADER), 'exact documented header');
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
      assert.match(at('Status'), /^(pending|in-progress|blocked|done)$/, `row "${label}" status enum`);
      assert.match(at('Priority'), /^P[0-3]$/, `row "${label}" priority is P0–P3`);
      assert.match(at('Size'), /^(S|M|L|XL|—)$/, `row "${label}" size is S/M/L/XL or em dash`);
      const source = at('Source');
      assert.ok(source && source !== '—' && source !== '-', `row "${label}" has a mandatory Source`);
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

  it('every Ship feature slug is either — or resolves to a real feature directory', (t) => {
    // `.planning/` is gitignored in this repo, so a clean checkout (CI, a fresh
    // clone) has no planning state to resolve against. pm-state's status mapping
    // table treats that case as "unchanged — `.planning/` may be gitignored or
    // pruned", not as an error, so this check only runs where the state exists.
    if (!fs.existsSync(path.join(repoRoot, '.planning'))) {
      t.skip('no .planning/ in this checkout — slugs are unresolvable, per pm-state');
      return;
    }
    const c = read('ROADMAP.md');
    for (const { cells, header } of backlogRows(c)) {
      const slug = cells[header.indexOf('Ship feature')];
      if (!slug || slug === '—' || slug === '-') continue;
      const inFeatures = fs.existsSync(path.join(repoRoot, '.planning', 'features', slug));
      const inArchive = fs.existsSync(path.join(repoRoot, '.planning', 'archive', slug));
      assert.ok(inFeatures || inArchive, `slug "${slug}" resolves under .planning/`);
    }
  });

  it('#### detail sections only name real backlog items (no orphan prose)', () => {
    const c = read('ROADMAP.md');
    const items = new Set(backlogRows(c).map(({ cells }) => cells[0]));
    const headings = [...c.matchAll(/^#### (.+)$/gm)].map((m) => m[1].trim());
    assert.ok(headings.length >= 1, 'the dogfood exercises the detail-section convention');
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

describe('dogfood — dashboard.html is offline and derived from state', () => {
  it('contains no external reference of any kind and no JavaScript', () => {
    const c = read('dashboard.html');
    for (const bad of ['http://', 'https://', '@import', 'url(', '<iframe', '<script', '<link', 'srcset']) {
      assert.ok(!c.toLowerCase().includes(bad.toLowerCase()), `dashboard has no ${bad}`);
    }
    assert.ok(!/\son\w+\s*=/i.test(c), 'no inline event handlers');
  });

  it('every PM: placeholder was replaced', () => {
    const c = read('dashboard.html');
    assert.ok(!/<!--\s*PM:/.test(c), 'no unreplaced placeholder comments remain');
  });

  it('renders the project name, every milestone, and every backlog item from ROADMAP.md', () => {
    const dash = read('dashboard.html');
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
    const dash = read('dashboard.html');
    assert.ok(dash.includes('In flight'), 'in-flight section present');
    assert.ok(
      !dash.includes('No in-flight work recorded'),
      'STATUS.md has in-flight entries, so the fallback must not be used'
    );
  });

  it('has balanced structural tags (parses as a coherent document)', () => {
    const c = read('dashboard.html');
    for (const tag of ['html', 'head', 'body', 'style', 'section', 'div']) {
      const open = (c.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
      const close = (c.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      assert.equal(open, close, `<${tag}> tags are balanced`);
    }
  });
});
