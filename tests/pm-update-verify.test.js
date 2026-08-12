/**
 * Verifier-authored tests for ship/pm-update.cjs (pm-mechanical-sync).
 *
 * Complements tests/pm-update.test.js (documented rules) and
 * tests/pm-update-adversarial.test.js (hostile content, error handling) by
 * attacking assumptions the byte-level Status edit makes about *where* a cell
 * lives: repeated slugs, reordered columns, indented rows, and where the
 * feature status is read from inside CONTEXT.md.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'ship', 'pm-update.cjs');
const { applyStatusUpdates, mappedStatus } = require(SCRIPT_PATH);

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmu-ver-'));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function createFeature(name, status) {
  const dir = path.join(tmp, '.planning', 'features', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), `---\nfeature: "${name}"\nstatus: ${status}\n---\n\nbody\n`);
}

describe('pm-update — the Status cell is located, not assumed', () => {
  it('updates every row carrying the slug, across separate tables', () => {
    // The acceptance rule is "updates every row matching a slug" — a slug may
    // legitimately appear under two milestones.
    const before = [
      '### M1 (status: active)',
      '',
      '| Item | Status | Priority | Depends on | Ship feature |',
      '|---|---|---|---|---|',
      '| A | pending | P1 | — | feat-a |',
      '',
      'Prose ends the table.',
      '',
      '### M2 (status: planned)',
      '',
      '| Item | Status | Priority | Size | Source | Depends on | Ship feature |',
      '|---|---|---|---|---|---|---|',
      '| A follow-up | pending | P2 | S | user | — | feat-a |'
    ].join('\n');
    createFeature('feat-a', 'building');

    const { content, changed } = applyStatusUpdates(before, tmp, ['feat-a']);
    const lines = content.split('\n');
    assert.equal(changed, true);
    assert.equal(lines[4], '| A | in-progress | P1 | — | feat-a |');
    assert.equal(lines[12], '| A follow-up | in-progress | P2 | S | user | — | feat-a |');
  });

  it('edits the Status column even when it is not the second column', () => {
    const before = [
      '| Ship feature | Priority | Item | Depends on | Status |',
      '|---|---|---|---|---|',
      '| feat-a | P0 | A | — | pending |'
    ].join('\n');
    createFeature('feat-a', 'planned');

    const { content } = applyStatusUpdates(before, tmp, []);
    assert.equal(content.split('\n')[2], '| feat-a | P0 | A | — | in-progress |');
  });

  it('an indented row keeps its indentation and every other cell', () => {
    const before = [
      '   | Item | Status | Priority | Depends on | Ship feature |',
      '   |---|---|---|---|---|',
      '   | A | pending | P1 | — | feat-a |'
    ].join('\n');
    createFeature('feat-a', 'built');

    const { content } = applyStatusUpdates(before, tmp, []);
    assert.equal(content.split('\n')[2], '   | A | in-progress | P1 | — | feat-a |');
  });
});

describe('pm-update — feature status is read from the CONTEXT.md frontmatter', () => {
  it('a `status:` line in the body cannot override the frontmatter status', () => {
    const dir = path.join(tmp, '.planning', 'features', 'feat-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'CONTEXT.md'),
      '---\nfeature: "feat-a"\nstatus: building\n---\n\nThe roadmap row says\nstatus: done\nbut it is not.\n'
    );
    assert.equal(mappedStatus(tmp, 'feat-a', 'pending'), 'in-progress');
  });

  it('an archived feature overrides a recorded blocked status, per the mapping table', () => {
    // `blocked` is never auto-overridden *while the feature is active*; an
    // archived feature is the documented exception (archive presence → done).
    fs.mkdirSync(path.join(tmp, '.planning', 'archive', 'feat-a'), { recursive: true });
    assert.equal(mappedStatus(tmp, 'feat-a', 'blocked'), 'done');
  });

  it('a feature directory with no CONTEXT.md leaves the row unchanged', () => {
    fs.mkdirSync(path.join(tmp, '.planning', 'features', 'feat-a'), { recursive: true });
    assert.equal(mappedStatus(tmp, 'feat-a', 'pending'), null);
  });
});
