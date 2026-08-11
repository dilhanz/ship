/**
 * Verifier-authored adversarial coverage for the header-name backlog parser
 * in hooks/pm-sync-nudge.cjs (pm-capability-uplift).
 *
 * Focus: the header-context lifecycle (the plan's named risk), the real
 * dogfooded ROADMAP.md in this repo, and rows that violate the documented
 * cell-count contract.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const HOOK_PATH = path.join(repoRoot, 'hooks', 'pm-sync-nudge.cjs');

function runHook(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      let output = null;
      if (stdout.trim()) {
        try {
          output = JSON.parse(stdout);
        } catch (e) {
          output = null;
        }
      }
      resolve({ code, output, raw: stdout, stderr });
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ cwd }));
    child.stdin.end();
  });
}

const msgOf = (out) => (out ? out.hookSpecificOutput.additionalContext : '');

function createFeature(tmpDir, name, status) {
  const dir = path.join(tmpDir, '.planning', 'features', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), `---\nfeature: "${name}"\nstatus: ${status}\n---\n`);
}

function writeRoadmap(tmpDir, body) {
  const pmDir = path.join(tmpDir, '.project-manager');
  fs.mkdirSync(pmDir, { recursive: true });
  fs.writeFileSync(path.join(pmDir, 'ROADMAP.md'), body);
}

const V7 = '| Item | Status | Priority | Size | Depends on | Source | Ship feature |';
const V7SEP = '| --- | --- | --- | --- | --- | --- | --- |';

describe('pm-sync-nudge — header-context lifecycle', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-nudge-verify-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a blank line between header and rows does not drop the table', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    writeRoadmap(
      tmpDir,
      ['## Milestones', '', V7, V7SEP, '', '| A | pending | P1 | M | — | src/a.ts:1 | alpha |', ''].join('\n')
    );
    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'blank line must not clear the active header context');
    assert.match(msgOf(output), /alpha/);
  });

  it('a #### detail section between two tables does not let the second table inherit the first header', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    createFeature(tmpDir, 'beta', 'building');
    writeRoadmap(
      tmpDir,
      [
        '## Milestones',
        '',
        '### M1 — one (status: active)',
        '',
        V7,
        V7SEP,
        '| A | pending | P1 | M | — | src/a.ts:1 | alpha |',
        '',
        '#### A',
        '',
        'Prose about A.',
        '',
        // headerless rows: must contribute nothing now the context was cleared
        '| B | pending | P1 | M | — | src/b.ts:1 | beta |',
        '',
      ].join('\n')
    );
    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'the first, well-formed table still drifts');
    const msg = msgOf(output);
    assert.match(msg, /alpha/, 'row under a real header is parsed');
    assert.ok(!msg.includes('beta'), 'headerless rows after a prose line must not be parsed');
  });

  it('a row that omits the Size cell is dropped while its siblings survive', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    createFeature(tmpDir, 'beta', 'building');
    writeRoadmap(
      tmpDir,
      [
        '## Milestones',
        '',
        V7,
        V7SEP,
        // 6 cells vs the 7-column header: the Size cell is omitted, so Depends-on,
        // Source and Ship feature each shift one column left.
        '| A | pending | P1 | — | src/a.ts:1 | alpha |',
        '| B | pending | P1 | M | — | src/b.ts:1 | beta |',
        '',
      ].join('\n')
    );
    const { output } = await runHook(tmpDir);
    assert.ok(output, 'the well-formed row still drifts');
    const msg = msgOf(output);
    assert.match(msg, /beta/, 'full-width row is parsed');
    assert.ok(!msg.includes('alpha'), 'short row is skipped, as pm-state documents');
  });

  it('an em-dash slug is skipped rather than reported as a phantom feature', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    writeRoadmap(
      tmpDir,
      [
        '## Milestones',
        '',
        V7,
        V7SEP,
        '| A | pending | P1 | M | — | src/a.ts:1 | — |',
        '| B | pending | P1 | M | — | src/b.ts:1 | alpha |',
        '',
      ].join('\n')
    );
    const { output } = await runHook(tmpDir);
    assert.ok(output);
    const msg = msgOf(output);
    assert.match(msg, /alpha/);
    assert.ok(!msg.includes('—:'), 'no em-dash slug leaks into the drift list');
  });

  it('a lowercase header is not recognised and the whole table is silently ignored', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    writeRoadmap(
      tmpDir,
      [
        '## Milestones',
        '',
        '| item | status | priority | size | depends on | source | ship feature |',
        V7SEP,
        '| A | pending | P1 | M | — | src/a.ts:1 | alpha |',
        '',
      ].join('\n')
    );
    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0, 'hook exits cleanly');
    assert.equal(output, null, 'documented behaviour: header match is case-sensitive and exact');
  });

  it('never throws on a pathological roadmap (unbalanced pipes, nested tables, huge input)', async () => {
    createFeature(tmpDir, 'alpha', 'building');
    const junk = [];
    for (let i = 0; i < 2000; i++) junk.push(`| ${'|'.repeat(i % 7)} row ${i} |`);
    writeRoadmap(
      tmpDir,
      ['## Milestones', '', '|', '||', '| |', V7, V7SEP, ...junk, '| A | pending | P1 | M | — | src/a.ts:1 | alpha |'].join(
        '\n'
      )
    );
    const { code, stderr } = await runHook(tmpDir);
    assert.equal(code, 0, 'hook must never break the tool loop');
    assert.equal(stderr, '', 'no stack traces on stderr');
  });
});

describe('pm-sync-nudge — against the real dogfooded ROADMAP.md', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-nudge-real-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const SLUG = 'pm-capability-uplift';

  /**
   * The Status cell the real ROADMAP.md records for a slug. Derived rather than
   * hard-coded, so these tests keep testing the hook as the dogfooded state moves
   * through its own lifecycle instead of failing every time the item advances.
   */
  function recordedStatusFor(roadmap, slug) {
    for (const line of roadmap.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      if (cells[cells.length - 1] === slug) return cells[1];
    }
    return null;
  }

  /** Make the feature's on-disk reality either agree with, or diverge from, `recorded`. */
  function stageReality(dir, recorded, { matching }) {
    const done = matching ? recorded === 'done' : recorded !== 'done';
    if (done) {
      const archived = path.join(dir, '.planning', 'archive', SLUG);
      fs.mkdirSync(archived, { recursive: true });
      fs.writeFileSync(path.join(archived, 'CONTEXT.md'), '---\nstatus: done\n---\n');
    } else {
      createFeature(dir, SLUG, 'building');
    }
  }

  it('this repo\'s committed ROADMAP.md is machine-parseable: its slug drifts when reality diverges', async () => {
    const real = fs.readFileSync(path.join(repoRoot, '.project-manager', 'ROADMAP.md'), 'utf8');
    const recorded = recordedStatusFor(real, SLUG);
    assert.ok(recorded, `the shipped ROADMAP.md carries a row for ${SLUG}`);
    assert.ok(
      recorded === 'done' || recorded === 'in-progress',
      `this test models done/in-progress only; ROADMAP records "${recorded}"`
    );
    writeRoadmap(tmpDir, real);
    stageReality(tmpDir, recorded, { matching: false });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.ok(output, 'the shipped ROADMAP.md must be parseable by the shipped hook');
    const actual = recorded === 'done' ? 'in-progress' : 'done';
    assert.match(msgOf(output), new RegExp(`${SLUG}: roadmap says ${recorded}, actually ${actual}`));
  });

  it('this repo\'s committed ROADMAP.md is silent when reality matches (no false nudge)', async () => {
    const real = fs.readFileSync(path.join(repoRoot, '.project-manager', 'ROADMAP.md'), 'utf8');
    const recorded = recordedStatusFor(real, SLUG);
    assert.ok(recorded, `the shipped ROADMAP.md carries a row for ${SLUG}`);
    writeRoadmap(tmpDir, real);
    stageReality(tmpDir, recorded, { matching: true });

    const { code, output } = await runHook(tmpDir);
    assert.equal(code, 0);
    assert.equal(output, null, `recorded "${recorded}" matching reality is not drift`);
  });
});
