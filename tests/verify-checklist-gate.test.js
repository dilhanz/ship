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

/** The agent's Stage 2b section, up to 2c. */
const stage2b = () => {
  const src = agent();
  const start = src.indexOf('### 2b');
  assert.ok(start > -1, 'the verifier must have a 2b section');
  const end = src.indexOf('### 2c', start);
  return src.slice(start, end > -1 ? end : undefined);
};

/** The agent's Verification Depth section. */
const depthSection = () => agent().split('## Verification Depth')[1].split('\n## ')[0];

describe('verify-checklist-gate: the verifier runs the checklist and trial merge', () => {
  it('names the repo checklist file as an input and points at its format doc', () => {
    const inputs = agent().split('## Inputs')[1].split('## Verification Depth')[0];
    assert.ok(inputs.includes('.planning/verify-checklist.md'));
    assert.ok(inputs.includes('ship/docs/verify-checklist.md'));
  });

  it('names the three generic checklist items', () => {
    const s = stage2b();
    assert.match(s, /docs\/manual\/user-facing claims in the diff match the code/);
    assert.match(s, /tests that depend on the current date or time zone/);
    assert.match(s, /concurrency on write paths/);
  });

  it('states "No repo checklist" when the file is absent', () => {
    assert.ok(stage2b().includes('No repo checklist'));
  });

  it('a FAIL row is a bug at medium or above, never low', () => {
    assert.match(stage2b(), /medium severity or above, never low/);
  });

  it('every row is decided with evidence, N/A carries a reason', () => {
    const s = stage2b();
    assert.match(s, /PASS \/ FAIL \/ N\/A/);
    assert.match(s, /N\/A carries a one-line reason/);
  });

  it('the trial merge uses a throwaway worktree and removes it', () => {
    const s = stage2b();
    const at = s.indexOf('#### Trial merge with main');
    assert.ok(at > -1, '2b must have a Trial merge with main subsection');
    const section = s.slice(at, s.indexOf('\n#### ', at + 1));
    assert.ok(section.includes('git worktree add --detach "$TRIAL" HEAD'));
    assert.ok(section.includes('git worktree remove --force "$TRIAL"'));
    assert.ok(section.includes('-C "$TRIAL"'));
    assert.match(section, /never run `git merge` in the feature checkout/);
    assert.ok(section.includes('NOT_RUNNABLE'));
    assert.ok(section.includes('Merge main into the branch and fix the break'));
  });

  it('no line in the agent runs a bare git merge outside the trial worktree', () => {
    const offenders = agent().split('\n').filter((line) =>
      /git (-C \S+ )?(-c \S+ )*merge\b/.test(line)
      && !line.includes('merge-base')
      && !line.includes('never')
      && !line.includes('-C "$TRIAL"'));
    assert.deepEqual(offenders, [], 'every git merge must run with -C "$TRIAL"');
  });

  it('2b orders carried findings, then the gates, then the capped discretionary tests', () => {
    const s = stage2b();
    const order = [
      'Unresolved review findings come first',
      '#### Trial merge with main',
      '#### Repo checklist',
      '#### Generic checklist',
      'capped at **3 test files**',
    ].map((needle) => {
      const i = s.indexOf(needle);
      assert.ok(i > -1, `2b must contain "${needle}"`);
      return i;
    });
    for (let k = 1; k < order.length; k++) {
      assert.ok(order[k - 1] < order[k], `2b order broken at step ${k}`);
    }
  });

  it('at criteria-only the trial merge and repo checklist run, the generic checklist is skipped', () => {
    const d = depthSection();
    assert.match(d, /trial merge and the repo checklist still run/i);
    assert.match(d, /generic checklist is skipped/i);
    assert.match(d, /build-command lookup/);
  });

  it('the incremental record and output block carry checklist and trial_merge', () => {
    const src = agent();
    const record = src.split('## The Incremental Record')[1].split('\n## ')[0];
    assert.ok(record.includes('`checklist`'));
    assert.ok(record.includes('`trial_merge`'));
    const stage0 = src.split('## Stage 0')[1].split('\n## ')[0];
    assert.match(stage0, /checklist rows/);
    assert.match(stage0, /trial merge/);
    const output = src.split('## Output')[1];
    assert.ok(output.includes('"checklist"'));
    assert.ok(output.includes('"trial_merge"'));
  });
});
