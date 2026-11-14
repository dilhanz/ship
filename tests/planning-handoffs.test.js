/**
 * Planning handoffs (v5.31.0).
 *
 * Four things a planning step produced and the next step was never told to
 * use, found by reading the 14 archived features:
 *
 * 1. Plan-review WARNINGs were listed in the outcome block and nowhere else.
 *    A per-task builder reads its brief, so they reached nobody unless the
 *    session applied them ad hoc — and one such edit rewrote an acceptance
 *    criterion in CONTEXT.md.
 * 2. The brainstorm writes `## Open Questions` for the planner (9 of 14
 *    features); the plan skill never mentioned the section.
 * 3. The brief carried CONTEXT.md's decisions but not PLAN.md's (covered by
 *    tests/task-brief.test.js).
 * 4. The planner and plan reviewer never read the verify checklist the
 *    feature is later failed against.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const planSkill = () => readSrc('skills/plan/SKILL.md');
const planReviewer = () => readSrc('agents/ship-plan-reviewer.md');
const goSkill = () => readSrc('skills/go/SKILL.md');
const planVerify = () => readSrc('skills/plan-verify/SKILL.md');

/** Text from `start` up to the next line matching `end` (or EOF). */
function section(text, start, end) {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `section "${start}" must exist`);
  const rest = text.slice(i + start.length);
  const m = rest.match(end);
  return m ? rest.slice(0, m.index) : rest;
}

describe('planning-handoffs: plan-review warnings get a disposition', () => {
  const sources = [
    ['skills/go/SKILL.md', () => section(goSkill(), '### Apply the warnings', /^## /m)],
    ['skills/plan-verify/SKILL.md', () => section(planVerify(), '**Apply the warnings.**', /^#### /m)],
  ];

  for (const [name, read] of sources) {
    it(`${name} names the three dispositions`, () => {
      const s = read();
      assert.match(s, /\*Applied:\*/);
      assert.match(s, /\*Not applied:\*/);
      assert.match(s, /\*Needs the user:\*/);
    });

    it(`${name} bounds the edit to the named task and checks the evidence first`, () => {
      const s = read();
      assert.match(s, /its evidence holds/);
      assert.match(s, /Edit only that task's `<files>`, `<reference>`, `<action>` or `<verify>`/);
      assert.match(s, /never renumber/i);
    });

    it(`${name} never edits CONTEXT.md on a warning`, () => {
      assert.match(read(), /Never edit CONTEXT\.md/);
    });

    it(`${name} lists suggestions without applying them`, () => {
      assert.match(read(), /SUGGESTION (findings|items) are listed and not applied/);
    });
  }

  it('the go skill applies warnings on APPROVED only, before the approval gate', () => {
    const c = goSkill();
    const apply = c.indexOf('### Apply the warnings (`APPROVED` only)');
    const gate = c.indexOf('## 3. Plan Approval Gate');
    assert.ok(apply !== -1 && gate > apply, 'the apply step sits before section 3');
    assert.match(c, /each WARNING followed by its disposition from \*\*Apply the warnings\*\*/);
  });

  it('a Needs-the-user warning never stops a run but is always shown', () => {
    const s = section(goSkill(), '### Apply the warnings', /^## /m);
    assert.match(s, /does not stop the run/);
    const gate = section(goSkill(), '## 3. Plan Approval Gate', /^## /m);
    assert.match(gate, /every warning marked `Needs the user` in full/);
    assert.match(planVerify(), /One line per warning marked `Needs the user`/);
  });
});

describe('planning-handoffs: open questions are settled by the plan', () => {
  it('the plan skill extracts them and settles each in Decisions', () => {
    const c = planSkill();
    assert.match(section(c, '### Step 1', /^### /m), /`## Open Questions`/);
    const step4 = section(c, '### Step 4', /^### /m);
    assert.match(step4, /Settle every open question/);
    assert.match(step4, /gets one `## Decisions` line/);
    assert.match(step4, /never enters the plan as an open item/);
  });

  it('the plan reviewer checks them, CRITICAL only when a task contract depends on one', () => {
    const line = planReviewer().split('\n').find((l) => l.startsWith('- Open questions:'));
    assert.ok(line, 'the judgment review has an Open questions bullet');
    assert.match(line, /task's contract depends on is CRITICAL/);
    assert.match(line, /any other unsettled one is a WARNING/);
  });
});

describe('planning-handoffs: the checklist is read at plan time', () => {
  it('the plan skill reads it during exploration', () => {
    const s = section(planSkill(), '## Pre-Planning Exploration', /^## /m);
    assert.match(s, /Read `\.planning\/verify-checklist\.md`, if present/);
    assert.match(s, /settle it in the `<action>` of the task it governs/);
  });

  it('the plan reviewer raises a violation as a WARNING, never a CRITICAL', () => {
    const line = planReviewer().split('\n').find((l) => l.startsWith('- Checklist:'));
    assert.ok(line, 'the judgment review has a Checklist bullet');
    assert.match(line, /\.planning\/verify-checklist\.md/);
    assert.match(line, /WARNING/);
    assert.doesNotMatch(line, /CRITICAL/);
  });
});

describe('planning-handoffs: plan decisions reach the builder', () => {
  it('the plan skill says its Decisions travel in the brief', () => {
    assert.match(section(planSkill(), '### Step 4', /^### /m), /copied into every per-task builder's brief/);
  });

  it('task-brief.cjs reads the plan preamble for them', () => {
    const c = readSrc('ship/task-brief.cjs');
    assert.match(c, /### Plan decisions/);
    assert.match(c, /sectionBody\(preamble, 'Decisions'\)/);
  });
});
