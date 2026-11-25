/**
 * /ship:finish — the PR stamp.
 *
 * Two halves:
 *
 * - **Documented contract** — the stamp lives inside Option 1, happens before
 *   the archive move, is explicitly non-fatal, and stays a Bash operation
 *   (finish holds neither Write nor Edit, by design).
 * - **Executable behaviour** — the skill calls `ship/finish-record.cjs stamp`,
 *   so the helper is run directly. It replaced an inline `node -e` program,
 *   which a worktree-isolated session refused as too complex to verify.
 *
 * Scoped to the canonical `skills/` tree only — never the legacy `.claude/`
 * mirrors.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'finish', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');

const SUBSECTION = '### Stamp the PR URL';

/**
 * Slice the PR-stamp subsection out of the skill body: from its heading to the
 * next `### ` heading (or end of file). Fails loudly — a silently empty slice
 * would make every assertion below decorative.
 */
function stampSubsection() {
  const start = skill.indexOf(SUBSECTION);
  assert.notEqual(
    start,
    -1,
    `expected a "${SUBSECTION}" subsection in skills/finish/SKILL.md`
  );
  const rest = skill.slice(start + SUBSECTION.length);
  const end = rest.search(/\n### /);
  return SUBSECTION + (end === -1 ? rest : rest.slice(0, end));
}

describe('finish PR stamp — documented contract', () => {
  it('documents the stamp inside Option 1', () => {
    const optionOne = skill.indexOf('### Option 1: Create PR');
    const optionTwo = skill.indexOf('### Option 2: Merge Locally');
    const stamp = skill.indexOf(SUBSECTION);
    assert.notEqual(optionOne, -1, 'Option 1 must still exist');
    assert.notEqual(stamp, -1, 'the PR stamp subsection must exist');
    assert.ok(
      stamp > optionOne && stamp < optionTwo,
      'the PR stamp belongs to Option 1 — Options 2 and 3 open no PR'
    );
  });

  it('captures the URL, with a lookup fallback when create prints nothing usable', () => {
    const optionOne = skill.slice(
      skill.indexOf('### Option 1: Create PR'),
      skill.indexOf('### Option 2: Merge Locally')
    );
    assert.match(optionOne, /PR_URL=\$\(gh pr create/, 'the created PR URL is captured');
    assert.match(
      optionOne,
      /gh pr view --json url -q \.url/,
      'an empty or unparseable create output falls back to a direct lookup'
    );
  });

  it('pins the ordering — the stamp happens before the archive move', () => {
    const section = stampSubsection();
    assert.match(
      section,
      /\*\*before\*\* the archive move/,
      'the stamp must be documented as happening before the archive move'
    );
    assert.ok(
      skill.indexOf(SUBSECTION) < skill.indexOf('### Move the directory'),
      'and must be documented ahead of the move in the skill body'
    );
  });

  it('says a failed stamp is not fatal', () => {
    assert.match(
      stampSubsection(),
      /not fatal/,
      'a stamp that cannot be written must never block the archive'
    );
  });

  it('stays a Bash operation — finish holds neither Write nor Edit', () => {
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)[1];
    const tools = frontmatter.match(/^allowed-tools:\s*(.*)$/m)[1];
    assert.ok(!/\bWrite\b/.test(tools), 'finish must not hold Write');
    assert.ok(!/\bEdit\b/.test(tools), 'finish must not hold Edit');
  });
});

describe('finish PR stamp — executable behaviour', () => {
  const { stamp: stampRecord } = require(path.join(ROOT, 'ship', 'finish-record.cjs'));
  const URL = 'https://github.com/dilhanz/ship/pull/29';

  let dir;
  let ctx;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pr-stamp-'));
    fs.mkdirSync(path.join(dir, '.planning', 'features', 'f'), { recursive: true });
    ctx = path.join(dir, '.planning', 'features', 'f', 'CONTEXT.md');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const stamp = (url = URL) => stampRecord('f', 'pr', url, { cwd: dir });

  const frontmatterOf = (s) => {
    const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(m, 'stamped file must still open with a frontmatter block');
    return m[1];
  };

  it('the skill stamps through the helper, one plain command', () => {
    assert.match(
      stampSubsection(),
      /node "\$\{CLAUDE_PLUGIN_ROOT\}\/ship\/finish-record\.cjs" stamp \{feature-name\} pr /
    );
  });

  it('inserts pr: directly after status: and leaves every other byte alone', () => {
    const before =
      '---\nfeature: "squash-merge-detection"\nstatus: done\ncreated: "2026-08-29"\n---\n\n## Problem\n\nBody text.\n';
    fs.writeFileSync(ctx, before);

    assert.equal(stamp().ok, true);
    assert.equal(
      fs.readFileSync(ctx, 'utf8'),
      before.replace('status: done\n', `status: done\npr: ${URL}\n`)
    );
  });

  it('replaces an existing pr: line rather than adding a second one', () => {
    fs.writeFileSync(ctx, '---\nfeature: "f"\nstatus: done\n---\n\nBody\n');

    assert.equal(stamp().ok, true);
    const second = 'https://github.com/dilhanz/ship/pull/30';
    assert.equal(stamp(second).ok, true);

    const out = fs.readFileSync(ctx, 'utf8');
    assert.equal((out.match(/^pr:/gm) || []).length, 1, 'exactly one pr: line');
    assert.match(out, new RegExp(`^pr: ${second.replace(/\//g, '\\/')}$`, 'm'));
    assert.ok(!out.includes(URL), 'the stale URL is gone, not kept beside the new one');
  });

  it('appends pr: to the frontmatter when there is no status: line', () => {
    fs.writeFileSync(ctx, '---\nfeature: "f"\ncreated: "2026-08-29"\n---\n\nBody\n');

    assert.equal(stamp().ok, true);
    assert.match(
      frontmatterOf(fs.readFileSync(ctx, 'utf8')),
      new RegExp(`^pr: ${URL.replace(/\//g, '\\/')}$`, 'm'),
      'the field lands inside the frontmatter block, not in the body'
    );
  });

  it('reports failure and changes nothing when there is no frontmatter block', () => {
    const before = '# Just a document\n\nNo frontmatter here.\n';
    fs.writeFileSync(ctx, before);

    assert.equal(stamp().ok, false, 'an unstampable file must report failure');
    assert.equal(fs.readFileSync(ctx, 'utf8'), before);
  });

  it('reports failure and writes no pr: line when the URL is empty or not a URL', () => {
    // Neither `gh pr create` nor the `gh pr view` fallback produced a URL. A
    // literal `pr: ` line with no value would be a false record.
    const before = '---\nfeature: "f"\nstatus: done\n---\n\nBody\n';
    fs.writeFileSync(ctx, before);

    assert.equal(stamp('').ok, false);
    assert.equal(stamp('no pull request found').ok, false);
    assert.equal(fs.readFileSync(ctx, 'utf8'), before);
  });

  it('parses CRLF frontmatter', () => {
    fs.writeFileSync(ctx, '---\r\nfeature: "f"\r\nstatus: done\r\n---\r\n\r\nBody\r\n');

    assert.equal(stamp().ok, true);
    assert.match(
      frontmatterOf(fs.readFileSync(ctx, 'utf8')),
      new RegExp(`^pr: ${URL.replace(/\//g, '\\/')}$`, 'm'),
      'CRLF frontmatter is stamped, not rejected'
    );
  });

  it('the CLI prints one JSON line and exits 0 even on failure', () => {
    fs.writeFileSync(ctx, '# no frontmatter\n');
    const run = spawnSync(
      process.execPath,
      [path.join(ROOT, 'ship', 'finish-record.cjs'), 'stamp', 'f', 'pr', URL],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.equal(run.status, 0);
    assert.equal(JSON.parse(run.stdout).ok, false);
  });
});
