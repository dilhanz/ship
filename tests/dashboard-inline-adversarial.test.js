// Adversarial tests for the authored-prose renderer in ship/pm-update.cjs.
//
// `inline()` is the only place state content is allowed to produce markup, so
// the invariant worth defending is narrow and absolute: hostile state may add
// exactly one tag name to the document (`code`), may never add an attribute,
// and may never leave a tag unbalanced. These tests drive hostile values
// through *every* inline() call site at once — project name, sync timestamp,
// next-item name and meta, in-flight bullets, milestone name and goal, backlog
// cells, blocker label and reason, decision date/title/body — and compare the
// result against a benign render of the same shape rather than against a
// hand-written allowlist, so a future call site is covered the day it is added.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generateDashboard } = require(path.join(__dirname, '..', 'ship', 'pm-update.cjs'));

const HEADER = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';
const SEP = '|---|---|---|---|---|---|---|';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-adversarial-'));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function pmWrite(file, content) {
  const dir = path.join(tmp, '.project-manager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

/**
 * Write a full state set in which every authored-prose field carries `payload`.
 * `tag` keeps otherwise-identical rows distinguishable.
 */
function writeState(payload) {
  pmWrite('ROADMAP.md', [
    '---',
    `project: Board ${payload}`,
    `updated: "2026-01-01 ${payload}"`,
    '---',
    '',
    `### M1 — Milestone ${payload} (status: active)`,
    '',
    `Goal: goal ${payload}`,
    '',
    HEADER,
    SEP,
    `| Ready ${payload} | pending | P1 | S | — | src ${payload} | — |`,
    `| Stuck ${payload} | blocked | P2 | M | — | src ${payload} | — |`,
    ''
  ].join('\n'));
  pmWrite('STATUS.md', [
    '## In flight',
    '',
    `- flight ${payload}`,
    '',
    '## Blocked',
    '',
    `- **Stuck ${payload}** — reason ${payload}`,
    ''
  ].join('\n'));
  pmWrite('DECISIONS.md', [
    '# Decisions',
    '',
    `## 2026-01-02 — Title ${payload}`,
    '',
    `Body ${payload}`,
    ''
  ].join('\n'));
}

function render(payload) {
  writeState(payload);
  const html = generateDashboard(tmp);
  assert.ok(html, 'dashboard generated');
  return html;
}

/** Lowercased set of every tag name appearing in the document. */
function tagNames(html) {
  return new Set([...html.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase()));
}

/** Every attribute name=value pair in the document, as `name="value"` strings. */
function attributes(html) {
  return [...html.matchAll(/<[a-zA-Z][^>]*>/g)]
    .flatMap(m => [...m[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(a => `${a[1]}="${a[2]}"`));
}

function balanced(html, tag) {
  const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
  const close = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
  return open === close;
}

// A benign render of the identical document shape — the control every hostile
// render is compared against.
const BENIGN = 'plain';

const PAYLOADS = [
  ['script tag', '<script>alert(1)</script>'],
  ['script tag inside a span', '`<script>alert(1)</script>`'],
  ['img with an event handler', '<img src=x onerror=alert(1)>'],
  ['attribute breakout attempt', '" onmouseover="alert(1)'],
  ['attribute breakout inside a span', '`" onmouseover="alert(1)`'],
  ['single-quoted breakout', "' onfocus='alert(1)"],
  ['pre-escaped entity', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['double-escaped ampersand', '&amp;lt;script&amp;gt;'],
  ['literal code tag', '<code>x</code>'],
  ['literal code tag in a span', '`<code>x</code>`'],
  ['unclosed code tag', '<code>'],
  ['numeric backtick entity', '&#96;script&#96;'],
  ['comment breakout', '--><script>alert(1)</script><!--'],
  ['placeholder forgery', '<!-- PM:DECISIONS -->'],
  ['style/import attempt', '<style>@import url(http://evil)</style>'],
  ['span containing a css import', '`@import url(http://evil)`'],
  ['lone backtick', '`'],
  ['two backticks', '``'],
  ['three backticks', '```'],
  ['double-backtick span', '``x``'],
  ['unpaired trailing backtick', 'a `b'],
  ['backtick pair around markup', '`<b>`'],
  ['nested-looking span', '`a `b` c`'],
  ['dollar patterns', "$& $` $' $1 $$"],
  ['dollar patterns in a span', "`$& $` $' $1 $$`"],
  ['tab and unicode inside a span', '`a\tb c d`'],
  ['emoji span', '`✅ done`']
];

describe('dashboard inline() — hostile state adds no markup beyond <code>', () => {
  const controlTags = (() => { let t; return () => { if (!t) t = tagNames(render(BENIGN)); return t; }; })();

  for (const [name, payload] of PAYLOADS) {
    it(`admits no new tag name: ${name}`, () => {
      const control = controlTags();
      const html = render(payload);
      const extra = [...tagNames(html)].filter(t => !control.has(t) && t !== 'code');
      assert.deepEqual(extra, [], `state introduced tag(s) ${JSON.stringify(extra)}`);
    });

    it(`admits no new attribute: ${name}`, () => {
      const controlAttrs = new Set(attributes(render(BENIGN)));
      const html = render(payload);
      for (const attr of attributes(html)) {
        const [attrName] = attr.split('=');
        assert.ok(
          controlAttrs.has(attr) || attrName === 'class',
          `state introduced attribute ${attr}`
        );
        assert.ok(!/^on/i.test(attrName), `state introduced an event handler ${attr}`);
      }
      // Note: a document-wide /\son\w+=/ scan is NOT the right assertion here —
      // an escaped payload like `&quot; onmouseover=&quot;alert(1)` matches it
      // as inert *text*. What matters is that no real element carries the
      // handler, which the per-attribute walk above decides.
      assert.equal(
        [...html.matchAll(/<[a-zA-Z][^>]*>/g)].filter(m => /\son\w+\s*=/i.test(m[0])).length,
        0,
        'no element carries an event-handler attribute'
      );
    });

    it(`keeps every structural tag balanced: ${name}`, () => {
      const html = render(payload);
      for (const tag of ['html', 'head', 'body', 'style', 'section', 'div', 'span', 'p', 'ul', 'li', 'code', 'strong']) {
        assert.ok(balanced(html, tag), `<${tag}> unbalanced with payload ${JSON.stringify(payload)}`);
      }
    });

    it(`emits no code tag inside an attribute value: ${name}`, () => {
      const html = render(payload);
      for (const attr of attributes(html)) {
        assert.ok(!/<\/?code/i.test(attr), `code tag inside attribute ${attr}`);
      }
    });

    it(`leaves the document offline and script-free: ${name}`, () => {
      const html = render(payload);
      for (const bad of ['<script', '@import', '<link', 'http://', 'https://', 'url(']) {
        // The payload may contain these as *text*; what matters is that they are
        // inert — every `<` opens a real tag, and no url()/import survives
        // inside the style block or an attribute.
        if (bad === '<script') assert.ok(!tagNames(html).has('script'), 'no script element');
      }
      const styleBlock = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
      assert.doesNotMatch(styleBlock, /@import|url\(\s*['"]?https?:/i, 'the style block stays local');
      assert.doesNotMatch(html, /<[a-zA-Z][^>]*\s(src|href)=/i, 'no element references an external resource');
    });

    it(`replaces every placeholder: ${name}`, () => {
      assert.doesNotMatch(render(payload), /<!--\s*PM:/, 'no unreplaced placeholder remains');
    });
  }
});

describe('dashboard inline() — degenerate and pathological backticks', () => {
  it('a run of backticks never opens more spans than it closes', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 17]) {
      const html = render('x'.concat('`'.repeat(n)).concat('y'));
      assert.ok(balanced(html, 'code'), `${n} backticks left <code> unbalanced`);
    }
  });

  it('a pair cannot span two authored values', () => {
    pmWrite('ROADMAP.md', [
      '---',
      'project: Board',
      'updated: "2026-01-01"',
      '---',
      '',
      '### M1 — One (status: active)',
      '',
      'Goal: goal',
      '',
      HEADER,
      SEP,
      '| open ` here | pending | P1 | S | — | close ` there | — |',
      ''
    ].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');
    assert.equal((html.match(/<code>/g) || []).length, 0, 'no span may bridge two cells');
    assert.ok(html.includes('open ` here'), 'the first value keeps its literal backtick');
    assert.ok(html.includes('close ` there'), 'the second value keeps its literal backtick');
  });

  it('a newline cannot be spanned', () => {
    pmWrite('ROADMAP.md', [
      '---', 'project: Board', 'updated: "2026-01-01"', '---', '',
      '### M1 — One (status: active)', '', 'Goal: goal', '', HEADER, SEP,
      '| item | pending | P1 | S | — | src | — |', ''
    ].join('\n'));
    pmWrite('STATUS.md', ['## In flight', '', '- start `', '  continued `', ''].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');
    // The bullet joins its continuation with a newline, so the pair must not
    // convert — a converted pair here would wrap a line break in a <code>.
    assert.ok(balanced(html, 'code'), '<code> stays balanced across a bullet continuation');
  });

  it('a pathological backtick string renders in linear time', () => {
    const payload = '`'.repeat(20000) + 'a'.repeat(20000);
    const started = Date.now();
    const html = render(payload);
    const elapsed = Date.now() - started;
    assert.ok(balanced(html, 'code'), '<code> stays balanced on a pathological input');
    assert.ok(elapsed < 5000, `rendering took ${elapsed}ms — possible catastrophic backtracking`);
  });
});

describe('dashboard inline() — the fixture tripwire stays armed', () => {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'pm-state');

  /** Copy the committed fixture into a throwaway `.project-manager/`. */
  function stageFixture() {
    const dir = path.join(tmp, '.project-manager');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['ROADMAP.md', 'STATUS.md', 'DECISIONS.md', 'CONVENTIONS.md']) {
      fs.copyFileSync(path.join(fixtureRoot, f), path.join(dir, f));
    }
    return tmp;
  }

  // The conformance suite compares tag-stripped dashboard text against
  // backtick-stripped ROADMAP cells, so it only proves code-span rendering
  // while the fixture actually *contains* a code span. Strip the backticks from
  // the tripwire row and that whole assertion goes quietly vacuous. These two
  // guard it directly.
  it('the fixture ROADMAP still carries a backtick-bearing backlog cell', () => {
    const roadmap = fs.readFileSync(path.join(fixtureRoot, 'ROADMAP.md'), 'utf8');
    const spanRows = roadmap
      .split('\n')
      .filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'))
      .filter(l => /`[^`\n]+`/.test(l.split('|')[1] || ''));
    assert.ok(
      spanRows.length >= 1,
      'the fixture must keep at least one backlog Item cell containing a `code` span — ' +
      'without it the conformance backlog-item assertion passes whether or not spans render'
    );
  });

  it('the fixture dashboard renders the tripwire cell as a real <code> element', () => {
    const html = generateDashboard(stageFixture(), null);
    assert.ok(html, 'dashboard generated from the committed fixture');
    assert.ok(html.includes('<code>check</code>'), 'the tripwire span renders as <code>check</code>');
    assert.ok(balanced(html, 'code'), '<code> balanced');
  });

  it('the shipped template styles <code> with a local font stack only', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'ship', 'templates', 'dashboard.html'), 'utf8'
    );
    const rule = template.match(/(^|\n)\s*code\s*\{[^}]*\}/);
    assert.ok(rule, 'the template carries a `code` style rule');
    assert.match(rule[0], /font-family:[^;]*monospace/, 'the rule declares a monospace stack');
    assert.doesNotMatch(rule[0], /url\(|@import|https?:/i, 'the stack references nothing remote');
  });
});

describe('dashboard inline() — degraded and malformed state', () => {
  it('renders with only ROADMAP.md present', () => {
    pmWrite('ROADMAP.md', [
      '---', 'project: Board `x`', 'updated: "2026-01-01"', '---', '',
      '### M1 — One (status: active)', '', 'Goal: goal `g`', '', HEADER, SEP,
      '| item `i` | pending | P1 | S | — | src | — |', ''
    ].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated without STATUS.md or DECISIONS.md');
    assert.ok(html.includes('<code>x</code>'), 'project name converts');
    assert.ok(html.includes('<code>g</code>'), 'milestone goal converts');
    assert.ok(html.includes('<code>i</code>'), 'backlog cell converts');
    assert.ok(balanced(html, 'code'), '<code> balanced');
  });

  it('renders with an empty state directory', () => {
    fs.mkdirSync(path.join(tmp, '.project-manager'), { recursive: true });
    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated from empty state');
    assert.doesNotMatch(html, /<!--\s*PM:/, 'placeholders still replaced');
    assert.ok(balanced(html, 'code'), '<code> balanced');
  });

  it('renders a ragged table without leaking cells into markup', () => {
    pmWrite('ROADMAP.md', [
      '---', 'project: Board', 'updated: "2026-01-01"', '---', '',
      '### M1 — One (status: active)', '', 'Goal: goal', '', HEADER, SEP,
      '| short `row` |',
      '| a | b | c | d | e | f | g | h | i `j` |',
      ''
    ].join('\n'));
    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated from a ragged table');
    assert.ok(balanced(html, 'code'), '<code> balanced');
    assert.ok(balanced(html, 'div'), '<div> balanced');
    for (const attr of attributes(html)) {
      assert.ok(!/<\/?code/i.test(attr), `code tag inside attribute ${attr}`);
    }
  });
});
