/**
 * Plan-loop durability — adversarial doctrine checks.
 *
 * tests/plan-loop-durability.test.js pins the contracts named by the
 * acceptance criteria. These pin the seams around them that a later edit
 * could quietly break without failing those tests: the scratch-cleanup
 * exemption for a lost replan, the prompt-slice definition order the review
 * gate flagged, the plan-verify Bash restriction, the CLAUDE.md typo the
 * release task fixed, and the docs that describe the new fields.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('plan-loop durability doctrine adversarial — workflow source shape', () => {
  it('salvageReplanPromptFor holds the body and is defined before the delegating salvageReplanPrompt', () => {
    // The prompt-slice tests split on 'const salvageReplanPrompt', which is a
    // prefix of 'const salvageReplanPromptFor'. If the one-line wrapper ever
    // moves above the body, the slice becomes the wrapper and the assertions
    // on /pending/ and /double-apply/ are silently testing one line.
    const s = readSrc('ship/workflows/plan.workflow.js');
    const bodyAt = s.indexOf('const salvageReplanPromptFor');
    const wrapperAt = s.indexOf('const salvageReplanPrompt = ');
    const markerAt = s.indexOf('// Convergence key');
    assert.ok(bodyAt > -1 && wrapperAt > -1 && markerAt > -1);
    assert.ok(bodyAt < wrapperAt, 'the body must precede the wrapper');
    assert.ok(wrapperAt < markerAt, 'both must precede the slice end marker');
    const slice = s.split('const salvageReplanPrompt')[1].split('// Convergence key')[0];
    assert.ok(slice.length > 500, 'the slice must be the full prompt body, not the one-line wrapper');
    assert.match(s, /salvageReplanPrompt\(round, replanFull\)/, 'the in-loop call site string is asserted elsewhere');
    assert.match(s, /salvageReplanPromptFor\(answersLabel, answersPrompt\)/, 'the answers step uses the label-keyed helper');
  });

  it('every terminal return in the loop carries nextRoundOffset built from labelShift', () => {
    const s = readSrc('ship/workflows/plan.workflow.js');
    const loop = s.slice(s.indexOf('for (let round = 1'));
    const returns = loop.split('return {').length - 1;
    const stamped = (loop.match(/nextRoundOffset: roundOffset \+ labelShift \+ round/g) || []).length;
    assert.equal(returns, 7, 'BLOCKED x3, APPROVED, STUCK, UNRESOLVED, NEEDS_INPUT');
    assert.equal(stamped, returns, 'a return without the shifted offset would make the go skill collide labels');
  });

  it('the reviewer scratch name stays bare-round while the replanner name is label-keyed', () => {
    const s = readSrc('ship/workflows/plan.workflow.js');
    // `replan-round-` contains `plan-round-`, so anchor on the non-replan form.
    assert.match(s, /(?<!re)plan-round-\$\{round\}\.json/, 'the go skill reads plan-round-{rounds}.json by bare loop round');
    assert.doesNotMatch(s, /(?<!re)plan-round-\$\{labelRound/, 'shifting the reviewer name would break the go fallback');
    assert.doesNotMatch(s, /replan-round-\$\{round\}\.json/, 'the replanner name must carry the label, never the bare round');
  });
});

describe('plan-loop durability doctrine adversarial — go skill', () => {
  const c = readSrc('skills/go/SKILL.md');
  const s2a = c.slice(c.indexOf('## 2a.'), c.indexOf('## 3.'));

  it('scratch cleanup exempts a BLOCKED whose blockedBy is replanner or answers', () => {
    const cleanupAt = s2a.indexOf('**Scratch cleanup');
    assert.ok(cleanupAt > -1, 'the cleanup paragraph must be findable');
    const para = s2a.slice(cleanupAt, s2a.indexOf('\n\n', cleanupAt));
    assert.match(para, /except a `BLOCKED` whose `blockedBy` is `replanner` or `answers`/,
      'deleting replan-round-{n}.json after telling the user to re-run /ship:go would destroy what the re-run salvages');
    assert.match(para, /replan-round-\*\.json/);
    assert.match(para, /after the branch, never before it/i);
  });

  it('the reviewer fallback copies the adopted record over plan-round-1.json before re-invoking', () => {
    const start = s2a.indexOf('**`reviewer`**');
    const bullet = s2a.slice(start, s2a.indexOf('**`replanner` / `answers`**'));
    assert.match(bullet, /copy the record over `\.planning\/features\/\{name\}\/\.review-scratch\/plan-round-1\.json`/);
    assert.match(bullet, /roundOffset: <the result's nextRoundOffset>/);
    assert.match(bullet, /A second `BLOCKED` reports as below with no further re-invocation/);
    assert.match(bullet, /Missing, unparseable, hash-mismatched, or incomplete record/);
  });

  it('the NEEDS_INPUT re-invocation passes findings and uses nextRoundOffset with a fallback', () => {
    const start = s2a.indexOf('**`NEEDS_INPUT`**');
    const bullet = s2a.slice(start, s2a.indexOf('**`STUCK`**'));
    assert.match(bullet, /findings: <the result's findings>/);
    assert.match(bullet, /roundOffset: <the result's nextRoundOffset>/);
    assert.match(bullet, /fall back to the summed `rounds`/);
    assert.match(bullet, /replan:answers/);
  });

  it('the outcome block renders the answers entry as its own line', () => {
    assert.match(s2a, /- Answers applied: \{changes\.length\} change\(s\)/);
  });
});

describe('plan-loop durability doctrine adversarial — plan-verify, plan, agents, docs', () => {
  it('plan-verify restricts Bash to git hash-object in prose', () => {
    const c = readSrc('skills/plan-verify/SKILL.md');
    const section = c.slice(c.indexOf('### Reviewer failure'), c.indexOf('## Write Results'));
    assert.match(section, /the only Bash use this skill makes/);
    assert.match(section, /adopted from the reviewer's scratch record/);
    assert.match(section, /`complete` false — report the failure to the user and stop/);
  });

  it('/ship:plan hooks replan mode into Step 7, the display, and What NOT to Do', () => {
    const c = readSrc('skills/plan/SKILL.md');
    const step7 = c.slice(c.indexOf('### Step 7'), c.indexOf('### Step 8'));
    assert.match(step7, /In replan mode, do not Write the template/);
    assert.match(step7, /Edit `\.planning\/features\/\{name\}\/PLAN\.md` in place/);
    assert.match(c, /Mode: replan \(N findings addressed\)/);
    assert.match(c, /\*\*Discard review findings\*\*/);
    const mode = c.slice(c.indexOf('## Replan Mode'), c.indexOf('## Pre-Planning Exploration'));
    assert.match(mode, /treat an absent number as 0/);
    assert.match(mode, /revised: \{what changed\}/);
    assert.match(mode, /disproved: \{evidence from the code\}/);
  });

  it('the replanner marks complete only after the ### Round subsection and matches findings by task_id + file', () => {
    const c = readSrc('agents/ship-replanner.md');
    const history = c.slice(c.indexOf('## Round history'), c.indexOf('## Output'));
    assert.match(history, /rewrite the scratch record a final time with `complete: true`/);
    const record = c.slice(c.indexOf('## Scratch record'), c.indexOf('## Round history'));
    assert.match(record, /"status": "pending" \| "revised" \| "disproved" \| "escalated"/);
    assert.match(record, /a salvage matches on those two keys/);
    assert.match(c, /Bash is for read-only inspection only, plus `git hash-object`/);
  });

  it('the plan reviewer salvage check now routes to Output instead of stopping', () => {
    const c = readSrc('agents/ship-plan-reviewer.md');
    const salvage = c.slice(c.indexOf('## Salvage check'), c.indexOf('\n## ', c.indexOf('## Salvage check') + 5));
    assert.match(salvage, /Report its findings verbatim/);
    assert.match(salvage, /StructuredOutput/, 'the salvage path must name the final action');
  });

  it('CLAUDE.md describes the new machinery and no longer carries the doubled typo', () => {
    const c = readSrc('CLAUDE.md');
    assert.doesNotMatch(c, /deleting `\.review-scratch\/` deleting/);
    for (const phrase of ['replan-round-', 'replan:answers', 'nextRoundOffset', '60 turns']) {
      assert.ok(c.includes(phrase), `CLAUDE.md must mention ${phrase}`);
    }
    assert.doesNotMatch(c, /replanner its own `### Round \{n\}` subsection/, 'the old subsection-keyed salvage claim must be gone');
  });

  it('the CHANGELOG 5.21.0 entry names the four audited defects', () => {
    const c = readSrc('CHANGELOG.md');
    const entry = c.slice(c.indexOf('## 5.21.0'), c.indexOf('## 5.20.0'));
    for (const phrase of ['### Added', '### Changed', '### Fixed', 'and stop', 'maxTurns', 'replan-round-', 'replan:answers', 'blockedBy', 'nextRoundOffset']) {
      assert.ok(entry.includes(phrase), `5.21.0 entry must mention ${phrase}`);
    }
  });
});
