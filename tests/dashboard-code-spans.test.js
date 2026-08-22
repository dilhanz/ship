// Code-span rendering tests for ship/pm-update.cjs.
//
// The dashboard renders authored prose through `inline()` — HTML-escape first,
// then convert markdown code spans to <code> elements — while machine-derived
// values and every attribute stay on plain `esc()`. These tests attack that
// boundary with hostile state: markup inside and outside a span, a backtick in
// an attribute-bearing cell, non-code markdown, degenerate backticks, and
// `$`-patterns that a careless string replacement would reinterpret.
//
// State is written inline here rather than taken from tests/fixtures/pm-state/:
// a backtick inside a `Status` cell is deliberately non-conformant, and the
// fixture is asserted to conform.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generateDashboard } = require(path.join(__dirname, '..', 'ship', 'pm-update.cjs'));

const HEADER = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';
const SEP = '|---|---|---|---|---|---|---|';

function pmWrite(tmpDir, file, content) {
  const dir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

/** A minimal conformant ROADMAP: frontmatter, one milestone, then one table. */
function roadmapDoc(rows, opts = {}) {
  return [
    '---',
    `project: ${opts.project || 'Ship board'}`,
    'updated: "2026-01-01"',
    '---',
    '',
    opts.heading || '### M1 — Rendering (status: active)',
    '',
    `Goal: ${opts.goal || 'render authored prose faithfully'}`,
    '',
    HEADER,
    SEP,
    ...rows,
    ''
  ].join('\n');
}

function count(html, needle) {
  return html.split(needle).length - 1;
}

/** Every `class="..."` value in the document, in order. */
function classValues(html) {
  return [...html.matchAll(/class="([^"]*)"/g)].map(m => m[1]);
}

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-spans-'));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

describe('dashboard code spans — escaping survives the conversion', () => {
  it('escapes first and converts second, inside and outside a span', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Fix <b> & "x" outside and `<b> & "x"` inside | pending | P1 | S | — | note \'a\' `b` | — |'
    ]));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    // Inside the span: entities, not raw markup — and the <code> tags the
    // conversion emits are themselves real tags, not escaped text.
    assert.ok(
      html.includes('<code>&lt;b&gt; &amp; &quot;x&quot;</code>'),
      'markup inside a code span is escaped and the span still renders as a tag'
    );
    assert.ok(
      html.includes('Fix &lt;b&gt; &amp; &quot;x&quot; outside and '),
      'text outside the span is escaped too'
    );
    assert.ok(html.includes('note &#39;a&#39; <code>b</code>'), 'the Source cell escapes and converts');
    assert.doesNotMatch(html, /&lt;code&gt;/, 'the emitted tag must not itself be escaped');

    // No raw `<` from state reaches the output: every `<` opens a tag, and no
    // tag name the state supplied is present.
    const bare = (html.match(/</g) || []).length;
    const tagged = (html.match(/<[/!a-zA-Z]/g) || []).length;
    assert.equal(bare, tagged, 'every `<` in the document opens a tag or a comment');
    const tagNames = new Set([...html.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase()));
    assert.ok(!tagNames.has('b'), 'a <b> from state must not become a real element');
    assert.ok(tagNames.has('code'), 'the code span became a real element');
  });
});

describe('dashboard code spans — attributes are untouched', () => {
  it('a backtick in a Status cell or a milestone badge emits no tag inside an attribute', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Run `check` on the archive | `pending` | P1 | `S` | — | plan | — |'
    ], { heading: '### M1 — Rendering (status: `active`)' }));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    for (const value of classValues(html)) {
      assert.ok(!value.includes('<code'), `no code tag may open inside an attribute: class="${value}"`);
      assert.ok(!value.includes('</code'), `no code tag may close inside an attribute: class="${value}"`);
    }
    assert.match(html, /class="status-[^"<>]*"/, 'the status class attribute stays well-formed');
    assert.match(html, /class="badge [^"<>]*"/, 'the milestone badge class attribute stays well-formed');

    // The enum cells keep their backticks as literal text — they are
    // machine-derived values, not prose — while the Item cell converts.
    assert.ok(html.includes('<code>check</code>'), 'the prose cell still renders its span');
    assert.equal(count(html, '<code>'), count(html, '</code>'), '<code> tags stay balanced');
  });
});

