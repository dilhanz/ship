// Adversarial tests for ship/pm-update.cjs — boundary shapes, hostile state
// content, and write-failure error handling. Complements tests/pm-update.test.js
// (happy path + documented rules) by attacking the assumptions the script makes
// about line endings, row layout, slug values, and writability.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { parseRoadmap, applyStatusUpdates, selectNext, generateDashboard } = require(SCRIPT_PATH);

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
}

function createFeature(tmpDir, name, status) {
  const dir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), `---\nfeature: "${name}"\nstatus: ${status}\n---\n`);
}

function pmWrite(tmpDir, file, content) {
  const dir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmu-adv-'));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

describe('pm-update adversarial — line endings and row layout', () => {
  // KNOWN BUG: applyStatusUpdates locates the frontmatter with /^---\n...\n---/,
  // which never matches a CRLF file, so the `updated` value silently stays stale
  // while the Status cells do update. This repo checks out with core.autocrlf=true,
  // so a ROADMAP.md that has ever passed through git on Windows hits this.
  it('CRLF roadmap: status cell is edited and the frontmatter updated line still bumps', { todo: 'frontmatter bump does not handle CRLF' }, () => {
    const lf = [
      '---',
      'project: "Ship"',
      'updated: "2020-01-01"',
      '---',
      '',
      '### M1 — Core (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | feat-a |'
    ].join('\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    createFeature(tmp, 'feat-a', 'building');

    const { content, changed } = applyStatusUpdates(crlf, tmp, ['feat-a']);
    assert.equal(changed, true, 'status cell should change on a CRLF file');
    assert.match(content, /\|\s*in-progress\s*\|/, 'status cell rewritten');
    assert.match(
      content,
      /^updated: "\d{4}-\d{2}-\d{2}"/m,
      'frontmatter updated must bump on a CRLF roadmap too'
    );
    assert.doesNotMatch(content, /updated: "2020-01-01"/, 'stale updated value must not survive');
  });

  it('indented and padded rows keep every non-Status byte identical', () => {
    const before = [
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '|   Wide   Item   |    pending     |   P0   |   —   |   feat-a   |'
    ].join('\n');
    createFeature(tmp, 'feat-a', 'built');

    const { content } = applyStatusUpdates(before, tmp, []);
    const after = content.split('\n')[2];
    const segsBefore = before.split('\n')[2].split('|');
    const segsAfter = after.split('|');
    assert.equal(segsAfter.length, segsBefore.length);
    for (let i = 0; i < segsBefore.length; i++) {
      if (i === 2) continue; // the Status segment is the one permitted edit
      assert.equal(segsAfter[i], segsBefore[i], `segment ${i} must be byte-identical`);
    }
    assert.equal(segsAfter[2], ' in-progress ');
  });

  it('a row whose cell count differs from its header is left untouched', () => {
    const before = [
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Broken | pending | P0 | — |',
      '| Good | pending | P0 | — | feat-a |'
    ].join('\n');
    createFeature(tmp, 'feat-a', 'building');

    const { content } = applyStatusUpdates(before, tmp, []);
    const lines = content.split('\n');
    assert.equal(lines[2], '| Broken | pending | P0 | — |', 'malformed row untouched');
    assert.match(lines[3], /in-progress/, 'well-formed row still updated');
  });

  it('a roadmap with no frontmatter still updates rows without throwing', () => {
    const before = [
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | feat-a |'
    ].join('\n');
    createFeature(tmp, 'feat-a', 'building');
    const { content, changed } = applyStatusUpdates(before, tmp, []);
    assert.equal(changed, true);
    assert.match(content, /in-progress/);
  });

  // KNOWN BUG: mappedStatus path.joins the raw slug cell under .planning/archive/,
  // so a slug containing `..` resolves outside the feature tree and any existing
  // directory marks the row `done`. Reads only — no write escapes the repo.
  it('a slug containing path separators cannot escape .planning/ and match a directory', { todo: 'slug is not validated before path.join' }, () => {
    // ../.. would resolve to the tmp parent; the row must stay unchanged rather
    // than being marked done because some unrelated directory happens to exist.
    const before = [
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | ../.. |'
    ].join('\n');
    const { content, changed } = applyStatusUpdates(before, tmp, []);
    assert.equal(changed, false, 'traversal slug must not resolve to a status');
    assert.equal(content, before);
  });
});

describe('pm-update adversarial — hostile state content in the dashboard', () => {
  it('escapes markup from every state file and emits no script tag or external reference', () => {
    pmWrite(tmp, 'ROADMAP.md', [
      '---',
      'project: "<script>alert(1)</script>"',
      'updated: "2026-01-01"',
      '---',
      '',
      '### <img src=x onerror=alert(1)> (status: active)',
      '',
      'Goal: pwn "quotes" & <b>bold</b>.',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| <script>x</script> | pending | P1 | — | — |',
      '| Bad | blocked | P0 | — | — |'
    ].join('\n'));
    pmWrite(tmp, 'STATUS.md', [
      '## In flight',
      '',
      '- <script>inflight</script> at http://evil.example.com',
      '',
      '## Blocked',
      '',
      '- **Bad** — see https://evil.example.com'
    ].join('\n'));
    pmWrite(tmp, 'DECISIONS.md', [
      '## 2026-01-02 — <script>title</script>',
      '',
      'Body with <iframe src="https://evil.example.com"></iframe>.'
    ].join('\n'));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');
    assert.doesNotMatch(html, /<script/i, 'no script tag may reach the output');
    assert.doesNotMatch(html, /<iframe/i, 'no iframe may reach the output');
    // The dashboard must fetch nothing: no attribute may point at a remote URL.
    // (A URL that state files carry as prose survives as escaped *text* — inert,
    // but it does mean a bare `http://` substring check is not a self-containment
    // proof once state content is hostile.)
    assert.doesNotMatch(html, /(src|href|action|data)\s*=\s*["']?https?:/i, 'no external reference is fetched');
    assert.match(html, /&lt;script&gt;/, 'hostile markup appears escaped');
  });

  it('a state value containing a PM placeholder comment cannot inject a later section', () => {
    pmWrite(tmp, 'ROADMAP.md', [
      '---',
      'project: "P <!-- PM:DECISIONS -->"',
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | — |'
    ].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html);
    assert.doesNotMatch(html, /<!-- PM:/, 'no placeholder comment survives in the output');
  });

  it('a $-pattern in state content is emitted literally, not interpreted by replace', () => {
    pmWrite(tmp, 'ROADMAP.md', [
      '---',
      "project: \"$' $` $& cost\"",
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | — |'
    ].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html.includes("$&#39; $` $&amp; cost"), 'dollar patterns emitted literally');
  });

  it('generation is byte-identical across runs even with a completely empty state dir', () => {
    pmWrite(tmp, 'ROADMAP.md', '');
    const a = generateDashboard(tmp);
    const b = generateDashboard(tmp);
    assert.equal(a, b);
    assert.ok(a.includes('Nothing ready'), 'empty state falls back to the documented empty text');
  });
});

describe('pm-update adversarial — selection edge cases', () => {
  it('a dependency name differing only by case is treated as unmet', () => {
    const rows = parseRoadmap([
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Alpha | done | P0 | — | — |',
      '| B | pending | P0 | alpha | — |'
    ].join('\n'));
    assert.equal(selectNext(rows), null, 'case-mismatched dependency must not admit the row');
  });

  it('multiple dependencies require every one to be done', () => {
    const rows = parseRoadmap([
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | done | P0 | — | — |',
      '| B | pending | P3 | — | — |',
      '| C | pending | P0 | A, B | — |'
    ].join('\n'));
    const next = selectNext(rows);
    assert.equal(next.item, 'B', 'C has an unmet dependency, so B (the only eligible row) wins');
  });

  it('an invalid priority sorts after P3 rather than winning', () => {
    const rows = parseRoadmap([
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Weird | pending | P9 | — | — |',
      '| Late | pending | P3 | — | — |'
    ].join('\n'));
    const next = selectNext(rows);
    assert.equal(next.item, 'Late');
    assert.equal(next.priority, 'P3');
  });

  it('status casing (Done/BLOCKED) is honoured when excluding rows', () => {
    const rows = parseRoadmap([
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | Done | P0 | — | — |',
      '| B | BLOCKED | P0 | — | — |',
      '| C | pending | P2 | A | — |'
    ].join('\n'));
    const next = selectNext(rows);
    assert.equal(next.item, 'C', 'case-insensitive done satisfies the dependency and excludes A/B');
  });

  it('two tables of different shapes in one file both contribute rows', () => {
    const rows = parseRoadmap([
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| Legacy | done | P0 | — | — |',
      '',
      'Prose ends the table.',
      '',
      '| Item | Status | Priority | Size | Source | Depends on | Ship feature |',
      '|---|---|---|---|---|---|---|',
      '| Modern | pending | P1 | M | analysis | Legacy | feat-m |'
    ].join('\n'));
    assert.equal(rows.length, 2);
    const next = selectNext(rows);
    assert.equal(next.item, 'Modern');
    assert.equal(next.shipFeature, 'feat-m');
  });
});

describe('pm-update adversarial — CLI error handling', () => {
  it('exits non-zero with a stderr message when the dashboard cannot be written', () => {
    pmWrite(tmp, 'ROADMAP.md', [
      '---',
      'project: "P"',
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | — |'
    ].join('\n'));
    // A directory where the file belongs makes writeFileSync fail deterministically.
    fs.mkdirSync(path.join(tmp, '.project-manager', 'dashboard.html'));

    const res = runCli(tmp);
    assert.equal(res.status, 1, 'a genuine write failure is the one non-zero exit');
    assert.match(res.stderr, /dashboard\.html/);
  });

  it('an unreadable ROADMAP.md degrades to a silent exit 0 rather than crashing', () => {
    fs.mkdirSync(path.join(tmp, '.project-manager', 'ROADMAP.md'), { recursive: true });
    const res = runCli(tmp);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  });

  it('--next combined with slugs still writes nothing', () => {
    const roadmap = [
      '---',
      'project: "P"',
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | feat-a |'
    ].join('\n');
    pmWrite(tmp, 'ROADMAP.md', roadmap);
    createFeature(tmp, 'feat-a', 'building');

    const res = runCli(tmp, ['--next', 'feat-a']);
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).item, 'A');
    assert.equal(fs.readFileSync(path.join(tmp, '.project-manager', 'ROADMAP.md'), 'utf8'), roadmap);
    assert.equal(fs.existsSync(path.join(tmp, '.project-manager', 'dashboard.html')), false);
  });

  it('an unknown slug argument changes nothing and still heals the dashboard', () => {
    const roadmap = [
      '---',
      'project: "P"',
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | feat-a |'
    ].join('\n');
    pmWrite(tmp, 'ROADMAP.md', roadmap);

    const res = runCli(tmp, ['not-a-real-feature']);
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(path.join(tmp, '.project-manager', 'ROADMAP.md'), 'utf8'), roadmap);
    assert.ok(fs.existsSync(path.join(tmp, '.project-manager', 'dashboard.html')), 'dashboard heals');
  });
});
