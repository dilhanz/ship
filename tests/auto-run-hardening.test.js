const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helper = require(path.join(__dirname, '..', 'ship', 'auto-run.cjs'));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

// Fixes for the low findings the verifier left open, plus the round cap on
// Route's continue row.

function scratch(slug) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-run-hard-'));
  const dir = path.join(cwd, '.planning', 'features', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), '---\nstatus: plan-verified\n---\n');
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '<task id="9" status="pending">\n  <name>Fix</name>\n</task>\n');
  return { cwd, dir };
}

describe('auto-run — post-verify hardening (helper)', () => {
  it('an orphaned lock is taken over within the wait instead of failing the command', () => {
    const { cwd, dir } = scratch('demo');
    assert.equal(helper.start('demo', { session: 's1', cwd }).ok, true);
    fs.writeFileSync(path.join(dir, 'AUTO.json.lock'), '');
    const r = helper.bump('demo', 'planRounds', 2, { cwd });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.value, 1);
    assert.equal(fs.existsSync(path.join(dir, 'AUTO.json.lock')), false);
  });

  it('verdict repeated for the same VERIFY.md returns the stored decision and spends nothing', () => {
    const { cwd, dir } = scratch('demo');
    assert.equal(helper.start('demo', { session: 's1', cwd }).ok, true);
    fs.writeFileSync(path.join(dir, 'VERIFY.md'), 'verify one\n');
    const a = helper.verdict('demo', 4, { cwd });
    const b = helper.verdict('demo', 4, { cwd });
    assert.equal(a.next, 'fix-round');
    assert.equal(a.repeated, undefined);
    assert.equal(b.next, 'fix-round');
    assert.equal(b.repeated, true);
    assert.equal(b.used, 1);
    assert.equal(b.trend, '4');

    fs.writeFileSync(path.join(dir, 'VERIFY.md'), 'verify two\n');
    const c = helper.verdict('demo', 4, { cwd });
    assert.equal(c.next, 'stop');
    assert.equal(c.reason, 'not shrinking');
    assert.equal(c.trend, '4→4');
  });

  it('without a VERIFY.md every verdict call still counts', () => {
    const { cwd } = scratch('demo');
    helper.start('demo', { session: 's1', cwd });
    assert.equal(helper.verdict('demo', 4, { cwd }).next, 'fix-round');
    assert.equal(helper.verdict('demo', 4, { cwd }).reason, 'not shrinking');
  });

  it('continueRounds is a bumpable counter with a cap', () => {
    const { cwd } = scratch('demo');
    helper.start('demo', { session: 's1', cwd });
    assert.equal(helper.bump('demo', 'continueRounds', 1, { cwd }).allowed, true);
    assert.equal(helper.bump('demo', 'continueRounds', 1, { cwd }).allowed, false);
    assert.equal(helper.bump('demo', 'otherRounds', 1, { cwd }).ok, false);
  });

  it('the slug "." is rejected and touches nothing', () => {
    const { cwd } = scratch('demo');
    assert.equal(helper.get('.', { cwd }).ok, false);
    assert.equal(helper.end('.', { cwd }).ok, false);
    assert.equal(fs.existsSync(path.join(cwd, '.planning', 'features', 'AUTO.json.lock')), false);
  });
});

describe('auto-run — post-verify hardening (skill text)', () => {
  const skill = readSrc('skills/auto/SKILL.md');

  it('the branch guard ends any record an earlier run left', () => {
    const start = skill.indexOf('## Branch guard');
    const guard = skill.slice(start, skill.indexOf('## Record the run'));
    assert.match(guard, /auto-run\.cjs" end \{name\}/);
  });

  it('git worktree add is not run a second time for a worktree-started idea', () => {
    assert.match(skill, /`git worktree add` has already run: skip all three commands/);
  });

  it('the continue row of Route is capped', () => {
    const route = skill.slice(skill.indexOf('## Route'), skill.indexOf('## Finish'));
    assert.match(route, /bump \{name\} continueRounds --cap 5/);
  });

  it('the skill stays under the size cap', () => {
    assert.ok(Buffer.byteLength(skill, 'utf8') < 20000);
  });
});