describe('dashboard code spans — only code spans convert', () => {
  it('bold, emphasis, and links survive as literal text', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Support **bold**, _em_, [text](docs/x.md), and `real` spans | pending | P1 | S | — | plan | — |'
    ], { goal: 'keep **bold** and _em_ literal' }));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    assert.doesNotMatch(html, /<strong[\s>]/i, 'no <strong> may originate from state');
    assert.doesNotMatch(html, /<em[\s>]/i, 'no <em> may originate from state');
    assert.doesNotMatch(html, /<a[\s>]/i, 'no <a> may originate from state');

    assert.ok(html.includes('**bold**'), 'bold markers survive literally');
    assert.ok(html.includes('_em_'), 'emphasis markers survive literally');
    assert.ok(html.includes('[text](docs/x.md)'), 'link syntax survives literally');
    assert.ok(html.includes('<code>real</code>'), 'code spans still convert');
  });
});

describe('dashboard code spans — degenerate backticks', () => {
  it('an unpaired backtick, an empty pair, and a pair split across fields stay literal', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Budget ` unpaired | pending | P1 | S | — | plan | — |',
      '| Empty `` pair | pending | P2 | S | — | plan | — |'
    ]));
    // A span may never spill from one authored value into the next: each value
    // is converted on its own, so an opening backtick here and a closing one in
    // the following bullet cannot wrap the markup between them.
    pmWrite(tmp, 'STATUS.md', [
      '## In flight',
      '',
      '- opening `',
      '- closing `',
      ''
    ].join('\n'));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    assert.ok(html.includes('Budget ` unpaired'), 'an unpaired backtick survives as text');
    assert.ok(html.includes('Empty `` pair'), 'an empty pair survives as text');
    assert.ok(html.includes('<li>opening `</li>'), 'the first bullet keeps its lone backtick');
    assert.ok(html.includes('<li>closing `</li>'), 'the second bullet keeps its lone backtick');
    assert.equal(count(html, '<code>'), 0, 'no degenerate backtick may open a tag');
    assert.equal(count(html, '<code>'), count(html, '</code>'), '<code> tags stay balanced');
  });
});

describe('dashboard code spans — $-patterns and determinism', () => {
  it('a $-pattern inside a code span is emitted literally', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Cost `$& and $\'` recorded | pending | P1 | S | — | $` rate | — |'
    ]));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');
    assert.ok(
      html.includes('<code>$&amp; and $&#39;</code>'),
      'a $-pattern in a span body is emitted literally, not reinterpreted by replace'
    );
    assert.ok(html.includes('$` rate'), 'a $-pattern beside a lone backtick survives as text');
  });

  it('generation stays byte-identical across runs with code spans present', () => {
    pmWrite(tmp, 'ROADMAP.md', roadmapDoc([
      '| Re-run `check` against a ship-owned archived feature | pending | P1 | M | — | plan | — |'
    ]));
    pmWrite(tmp, 'DECISIONS.md', [
      '# Decisions',
      '',
      '## 2026-01-02 — Render `code` spans',
      '',
      'The dashboard converts `backtick` pairs after escaping.',
      ''
    ].join('\n'));

    const first = generateDashboard(tmp);
    const second = generateDashboard(tmp);
    assert.equal(first, second, 'repeated generation on unchanged state is byte-identical');
    assert.ok(first.includes('<code>check</code>'), 'the tripwire row renders a code span');
    assert.ok(first.includes('<code>backtick</code>'), 'decision bodies render code spans');
  });
});
