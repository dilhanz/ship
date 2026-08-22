// Fidelity tests for the authored-prose renderer in ship/pm-update.cjs.
//
// The adversarial suite next door proves inline() cannot *add* markup. These
// prove the complementary half — that it does not silently *lose* or *mangle*
// content, and that it stays inside the dashboard: the blocker index still
// matches on raw cell text, and the `--next` CLI contract is unchanged text,
// not HTML.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PM_UPDATE = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { generateDashboard } = require(PM_UPDATE);

const HEADER = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';
const SEP = '|---|---|---|---|---|---|---|';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-fidelity-'));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function pmWrite(file, content) {
  const dir = path.join(tmp, '.project-manager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function roadmap(rows, frontProject = 'Board') {
  return [
    '---',
    `project: ${frontProject}`,
    'updated: "2026-01-01"',
    '---',
    '',
    '### M1 — One (status: active)',
    '',
    'Goal: goal',
    '',
    HEADER,
    SEP,
    ...rows,
    ''
  ].join('\n');
}

/** Strip every tag, then decode the five entities esc() emits. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('dashboard inline() — conversion is lossless', () => {
  it('round-trips every authored character back out of the document', () => {
    // Deliberately mixes all five escaped characters with span delimiters, so
    // an escape applied twice (or a span that eats a character) shows up as a
    // mismatch rather than as visually-plausible output.
    const authored = 'a < b & c "d" \'e\' `f < g & h` tail';
    pmWrite('ROADMAP.md', roadmap([`| ${authored} | pending | P1 | S | — | src | — |`]));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    const text = textOf(html);
    // The delimiters themselves are consumed by the conversion; nothing else is.
    const expected = authored.replace(/`/g, '');
    assert.ok(
      text.includes(expected),
      `authored text did not survive the round trip\n  want: ${expected}\n  text: ${text.slice(0, 400)}`
    );
    assert.ok(html.includes('<code>&lt; g &amp; h</code>') === false, 'sanity: span body keeps its leading token');
    assert.ok(html.includes('<code>f &lt; g &amp; h</code>'), 'the span body is escaped, not dropped');
  });

  it('escapes a pre-escaped entity exactly once, so it reads back literally', () => {
    // State that already looks like HTML must survive as *text* — escaping it
    // twice or not at all are both wrong, and only an exact comparison catches
    // the difference.
    const authored = '&amp; &lt;b&gt; `&amp; &lt;b&gt;`';
    pmWrite('ROADMAP.md', roadmap([`| ${authored} | pending | P1 | S | — | src | — |`]));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    assert.ok(
      html.includes('&amp;amp; &amp;lt;b&amp;gt; <code>&amp;amp; &amp;lt;b&amp;gt;</code>'),
      'a pre-escaped entity is escaped once more, inside and outside the span'
    );
    assert.equal(
      textOf(html).includes('&amp; &lt;b&gt; &amp; &lt;b&gt;'),
      true,
      'the entity reads back as the literal text the author wrote'
    );
  });
});

describe('dashboard inline() — the blocker index still matches on raw text', () => {
  it('a blocked item carrying a code span still finds its STATUS.md reason', () => {
    // blockedReasons is keyed on the *raw* cell, so rendering must not be
    // hoisted above the lookup: a converted key would silently drop every
    // blocker reason for items that contain a code span.
    pmWrite('ROADMAP.md', roadmap([
      '| Re-run `check` on the archive | blocked | P1 | S | — | src | — |'
    ]));
    pmWrite('STATUS.md', [
      '## Blocked',
      '',
      '- **Re-run `check` on the archive** — waiting on `pm apply`',
      ''
    ].join('\n'));

    const html = generateDashboard(tmp);
    assert.ok(html, 'dashboard generated');

    assert.ok(html.includes('class="blocker-reason"'), 'the reason paragraph rendered — the key still matched');
    assert.ok(html.includes('waiting on <code>pm apply</code>'), 'the reason renders its own span');
    assert.ok(
      html.includes('<strong>Re-run <code>check</code> on the archive</strong>'),
      'the blocker label renders its span inside the strong element'
    );
    const open = (html.match(/<code[\s>]/g) || []).length;
    const close = (html.match(/<\/code>/g) || []).length;
    assert.equal(open, close, '<code> stays balanced with blockers present');
  });
});

describe('pm-update --next — the CLI contract is text, not HTML', () => {
  it('prints the raw item, backticks intact and nothing escaped', () => {
    pmWrite('ROADMAP.md', roadmap([
      '| Re-run `check` on the archive | pending | P1 | S | — | src | — |'
    ]));

    const out = execFileSync(process.execPath, [PM_UPDATE, '--next'], {
      cwd: tmp,
      encoding: 'utf8'
    });
    const next = JSON.parse(out);

    assert.equal(next.item, 'Re-run `check` on the archive', 'the CLI emits the authored text unchanged');
    assert.ok(!out.includes('<code>'), 'no dashboard markup leaks into the CLI output');
    assert.ok(!out.includes('&amp;'), 'no HTML escaping leaks into the CLI output');
  });
});
