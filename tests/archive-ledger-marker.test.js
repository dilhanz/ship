/**
 * Archive ledger marker — the rule-order pins.
 *
 * `ship/find-features.cjs` reports an archived slug as
 * `{location: 'archive', branch: null, owner: 'sole', here: <cwd is main root>}`.
 * Before 5.22.1 both `skills/ledger/SKILL.md` (step 3 markers) and
 * `skills/status/SKILL.md` (step 6 Location) applied their `here` / `owner` /
 * `branch` rules before anything looked at `location`, so an archived feature
 * rendered as live work: every `## Shipped` row read `[done]` from the main
 * checkout and `[done · detached]` from a linked worktree, and the status
 * table's Location column said `here` or `detached` for a feature that is in
 * `.planning/archive/`. The regression this file prevents is that ordering
 * silently coming back — a rule that is present but sits below the `here` rule
 * never fires, and the prose still reads fine.
 *
 * Note what this can and cannot prove. Skills are prose executed by a model, so
 * no test can prove the model applies the rules in order. The reference
 * functions in describe block 2 are a restatement of the documented order, not
 * the runtime; block 1 (index-order assertions over the skill text) is what
 * keeps that restatement tied to the prose it mirrors, and block 3 keeps the
 * fixtures tied to the shape the helper actually emits.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('doctrine — the archive rule comes first in the prose', () => {
  it('skills/ledger/SKILL.md states the archive marker rule before the here and owner rules', () => {
    const src = readSrc('skills/ledger/SKILL.md');

    const archive = src.indexOf('`location: archive` → **no marker');
    const here = src.indexOf('- `here` true →');
    const owner = src.indexOf('`owner` is not `ambiguous`');

    assert.ok(
      archive >= 0,
      'the ledger marker list must carry an explicit `location: archive` rule — without it an archived entry falls through to the `here` rule and renders as live work',
    );
    assert.ok(here >= 0, 'the `here` true marker rule must still exist — the archive rule is inserted ahead of it, never in place of it');
    assert.ok(owner >= 0, 'the `owner` marker rule must still exist — the archive rule is inserted ahead of it, never in place of it');

    assert.ok(
      archive < here,
      'the `location: archive` rule must be listed before the `here` true rule; a rule stated after it never fires, which is the bug this feature fixed',
    );
    assert.ok(
      archive < owner,
      'the `location: archive` rule must be listed before the `owner` rules; an archived entry must never reach them',
    );
  });

  it('the ledger archive rule says the entry gets no marker', () => {
    const src = readSrc('skills/ledger/SKILL.md');
    const rule = src.slice(src.indexOf('`location: archive` → **no marker'));

    assert.match(
      rule.slice(0, 400),
      /no marker/,
      'the archive rule must say the archived entry gets no marker — the `→ .planning/archive/{slug}/` on a Shipped row is already the status',
    );
  });

  it('skills/status/SKILL.md states the archive Location rule before the here rule', () => {
    const src = readSrc('skills/status/SKILL.md');

    const archive = src.indexOf('**Location** is `archive` when `location` is `archive`');
    const here = src.indexOf('`here` when `here` is true');

    assert.ok(
      archive >= 0,
      'the status Location rule must name `location: archive` explicitly — a parenthetical after the `here` clause never fires',
    );
    assert.ok(here >= 0, 'the `here` clause must still exist — the archive clause is inserted ahead of it, never in place of it');
    assert.ok(
      archive < here,
      'the archive Location clause must be stated before the `here` clause; stated after, it never applies and an archived feature reads `here` or `detached`',
    );
  });

  it('the status Location rule keeps the clauses the archive rule sits in front of', () => {
    const src = readSrc('skills/status/SKILL.md');

    assert.match(
      src,
      /\{copies\} copies/,
      'the ambiguous Location clause must survive — the fix is inserting a rule, not deleting the rules it precedes',
    );
    assert.match(
      src,
      /`detached`/,
      'the detached Location clause must survive — the fix is inserting a rule, not deleting the rules it precedes',
    );
  });
});

describe('fixture — the documented rule order, executed', () => {
  // These two functions mirror the rules as the skill prose now orders them.
  // There is no runtime renderer to import: the ledger and status skills are
  // prose. The doctrine block above is what keeps these tied to that prose —
  // if someone reorders the rules in the skills, block 1 fails, not these.
  //
  // `status unknown` is substituted for a missing status *inside* each branch,
  // never as a branch of its own ahead of them: an ambiguous entry with a null
  // status must still report its copies.
  const ledgerMarker = (entry) => {
    if (!entry) return null;
    if (entry.location === 'archive') return null;

    const s = entry.status ?? 'status unknown';

    if (entry.owner === 'ambiguous') return `[${s} · ${entry.copies} copies]`;
    if (entry.here === true) return `[${s}]`;
    return `[${s} · ${entry.branch ?? 'detached'}]`;
  };

  const statusLocation = (entry) => {
    if (entry.location === 'archive') return 'archive';
    if (entry.here === true) return 'here';
    if (entry.owner === 'ambiguous') return `${entry.copies} copies`;
    return entry.branch ?? 'detached';
  };

  const archiveEntry = {
    slug: 'old-thing',
    status: 'done',
    location: 'archive',
    branch: null,
    path: '/main',
    here: false,
    owner: 'sole',
    copies: 0,
    candidates: [],
    alsoArchived: false,
  };

  it('an archived entry seen from a linked worktree gets no marker and reads archive', () => {
    assert.equal(
      ledgerMarker(archiveEntry),
      null,
      'an archived entry must get no ledger marker; before the fix its `here: false` fell through to the branch rule and rendered `[done · detached]`',
    );
    assert.equal(
      statusLocation(archiveEntry),
      'archive',
      'an archived entry must read `archive` in the status table from a linked worktree, not `detached`',
    );
  });

  it('the same entry seen from the main checkout renders identically', () => {
    const fromMain = { ...archiveEntry, here: true };

    assert.equal(
      ledgerMarker(fromMain),
      null,
      'an archived entry must get no ledger marker from the main checkout either; before the fix its `here: true` rendered `[done]`',
    );
    assert.equal(
      statusLocation(fromMain),
      'archive',
      'an archived entry must read `archive` in the status table from the main checkout, not `here`',
    );
  });

  it('live entries render exactly as before', () => {
    const inMain = { status: 'building', location: 'main', here: true };
    assert.equal(ledgerMarker(inMain), '[building]', '`here` true still renders `[{status}]`');
    assert.equal(statusLocation(inMain), 'here', '`here` true still reads `here`');

    const inWorktree = {
      status: 'building',
      location: 'worktree',
      here: false,
      branch: 'feature/x',
      owner: 'branch',
    };
    assert.equal(ledgerMarker(inWorktree), '[building · feature/x]', 'a non-ambiguous entry elsewhere still renders its branch');
    assert.equal(statusLocation(inWorktree), 'feature/x', 'a non-ambiguous entry elsewhere still reads its branch');

    const detached = { ...inWorktree, branch: null };
    assert.equal(ledgerMarker(detached), '[building · detached]', 'a null branch still renders `detached`');
    assert.equal(statusLocation(detached), 'detached', 'a null branch still reads `detached`');

    const ambiguous = { status: 'planned', here: false, owner: 'ambiguous', copies: 2, branch: null };
    assert.equal(ledgerMarker(ambiguous), '[planned · 2 copies]', 'an ambiguous entry still renders its copy count');
    assert.equal(statusLocation(ambiguous), '2 copies', 'an ambiguous entry still reads its copy count');

    const unknown = { status: null, location: 'main', here: true, owner: 'sole' };
    assert.equal(ledgerMarker(unknown), '[status unknown]', 'a missing status is still never guessed');
  });

  it('a missing status does not swallow the ambiguous rule', () => {
    const both = {
      status: null,
      location: 'worktree',
      here: false,
      owner: 'ambiguous',
      copies: 2,
      branch: null,
    };

    assert.equal(
      ledgerMarker(both),
      '[status unknown · 2 copies]',
      'an ambiguous entry with no status must still report its copies — `status unknown` is a substitution inside each branch, not a rule ahead of them',
    );
    assert.equal(statusLocation(both), '2 copies', 'an ambiguous entry with no status still reads its copy count');
  });

  it('a slug with no entry gets no marker', () => {
    assert.equal(
      ledgerMarker(undefined),
      null,
      'a slug absent from the map gets no marker — that is what "not started" looks like',
    );
  });
});

describe('the fixture matches the helper', () => {
  it('ship/find-features.cjs emits that shape for a slug with no live copy', () => {
    const src = readSrc('ship/find-features.cjs');

    const start = src.indexOf('if (candidates.length === 0)');
    assert.ok(start >= 0, 'the no-live-candidates branch must still exist in ship/find-features.cjs');

    const end = src.indexOf('continue;', start);
    assert.ok(end > start, 'the no-live-candidates branch must still end in a `continue;`');

    const branch = src.slice(start, end);

    assert.match(
      branch,
      /location: 'archive'/,
      'the fixtures above must describe the shape the helper actually emits: the archive branch sets `location: \'archive\'`',
    );
    assert.match(
      branch,
      /branch: null/,
      'the fixtures above must describe the shape the helper actually emits: the archive branch sets `branch: null`',
    );
    assert.match(
      branch,
      /owner: 'sole'/,
      'the fixtures above must describe the shape the helper actually emits: the archive branch sets `owner: \'sole\'`',
    );
  });
});
