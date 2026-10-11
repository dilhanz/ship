// Doctrine and behavior tests for verify-checklist-gate: the verifier's verdict
// is honest (any Open bug fails, whatever its severity), a non-defect leaves
// Bug Findings only with a CONTEXT.md citation, and the verifier runs at 80
// turns.
//
// Retro evidence: #236 (booking-inspections) shipped PASS 7/7 while its own
// Bug Findings table listed 4 Open bugs (1 medium, 3 low), because only
// critical/high bugs used to fail a verify.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const agent = () => readSrc('agents/ship-verifier.md');
const skill = () => readSrc('skills/verify/SKILL.md');
const template = () => readSrc('ship/templates/VERIFY.md');

/** The agent's Stage 3 section, up to the next top-level heading. */
const stage3 = () => {
  const src = agent();
  const start = src.indexOf('## Stage 3');
  assert.ok(start > -1, 'the verifier must have a Stage 3 section');
  const end = src.indexOf('\n## ', start + 1);
  return src.slice(start, end > -1 ? end : undefined);
};

describe('verify-checklist-gate: any Open bug fails the verify', () => {
  it('the agent states Open → FAIL at any severity', () => {
    const s3 = stage3();
    assert.match(s3, /any bug in Bug Findings with status `Open`, whatever its severity/);
    assert.match(s3, /An Open bug beats INCONCLUSIVE/);
    assert.match(s3, /no Open bug/);
  });

  it('the skill states Open → FAIL at any severity', () => {
    assert.match(skill(), /Any bug left Open — at any severity —/);
  });

  it('the template states Open → FAIL at any severity', () => {
    assert.match(template(), /Any row with Status `Open` makes the Overall Status FAIL, whatever its severity/);
  });

  it('no file still uses critical/high as the fail rule', () => {
    assert.ok(!stage3().includes('any critical/high bug'),
      'Stage 3 must not limit FAIL to critical/high bugs');
    assert.ok(!/Medium\/low bugs .* recommendations/.test(stage3()),
      'medium/low bugs must no longer be demoted to recommendations');
    assert.ok(!skill().includes('Critical or high bugs'),
      'the verify skill must not limit blocking to critical/high bugs');
    assert.ok(!/reproduced\s+critical\/high one is a FAIL/.test(skill()),
      'a reproduced carried finding fails at any severity');
  });

  it('FAIL writes one fix task per Open bug, not only critical/high ones', () => {
    assert.match(stage3(), /one per Open bug/);
  });

  it('a reproduced carried finding is an Open bug that fails the verify', () => {
    assert.match(agent(), /any reproduced finding is an Open bug and FAILs the verify/);
  });
});

describe('verify-checklist-gate: the citation rule', () => {
  const nearCitation = (src, section) => {
    const idx = src.indexOf(section);
    assert.ok(idx > -1, `must mention ${section}`);
    return src;
  };

  it('the agent requires a CONTEXT.md citation to move a non-defect to Quality Notes or Gaps', () => {
    const s3 = stage3();
    const i = s3.indexOf('the citation rule');
    assert.ok(i > -1, 'Stage 3 must name the citation rule');
    const para = s3.slice(i, s3.indexOf('\n\n', i));
    for (const needle of ['Quality Notes', 'Gaps', 'CONTEXT.md', 'cite', 'stays a bug']) {
      assert.ok(para.includes(needle), `citation rule paragraph must mention "${needle}"`);
    }
  });

  it('the template states the citation rule and gives Quality Notes and Gaps a cited-item format', () => {
    const t = nearCitation(template(), 'Citation rule');
    const ruleAt = t.indexOf('Citation rule');
    const rule = t.slice(ruleAt, t.indexOf('\n', ruleAt));
    for (const needle of ['Quality Notes', 'Gaps', 'CONTEXT.md', 'uncited']) {
      assert.ok(rule.includes(needle), `template citation rule must mention "${needle}"`);
    }
    for (const section of ['### Quality Notes', '## Gaps']) {
      const at = t.indexOf(section);
      assert.ok(at > -1, `template must have ${section}`);
      const body = t.slice(at, t.indexOf('\n#', at + section.length));
      assert.ok(body.includes('— cites CONTEXT.md: "{quoted line}"'),
        `${section} must show the cited-item format`);
    }
  });
});

describe('verify-checklist-gate: verifier turn budget', () => {
  it('the verifier frontmatter declares maxTurns: 80', () => {
    const front = agent().split('---')[1];
    assert.match(front, /^maxTurns: 80$/m);
  });

  it('the 2b budget paragraph reasons with 80 turns', () => {
    assert.match(agent(), /With 80 turns/);
    assert.ok(!/With 60 turns/.test(agent()));
  });
});
